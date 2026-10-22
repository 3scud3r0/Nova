"""Optional aiortc data channels with signed SDP over admitted-peer RPC.

STUN/TURN servers are explicitly configured locally. NAT traversal depends on
network conditions and relay credentials; no public relay is silently selected.
"""

from __future__ import annotations
import asyncio
import hashlib
import ipaddress
import time
from .artifacts import SigningIdentity
from nova.bioma.determinism import canonical_json, strict_json


class WebRTCTransport:
    def __init__(self, node, ice_servers=(), max_connections=4):
        if not 1 <= max_connections <= 8 or len(ice_servers) > 8:
            raise ValueError("WebRTC budget exceeded")
        from aiortc import RTCConfiguration, RTCIceServer

        for server in ice_servers:
            urls = server.get("urls", [])
            urls = [urls] if isinstance(urls, str) else urls
            if not urls or any(
                not u.startswith(("stun:", "stuns:", "turn:", "turns:")) for u in urls
            ):
                raise ValueError("only STUN/TURN ICE servers are supported")
        self.node = node
        self.config = RTCConfiguration(
            iceServers=[RTCIceServer(**s) for s in ice_servers]
        )
        self.max_connections = max_connections
        self.connections = {}
        self.channels = {}
        self.pending = {}
        self.tasks = set()

    def _remote_sdp(self, sdp):
        if self.node.discovery and self.node.discovery.allow_lan:
            return sdp
        lines = []
        for line in sdp.splitlines():
            if line.startswith("a=candidate:"):
                parts = line.split()
                try:
                    allowed = (
                        len(parts) > 5 and ipaddress.ip_address(parts[4]).is_global
                    )
                except ValueError:
                    allowed = False
                if not allowed:
                    continue
            lines.append(line)
        return "\r\n".join(lines) + "\r\n"

    def _connection(self, peer):
        from aiortc import RTCPeerConnection

        if peer in self.connections or len(self.connections) >= self.max_connections:
            raise ValueError("WebRTC connection limit/duplicate")
        pc = RTCPeerConnection(self.config)
        self.connections[peer] = pc

        @pc.on("datachannel")
        def on_channel(channel):
            self._channel(peer, channel)

        @pc.on("connectionstatechange")
        async def state_change():
            if pc.connectionState in ("failed", "closed"):
                if self.connections.get(peer) is pc:
                    self.connections.pop(peer, None)
                    self.channels.pop(peer, None)
                if pc.connectionState != "closed":
                    await pc.close()

        return pc

    def _channel(self, peer, channel):
        self.channels[peer] = channel
        queue = asyncio.Queue(maxsize=8)

        @channel.on("message")
        def on_message(raw):
            if (
                not isinstance(raw, (str, bytes))
                or len(raw) > self.node.max_frame
                or queue.full()
            ):
                channel.close()
                return
            queue.put_nowait(raw)

        async def process():
            try:
                while channel.readyState != "closed":
                    raw = await asyncio.wait_for(queue.get(), 120)
                    envelope = strict_json(raw, self.node.max_frame)
                    _, payload = SigningIdentity.verify(envelope, peer)
                    if payload.get("protocol") == "NOVA-SWARM-REPLY-v1":
                        waiter = self.pending.pop(
                            (peer, payload["request_nonce"]), None
                        )
                        if waiter and not waiter.done():
                            waiter.set_result(payload["body"])
                    else:
                        reply = await self.node.handle(raw)
                        if channel.bufferedAmount > self.node.max_frame:
                            raise ValueError("WebRTC send buffer exceeded")
                        channel.send(reply)
            except (ValueError, KeyError, TypeError, OSError, asyncio.TimeoutError):
                channel.close()

        task = asyncio.create_task(process())
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def accept(self, envelope, peer):
        _, offer = SigningIdentity.verify(envelope, peer)
        if (
            offer.get("schema") != "NOVA-RTC-SDP-v1"
            or offer["type"] != "offer"
            or len(offer["sdp"]) > 65536
        ):
            raise ValueError("invalid signed SDP")
        from aiortc import RTCSessionDescription

        pc = self._connection(peer)
        try:
            await asyncio.wait_for(
                pc.setRemoteDescription(
                    RTCSessionDescription(self._remote_sdp(offer["sdp"]), "offer")
                ),
                15,
            )
            answer = await pc.createAnswer()
            await asyncio.wait_for(pc.setLocalDescription(answer), 20)
            return self.node.identity.sign(
                {
                    "schema": "NOVA-RTC-SDP-v1",
                    "session": offer["session"],
                    "type": "answer",
                    "sdp": pc.localDescription.sdp,
                }
            )
        except BaseException:
            await pc.close()
            self.connections.pop(peer, None)
            raise

    async def connect(self, peer):
        from aiortc import RTCSessionDescription

        if peer not in self.node.allowed:
            raise ValueError("peer must first be admitted")
        pc = self._connection(peer)
        channel = pc.createDataChannel("nova-signed-rpc", ordered=True)
        self._channel(peer, channel)
        try:
            offer = await pc.createOffer()
            await asyncio.wait_for(pc.setLocalDescription(offer), 20)
            session = hashlib.sha256(
                f"{self.node.identity.peer_id}:{time.time_ns()}".encode()
            ).hexdigest()
            request = self.node.identity.sign(
                {
                    "schema": "NOVA-RTC-SDP-v1",
                    "session": session,
                    "type": "offer",
                    "sdp": pc.localDescription.sdp,
                }
            )
            envelope = await self.node.request(peer, "rtc-offer", request)
            _, answer = SigningIdentity.verify(envelope, peer)
            if (
                answer.get("schema") != "NOVA-RTC-SDP-v1"
                or answer["session"] != session
                or answer["type"] != "answer"
                or len(answer["sdp"]) > 65536
            ):
                raise ValueError("SDP answer context mismatch")
            await asyncio.wait_for(
                pc.setRemoteDescription(
                    RTCSessionDescription(self._remote_sdp(answer["sdp"]), "answer")
                ),
                15,
            )
        except BaseException:
            await pc.close()
            self.connections.pop(peer, None)
            self.channels.pop(peer, None)
            raise

    async def request(self, peer, method, body):
        channel = self.channels.get(peer)
        if channel is None or channel.readyState != "open":
            raise ValueError("WebRTC channel is not open")
        envelope = self.node.message(method, body)
        raw = canonical_json(envelope)
        if (
            len(raw) > self.node.max_frame
            or len(self.pending) >= 32
            or channel.bufferedAmount > self.node.max_frame
        ):
            raise ValueError("WebRTC request/send budget exceeded")
        nonce = envelope["payload"]["nonce"]
        future = asyncio.get_running_loop().create_future()
        self.pending[peer, nonce] = future
        try:
            channel.send(raw)
            return await asyncio.wait_for(future, 15)
        finally:
            self.pending.pop((peer, nonce), None)

    async def close(self):
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await asyncio.gather(
            *(pc.close() for pc in self.connections.values()), return_exceptions=True
        )
        self.connections.clear()
        self.channels.clear()

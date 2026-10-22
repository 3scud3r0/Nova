"""Opt-in pinned-peer RPC and XOR routing over framed TLS or WebSockets.

No unauthenticated peer code, automatic simulation, dynamic imports, arbitrary
URLs, or received proof scripts are executed. Received claims remain unverified.
"""

from __future__ import annotations
import asyncio
import base64
from collections import OrderedDict
from dataclasses import dataclass
import hashlib
import ssl
import struct
import time
from urllib.parse import urlsplit
from nova.bioma.determinism import canonical_json, strict_json
from .artifacts import ArtifactStore, SigningIdentity, HEX


@dataclass(frozen=True)
class Peer:
    peer_id: str
    endpoint: str

    def __post_init__(self):
        u = urlsplit(self.endpoint)
        if (
            not HEX.fullmatch(self.peer_id)
            or u.scheme not in ("tls", "tcp", "wss", "ws")
            or not u.hostname
            or not u.port
            or u.username
            or u.password
            or u.query
            or u.fragment
        ):
            raise ValueError("invalid pinned peer endpoint")
        if u.scheme in ("tcp", "ws") and u.hostname not in (
            "127.0.0.1",
            "localhost",
            "::1",
        ):
            raise ValueError("remote peers require TLS/wss")


class RoutingTable:
    """Bounded XOR-distance routing; manually pinned peers, not a global DHT claim."""

    def __init__(self, identity, peers=(), capacity=64):
        if len(peers) > capacity:
            raise ValueError("routing budget exceeded")
        self.identity = identity
        self.peers = {p.peer_id: p for p in peers}
        self.capacity = capacity

    def closest(self, key, limit=8):
        if not HEX.fullmatch(key):
            raise ValueError("invalid routing key")
        return sorted(
            self.peers.values(), key=lambda p: int(p.peer_id, 16) ^ int(key, 16)
        )[:limit]


class PeerNode:
    max_frame = 1024 * 1024

    def __init__(
        self,
        identity: SigningIdentity,
        store: ArtifactStore,
        peers=(),
        *,
        max_connections=8,
        clock_skew=120,
    ):
        self.identity, self.store = identity, store
        self.routing = RoutingTable(identity.peer_id, peers)
        self.allowed = set(self.routing.peers) | {identity.peer_id}
        self.semaphore = asyncio.Semaphore(max_connections)
        self.seen = OrderedDict()
        self.rates = {}
        self.clock_skew = clock_skew
        self.received = []
        self.sequence = 0
        self.consensus = {}
        self.subspaces = {}

    def register_consensus(self, gossip):
        """Opt in to a shared, locally declared model coordinate system."""
        self.consensus[gossip.model_id] = gossip

    def register_subspace(self, coordinate_id, basis, rank_budget):
        from .subspace_exchange import package_subspace

        packet = package_subspace(basis, coordinate_id)
        self.subspaces[coordinate_id] = {"packet": packet, "rank_budget": rank_budget}

    def message(self, method, body):
        if method not in (
            "inventory",
            "get",
            "put",
            "find",
            "announce",
            "belief",
            "subspace",
        ):
            raise ValueError("unsupported RPC method")
        self.sequence += 1
        payload = {
            "protocol": "NOVA-SWARM-v1",
            "origin": self.identity.peer_id,
            "method": method,
            "body": body,
            "time": int(time.time()),
            "nonce": hashlib.sha256(
                self.identity.public_key
                + struct.pack(">QQ", time.time_ns(), self.sequence)
            ).hexdigest(),
        }
        return self.identity.sign(payload)

    def validate(self, envelope):
        peer, payload = SigningIdentity.verify(envelope)
        if (
            peer not in self.allowed
            or payload.get("origin") != peer
            or payload.get("protocol") != "NOVA-SWARM-v1"
        ):
            raise ValueError("peer is not admitted")
        now = time.time()
        if abs(now - payload["time"]) > self.clock_skew or not HEX.fullmatch(
            payload["nonce"]
        ):
            raise ValueError("expired/invalid envelope")
        key = (peer, payload["nonce"])
        if key in self.seen:
            raise ValueError("replayed envelope")
        bucket = [t for t in self.rates.get(peer, []) if now - t < 60]
        if len(bucket) >= 120:
            raise ValueError("peer rate budget exceeded")
        bucket.append(now)
        self.rates[peer] = bucket
        self.seen[key] = now
        while len(self.seen) > 4096:
            self.seen.popitem(last=False)
        return peer, payload

    async def handle(self, raw):
        if isinstance(raw, str):
            raw = raw.encode()
        peer, payload = self.validate(strict_json(raw, self.max_frame))
        method = payload["method"]
        body = payload["body"]
        if method == "inventory":
            result = {"hashes": self.store.inventory()}
        elif method == "get":
            data = self.store.get(body["digest"])
            if len(data) > 512 * 1024:
                raise ValueError("network object transfer budget exceeded")
            result = {"digest": body["digest"], "data": base64.b64encode(data).decode()}
        elif method == "put":
            if len(body["data"]) > 700000:
                raise ValueError("network object too large")
            data = base64.b64decode(body["data"], validate=True)
            if hashlib.sha256(data).hexdigest() != body["digest"]:
                raise ValueError("object digest mismatch")
            # A blob is inert content, never an imported module or runnable script.
            digest = self.store.put(data)
            result = {"stored": digest, "verification": "not_scientifically_verified"}
        elif method == "find":
            result = {
                "peers": [
                    {"peer_id": p.peer_id, "endpoint": p.endpoint}
                    for p in self.routing.closest(body["key"])
                ]
            }
        elif method == "belief":
            model = self.consensus.get(body.get("model_id"))
            if model is None:
                result = {"status": "model_not_registered", "truth_proved": False}
            else:
                accepted = model.accept(peer, body)
                result = {
                    "accepted": accepted,
                    "belief": model.step() if accepted else model.packet(),
                    "truth_proved": False,
                }
        elif method == "subspace":
            from .subspace_exchange import merge_subspaces, package_subspace
            import numpy as np

            coordinate_id = body.get("coordinate_id")
            local = self.subspaces.get(coordinate_id)
            if local is None:
                result = {"status": "coordinate_system_not_registered"}
            else:
                merged = merge_subspaces(
                    np.asarray(local["packet"]["basis"]),
                    body,
                    coordinate_id,
                    local["rank_budget"],
                )
                result = {k: v for k, v in merged.items() if k != "basis"}
                if merged["basis"] is not None:
                    local["packet"] = package_subspace(merged["basis"], coordinate_id)
                    result["packet"] = local["packet"]
        elif method == "announce":
            if not HEX.fullmatch(body["digest"]):
                raise ValueError("invalid announcement")
            self.received.append(
                {"peer": peer, "digest": body["digest"], "status": "quarantined_claim"}
            )
            self.received = self.received[-128:]
            result = {"accepted": "inventory_only", "executed": False}
        else:
            raise ValueError("unknown RPC method")
        return canonical_json(
            self.identity.sign(
                {
                    "protocol": "NOVA-SWARM-REPLY-v1",
                    "request_nonce": payload["nonce"],
                    "body": result,
                }
            )
        )

    async def _read(self, reader):
        length = struct.unpack(">I", await asyncio.wait_for(reader.readexactly(4), 10))[
            0
        ]
        if length > self.max_frame:
            raise ValueError("frame size exceeded")
        return await asyncio.wait_for(reader.readexactly(length), 10)

    async def _serve_connection(self, reader, writer):
        # Reject excess accepted connections instead of accumulating waiters.
        if self.semaphore.locked():
            writer.close()
            return
        async with self.semaphore:
            try:
                reply = await self.handle(await self._read(reader))
                writer.write(struct.pack(">I", len(reply)) + reply)
                await writer.drain()
            except (
                ValueError,
                KeyError,
                TypeError,
                OSError,
                asyncio.IncompleteReadError,
                asyncio.TimeoutError,
            ):
                pass
            finally:
                writer.close()
                await writer.wait_closed()

    async def serve(
        self,
        host="127.0.0.1",
        port=8766,
        *,
        certfile=None,
        keyfile=None,
        transport="tcp",
    ):
        local = host in ("127.0.0.1", "localhost", "::1")
        if not local and not (certfile and keyfile):
            raise ValueError("remote listening requires TLS certificate/key")
        context = None
        if certfile:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(certfile, keyfile)
        if transport == "websocket":
            from websockets.asyncio.server import serve

            async def handler(socket):
                if self.semaphore.locked():
                    await socket.close(code=1013, reason="connection budget exceeded")
                    return
                async with self.semaphore:
                    try:
                        raw = await asyncio.wait_for(socket.recv(), 10)
                        await socket.send(await self.handle(raw))
                    except (
                        ValueError,
                        KeyError,
                        TypeError,
                        OSError,
                        asyncio.TimeoutError,
                    ):
                        await socket.close(code=1008, reason="request rejected")

            async with serve(
                handler,
                host,
                port,
                ssl=context,
                max_size=self.max_frame,
                max_queue=4,
                open_timeout=10,
            ):
                await asyncio.Future()
        elif transport == "tcp":
            server = await asyncio.start_server(
                self._serve_connection,
                host,
                port,
                ssl=context,
                limit=self.max_frame + 4,
                backlog=16,
            )
            async with server:
                await server.serve_forever()
        else:
            raise ValueError("unknown transport")

    async def request(self, peer_id, method, body):
        if peer_id not in self.routing.peers:
            raise ValueError("peer endpoint must be manually pinned")
        peer = self.routing.peers[peer_id]
        url = urlsplit(peer.endpoint)
        envelope = self.message(method, body)
        raw = canonical_json(envelope)
        if len(raw) > self.max_frame:
            raise ValueError("request frame exceeded")
        context = ssl.create_default_context() if url.scheme in ("tls", "wss") else None
        if url.scheme in ("ws", "wss"):
            from websockets.asyncio.client import connect

            async with connect(
                peer.endpoint, ssl=context, max_size=self.max_frame, open_timeout=10
            ) as socket:
                await socket.send(raw)
                reply = await asyncio.wait_for(socket.recv(), 10)
        else:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(
                    url.hostname,
                    url.port,
                    ssl=context,
                    server_hostname=url.hostname if context else None,
                ),
                10,
            )
            try:
                writer.write(struct.pack(">I", len(raw)) + raw)
                await writer.drain()
                reply = await self._read(reader)
            finally:
                writer.close()
                await writer.wait_closed()
        _, payload = SigningIdentity.verify(strict_json(reply, self.max_frame), peer_id)
        if (
            payload.get("protocol") != "NOVA-SWARM-REPLY-v1"
            or payload.get("request_nonce") != envelope["payload"]["nonce"]
        ):
            raise ValueError("reply/request mismatch")
        return payload["body"]

    async def synchronize(self, peer_id, limit=8):
        inventory = await self.request(peer_id, "inventory", {})
        downloaded = []
        for digest in inventory["hashes"][:limit]:
            if not HEX.fullmatch(digest):
                continue
            try:
                self.store.get(digest)
                continue
            except FileNotFoundError:
                pass
            packet = await self.request(peer_id, "get", {"digest": digest})
            data = base64.b64decode(packet["data"], validate=True)
            if len(data) > 512 * 1024 or hashlib.sha256(data).hexdigest() != digest:
                raise ValueError("received object digest/size mismatch")
            self.store.put(data)
            downloaded.append(digest)
        return {
            "downloaded": downloaded,
            "scientific_verification": "pending_local_reverification",
            "automatic_execution": False,
        }

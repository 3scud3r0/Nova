"""Bounded iterative XOR discovery with signed expiring endpoint descriptors.

Kademlia-style routing, not a claim to implement libp2p's wire protocol. Global
bootstrap requires at least one reachable deployment; mDNS is optional LAN only.
"""

from __future__ import annotations
import asyncio
from collections import OrderedDict
import ipaddress
import socket
import time
from urllib.parse import urlsplit
from .artifacts import SigningIdentity, HEX
from .p2p_node import Peer
from nova.bioma.determinism import canonical_json, strict_json


def descriptor(identity, endpoint, ttl=3600):
    Peer(identity.peer_id, endpoint)
    if not 30 <= ttl <= 86400:
        raise ValueError("descriptor TTL out of range")
    return identity.sign(
        {
            "schema": "NOVA-PEER-v1",
            "peer_id": identity.peer_id,
            "endpoint": endpoint,
            "issued": int(time.time()),
            "expires": int(time.time()) + ttl,
        }
    )


class DiscoveryTable:
    def __init__(self, identity, own, *, allow_lan=False, capacity=64):
        if not 1 <= capacity <= 256:
            raise ValueError("discovery capacity exceeded")
        self.identity = identity
        self.own = own
        self.allow_lan = allow_lan
        self.capacity = capacity
        self.descriptors = OrderedDict()
        self.addresses = {}
        self.buckets = {}
        self.verify(own)

    def verify(self, envelope):
        if len(canonical_json(envelope)) > 4096:
            raise ValueError("descriptor byte budget exceeded")
        signer, payload = SigningIdentity.verify(envelope)
        now = time.time()
        if (
            payload.get("schema") != "NOVA-PEER-v1"
            or payload["peer_id"] != signer
            or not now - 86400 <= payload["issued"] <= now + 120
            or not now < payload["expires"] <= payload["issued"] + 86400
        ):
            raise ValueError("invalid/expired descriptor")
        Peer(signer, payload["endpoint"])
        return signer, payload

    def prune(self):
        expired = [
            peer
            for peer, envelope in self.descriptors.items()
            if envelope["payload"]["expires"] <= time.time()
        ]
        for peer in expired:
            self.descriptors.pop(peer, None)
            self.addresses.pop(peer, None)
        for bucket in list(self.buckets):
            self.buckets[bucket] = [p for p in self.buckets[bucket] if p not in expired]

    async def admit(self, envelope):
        self.prune()
        signer, payload = self.verify(envelope)
        if signer == self.identity.peer_id:
            return None
        url = urlsplit(payload["endpoint"])
        addresses = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(
                url.hostname, url.port, type=socket.SOCK_STREAM
            ),
            5,
        )
        ips = sorted({record[4][0] for record in addresses})
        if not ips or (
            not self.allow_lan
            and any(not ipaddress.ip_address(ip).is_global for ip in ips)
        ):
            raise ValueError(
                "discovered endpoint is not public; opt in to LAN separately"
            )
        # Pin a resolved address for the dial, keeping TLS hostname verification.
        peer = Peer(signer, payload["endpoint"], connect_ip=ips[0])
        distance = int(self.identity.peer_id, 16) ^ int(signer, 16)
        bucket = distance.bit_length() - 1
        members = self.buckets.setdefault(bucket, [])
        if signer not in self.descriptors and (
            len(self.descriptors) >= self.capacity or len(members) >= 8
        ):
            return None
        previous = self.descriptors.get(signer)
        if previous and previous["payload"]["issued"] > payload["issued"]:
            return None
        if signer not in members:
            members.append(signer)
        self.descriptors[signer] = envelope
        self.addresses[signer] = peer
        return peer

    def nearest(self, key, limit=8):
        if not HEX.fullmatch(key):
            raise ValueError("invalid lookup key")
        now = time.time()
        peers = [
            key
            for key, envelope in self.descriptors.items()
            if envelope["payload"]["expires"] > now
        ]
        peers.sort(key=lambda peer: int(peer, 16) ^ int(key, 16))
        return [self.descriptors[peer] for peer in peers[: min(limit, 8)]]

    async def discover(self, node, bootstraps=(), *, rounds=4):
        if not 1 <= rounds <= 8 or len(bootstraps) > 32:
            raise ValueError("lookup work budget exceeded")
        for envelope in bootstraps:
            peer = await self.admit(envelope)
            if peer:
                node.admit_discovered(peer)
        queried = set()
        failures = []
        for _ in range(rounds):
            shortlist = [
                p
                for p in node.routing.closest(self.identity.peer_id)
                if p.peer_id not in queried
            ][:3]
            if not shortlist:
                break

            async def visit(peer):
                queried.add(peer.peer_id)
                try:
                    hello = await node.request(
                        peer.peer_id, "hello", {"descriptor": self.own}
                    )
                    candidate = await self.admit(hello["descriptor"])
                    if candidate:
                        node.admit_discovered(candidate)
                    reply = await node.request(
                        peer.peer_id, "lookup", {"key": self.identity.peer_id}
                    )
                    if len(reply["descriptors"]) > 8:
                        raise ValueError("lookup fanout exceeded")
                    for item in reply["descriptors"]:
                        candidate = await self.admit(item)
                        if candidate:
                            node.admit_discovered(candidate)
                except (
                    ValueError,
                    KeyError,
                    TypeError,
                    OSError,
                    asyncio.TimeoutError,
                ) as error:
                    failures.append(
                        {"peer": peer.peer_id, "error": type(error).__name__}
                    )

            await asyncio.gather(*(visit(peer) for peer in shortlist))
        return {
            "routing_peers": len(node.routing.peers),
            "queried": len(queried),
            "failures": failures,
            "global_connectivity_proved": False,
            "bootstrap_required": not bool(queried),
        }


class LanDiscovery:
    """Optional DNS-SD/mDNS on the local network; no WAN NAT traversal claim."""

    service = "_nova-cosm._tcp.local."

    def __init__(self, own):
        self.own = own
        self.found = []
        self.registration = None
        self.browser = None
        self.zeroconf = None
        self.tasks = set()

    async def start(self, advertise_ip, port):
        from zeroconf import ServiceInfo
        from zeroconf.asyncio import (
            AsyncZeroconf,
            AsyncServiceBrowser,
            AsyncServiceInfo,
        )

        address = ipaddress.ip_address(advertise_ip)
        if address.is_loopback or address.is_unspecified:
            raise ValueError("mDNS requires an explicit LAN interface address")
        raw = canonical_json(self.own)
        if len(raw) > 2048:
            raise ValueError("mDNS descriptor too large")
        properties = {
            f"chunk{i}".encode(): raw[i * 200 : (i + 1) * 200]
            for i in range((len(raw) + 199) // 200)
        }
        peer = self.own["payload"]["peer_id"]
        self.zeroconf = AsyncZeroconf()
        self.registration = ServiceInfo(
            self.service,
            peer[:16] + "." + self.service,
            addresses=[address.packed],
            port=port,
            properties=properties,
        )
        await self.zeroconf.async_register_service(self.registration)

        async def resolve(name):
            info = AsyncServiceInfo(self.service, name)
            if await info.async_request(self.zeroconf.zeroconf, 2000):
                raw = b"".join(
                    info.properties.get(f"chunk{i}".encode(), b"") for i in range(11)
                )
                try:
                    envelope = strict_json(raw, 2048)
                    SigningIdentity.verify(envelope)
                    if len(self.found) < 64:
                        self.found.append(envelope)
                except (ValueError, KeyError, TypeError):
                    pass

        loop = asyncio.get_running_loop()

        def schedule(name):
            if len(self.tasks) >= 32:
                return
            task = asyncio.create_task(resolve(name))
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)

        def changed(zeroconf, service_type, name, state_change):
            if name != self.registration.name and state_change.name in (
                "Added",
                "Updated",
            ):
                loop.call_soon_threadsafe(schedule, name)

        self.browser = AsyncServiceBrowser(
            self.zeroconf.zeroconf, self.service, handlers=[changed]
        )

    async def close(self):
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        if self.browser:
            await self.browser.async_cancel()
        if self.zeroconf:
            if self.registration:
                await self.zeroconf.async_unregister_service(self.registration)
            await self.zeroconf.async_close()

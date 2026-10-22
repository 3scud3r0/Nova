"""Signed bounded genome migration with quarantine, provenance and local admission."""

import hashlib
import time
import numpy as np
from nova.bioma.determinism import canonical_json, SplitMix64
from nova.bioma.genetics import MorphogeneticCPPN
from .artifacts import SigningIdentity


def make_spore(identity, genome, origin, *, ttl=3600):
    if not 30 <= ttl <= 86400:
        raise ValueError("spore TTL invalid")
    return identity.sign(
        {
            "schema": "NOVA-SPORE-v1",
            "genome": genome.state_dict(),
            "genome_sha256": genome.hash(),
            "origin": dict(origin),
            "issued": int(time.time()),
            "expires": int(time.time()) + ttl,
            "meaning": "developmental genome; trained neural state and skills are not transferred",
        }
    )


class SporeMigration:
    def __init__(
        self,
        identity,
        *,
        enabled=False,
        max_pending=16,
        max_imports=32,
        cooldown_ticks=64,
    ):
        self.identity = identity
        self.enabled = enabled
        self.max_pending = max_pending
        self.max_imports = max_imports
        self.cooldown = cooldown_ticks
        if (
            not 1 <= max_pending <= 64
            or not 1 <= max_imports <= 256
            or not 1 <= cooldown_ticks <= 4096
        ):
            raise ValueError("migration budget invalid")
        self.pending = {}
        self.seen = set()
        self.imports = 0
        self.last_tick = -cooldown_ticks
        self.records = []

    def receive(self, envelope, expected_peer):
        peer, payload = SigningIdentity.verify(envelope, expected_peer)
        raw = canonical_json(envelope)
        if (
            len(raw) > 131072
            or len(self.pending) >= self.max_pending
            or len(self.seen) >= 4096
        ):
            raise ValueError("spore queue/size/history budget exceeded")
        if (
            payload.get("schema") != "NOVA-SPORE-v1"
            or not time.time() < payload["expires"] <= payload["issued"] + 86400
            or payload["issued"] > time.time() + 120
        ):
            raise ValueError("spore schema/deadline invalid")
        genome = MorphogeneticCPPN.from_state_dict(payload["genome"])
        if genome.hash() != payload["genome_sha256"]:
            raise ValueError("spore genome digest differs")
        if (
            genome.config.neural_nodes > 64
            or genome.config.max_n2 > 2
            or genome.config.body_resolution > 16
        ):
            raise ValueError("immigrant development budget exceeded")
        digest = hashlib.sha256(raw).hexdigest()
        if digest in self.seen:
            raise ValueError("replayed spore")
        self.seen.add(digest)
        self.pending[digest] = {"envelope": envelope, "peer": peer}
        return {
            "spore": digest,
            "status": "quarantined",
            "automatic_admission_enabled": self.enabled,
        }

    def admit(self, ecosystem):
        if (
            not self.enabled
            or not self.pending
            or self.imports >= self.max_imports
            or ecosystem.world.tick - self.last_tick < self.cooldown
        ):
            return None
        if len(ecosystem.organisms) >= ecosystem.config.max_population:
            return None
        key = next(iter(self.pending))
        item = self.pending.pop(key)
        payload = item["envelope"]["payload"]
        if payload["expires"] <= time.time():
            return {"status": "expired", "spore": key}
        genome = MorphogeneticCPPN.from_state_dict(payload["genome"])
        # Admission is a data-only, recorded simulation event. Replay retains the
        # genome and position; wall-clock signature checks do not enter replay.
        position = SplitMix64(int(key[:16], 16)).uniform(
            (ecosystem.world.ndim,)
        ) * np.asarray(ecosystem.world.shape)
        event = {
            "tick": ecosystem.world.tick,
            "kind": "immigrate",
            "genome": genome.state_dict(),
            "position": position.tolist(),
            "energy": ecosystem.config.initial_energy,
            "spore_sha256": key,
            "source_peer": item["peer"],
        }
        ecosystem.apply_event(event)
        self.imports += 1
        self.last_tick = ecosystem.world.tick
        record = {
            "status": "admitted",
            "spore": key,
            "genome": genome.hash(),
            "source_peer": item["peer"],
            "tick": ecosystem.world.tick,
        }
        self.records.append(record)
        return record

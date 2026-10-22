"""Replay manifests bind seeds to algorithms, parameters, genomes and event logs."""

from __future__ import annotations
from dataclasses import asdict
import hashlib
from pathlib import Path
import numpy as np
from nova import __version__
from nova.bioma.determinism import canonical_json, environment_fingerprint
from nova.bioma.physics_engine import PhysicsConfig
from nova.bioma.ecosystem import Ecosystem, EcosystemConfig
from .artifacts import SigningIdentity


def engine_digest():
    root = Path(__file__).resolve().parents[1]
    digest = hashlib.sha256()
    for file in sorted(root.rglob("*.py")):
        digest.update(file.relative_to(root).as_posix().encode())
        digest.update(file.read_bytes())
    return digest.hexdigest()


class HoloSeed:
    """A full bounded manifest, not a 64-byte encoding of arbitrary state.

    A SHA-256 address is 32 bytes; it locates referenced content but cannot
    reconstruct that content without the matching artifacts and engine.
    Float64 does not imply portable bit-identical execution.
    """

    protocol = "NOVA-HOLOSEED-v1"

    @classmethod
    def pack(
        cls,
        ecosystem: Ecosystem,
        *,
        initial_genomes=None,
        tier="same_environment",
        identity=None,
    ):
        if tier not in ("strict_integer", "same_environment"):
            raise ValueError("unsupported replay tier")
        world = ecosystem.world
        if tier == "strict_integer" and (
            world.config.mode not in ("conway", "fixed_gray_scott")
            or ecosystem.config.initial_population != 0
            or ecosystem.organisms
            or ecosystem.events
        ):
            raise ValueError(
                "strict integer replay requires a field-only integer mode and no external events"
            )
        if initial_genomes is not None:
            raise ValueError(
                "set custom genomes at Ecosystem genesis, not after simulation"
            )
        expected = (
            world.state_hash() if tier == "strict_integer" else ecosystem.state_hash()
        )
        payload = {
            "protocol": cls.protocol,
            "engine_version": __version__,
            "engine_sha256": engine_digest(),
            "physics": asdict(world.config),
            "ecosystem": asdict(ecosystem.config),
            "seed": world.config.seed,
            "ticks": world.tick,
            "events": ecosystem.events,
            "reproducibility": tier,
            "environment": environment_fingerprint(),
            "expected_state_sha256": expected,
            "genesis": "seeded_engine_v1",
            "initial_genomes": ecosystem.genesis_genomes,
            "note": "Digest equality verifies this encoded replay, not a scientific theorem.",
        }
        if len(canonical_json(payload)) > 260000:
            raise ValueError(
                "genesis manifest exceeds packet budget; use a checkpoint artifact"
            )
        return (
            identity.sign(payload)
            if identity
            else {"payload": payload, "unsigned": True}
        )

    @classmethod
    def validate(
        cls,
        envelope,
        *,
        max_ticks=10000,
        max_cells=262144,
        max_population=32,
        require_signature=False,
        max_cell_updates=67108864,
        max_agent_ticks=32768,
    ):
        if len(canonical_json(envelope)) > 262144:
            raise ValueError("manifest exceeds packet budget")
        if require_signature or not envelope.get("unsigned"):
            SigningIdentity.verify(envelope)
        payload = envelope["payload"]
        if (
            payload.get("protocol") != cls.protocol
            or payload.get("genesis") != "seeded_engine_v1"
        ):
            raise ValueError("unknown seed protocol/genesis")
        if (
            not isinstance(payload["ticks"], int)
            or not 0 <= payload["ticks"] <= max_ticks
        ):
            raise ValueError("replay tick budget exceeded")
        physics = payload["physics"].copy()
        physics["shape"] = tuple(physics["shape"])
        physics["birth"] = tuple(physics["birth"])
        physics["survive"] = tuple(physics["survive"])
        config = PhysicsConfig(**physics)
        eco = EcosystemConfig(**payload["ecosystem"])
        if (
            int(np.prod(config.shape)) > max_cells
            or eco.max_population > max_population
            or len(payload["events"]) > 10000
            or int(np.prod(config.shape)) * payload["ticks"] > max_cell_updates
            or eco.max_population * payload["ticks"] > max_agent_ticks
        ):
            raise ValueError("replay resource budget exceeded")
        if payload["seed"] != config.seed:
            raise ValueError("seed mismatch")
        if payload["reproducibility"] == "strict_integer" and (
            config.mode not in ("conway", "fixed_gray_scott")
            or eco.initial_population
            or payload["events"]
        ):
            raise ValueError("invalid strict-integer replay declaration")
        if payload["reproducibility"] not in ("strict_integer", "same_environment"):
            raise ValueError("unknown reproducibility tier")
        genomes = payload.get("initial_genomes")
        if genomes is not None:
            from nova.bioma.genetics import MorphogeneticCPPN

            if not isinstance(genomes, list) or len(genomes) != eco.initial_population:
                raise ValueError("genesis genome population mismatch")
            for genome in genomes:
                MorphogeneticCPPN.from_state_dict(genome)
        return payload, config, eco

    @classmethod
    def reproduce(cls, envelope, **budgets):
        payload, physics, config = cls.validate(envelope, **budgets)
        if payload["engine_sha256"] != engine_digest():
            raise ValueError("engine digest differs; replay is not claimed equivalent")
        if payload["engine_version"] != __version__:
            raise ValueError("engine version mismatch")
        if (
            payload["reproducibility"] == "same_environment"
            and payload["environment"] != environment_fingerprint()
        ):
            raise ValueError("floating environment fingerprint mismatch")
        ecosystem = Ecosystem(
            physics, config, genesis_genomes=payload.get("initial_genomes")
        )
        events = {}
        for event in payload["events"]:
            events.setdefault(event["tick"], []).append(event)
        if any(
            not isinstance(t, int) or not 0 <= t <= payload["ticks"] for t in events
        ):
            raise ValueError("event log clock out of range")
        for tick in range(payload["ticks"]):
            for event in events.get(tick, []):
                ecosystem.apply_event(event)
            ecosystem.step()
        for event in events.get(payload["ticks"], []):
            ecosystem.apply_event(event)
        digest = (
            ecosystem.world.state_hash()
            if payload["reproducibility"] == "strict_integer"
            else ecosystem.state_hash()
        )
        return ecosystem, {
            "status": "matched"
            if digest == payload["expected_state_sha256"]
            else "mismatch",
            "expected": payload["expected_state_sha256"],
            "observed": digest,
            "tier": payload["reproducibility"],
            "scientific_truth_proved": False,
        }

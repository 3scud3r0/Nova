"""Resident native f32 fields; this backend is distinct from v0.3 float64 physics."""

from dataclasses import dataclass
from pathlib import Path
import numpy as np
from . import require_native
from nova.bioma.determinism import SplitMix64, digest_arrays, canonical_json


@dataclass(frozen=True)
class ResidentConfig:
    size: int = 32
    seed: int = 0
    backend: str = "rust"
    fluid: bool = False
    max_bytes: int = 536870912
    pressure_iterations: int = 32

    def __post_init__(self):
        if (
            self.backend not in ("rust", "webgpu")
            or not 4 <= self.size <= 256
            or 144 * self.size**3 > self.max_bytes
            or not 1 <= self.pressure_iterations <= 256
        ):
            raise ValueError("native grid/backend/memory budget exceeded")
        SplitMix64(self.seed)


class ResidentSimulation:
    """One native call advances multiple ticks. Snapshot is an explicit readback.

    The viewer reads back each requested frame; no zero-copy or FPS guarantee.
    Python organisms are not silently moved into this independent field solver.
    """

    def __init__(self, config=ResidentConfig()):
        self.resident_config = config
        n = config.size
        self.shape = (n,) * 3
        self.ndim = 3
        self.world = self
        self.organisms = []
        self.config = type(
            "ViewConfig", (), {"mode": "gray_scott", "seed": config.seed}
        )()
        raw = np.zeros((*self.shape, 2), dtype=np.float32)
        raw[..., 0] = 1
        r = max(1, n // 8)
        region = (slice(n // 2 - r, n // 2 + r),) * 3
        raw[region + (1,)] = SplitMix64(config.seed).uniform((2 * r,) * 3, 0.2, 0.8)
        module = require_native()
        kind = "NativeField" if config.backend == "rust" else "GpuField"
        if not hasattr(module, kind):
            raise RuntimeError(
                f"{kind} unavailable; rebuild nova-core with the required feature"
            )
        self.engine = getattr(module, kind)(n, raw.ravel().tolist(), config.max_bytes)
        self.refresh()

    def refresh(self):
        chemistry, flow, wave, self.tick = self.engine.snapshot()
        self.u, self.v = np.moveaxis(
            np.asarray(chemistry, dtype=np.float32).reshape((*self.shape, 2)), -1, 0
        )
        self.velocity = np.moveaxis(
            np.asarray(flow, dtype=np.float32).reshape((*self.shape, 3)), -1, 0
        )
        self.wave = np.asarray(wave, dtype=np.float32).reshape(self.shape)

    def step(self, ticks=1):
        self.engine.step(
            steps=ticks,
            fluid=self.resident_config.fluid,
            pressure_iterations=self.resident_config.pressure_iterations,
        )
        self.refresh()
        return self.metrics()

    def metrics(self):
        divergence = sum(
            self.velocity[a] - np.roll(self.velocity[a], 1, axis=2 - a)
            for a in range(3)
        )
        return {
            "tick": self.tick,
            "backend": self.resident_config.backend,
            "dtype": "float32",
            "cells": self.resident_config.size**3,
            "population": 0,
            "mass_v": float(self.v.sum(dtype=np.float64)),
            "kinetic": float(0.5 * np.sum(self.velocity.astype(float) ** 2)),
            "divergence_rms": float(np.sqrt(np.mean(divergence.astype(float) ** 2))),
            "pressure_iterations": self.resident_config.pressure_iterations,
            "adapter": getattr(self.engine, "adapter", "native CPU Rayon"),
            "fps_measured": False,
            "power_measured": False,
        }

    def save(self, path):
        from dataclasses import asdict

        arrays = {
            "u": self.u,
            "v": self.v,
            "velocity": self.velocity,
            "wave": self.wave,
        }
        metadata = {
            "config": asdict(self.resident_config),
            "tick": self.tick,
            "reproducibility": "f32_backend_specific_snapshot_only",
        }
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            target, **arrays, manifest=np.array(canonical_json(metadata).decode())
        )
        return {
            "checkpoint": str(target),
            "state_sha256": digest_arrays(arrays, metadata),
            "resumable": False,
        }


def cppn_native(genome, features):
    return np.asarray(
        require_native().cppn_batch(
            np.asarray(features, dtype=float).reshape(-1, 8).tolist(),
            genome.w_in.ravel().tolist(),
            [w.ravel().tolist() for w in genome.weights],
            [b.tolist() for b in genome.biases],
            genome.activations.tolist(),
            genome.w_out.ravel().tolist(),
            genome.config.width,
        )
    )


def independent_hh_native(state, currents, dt=0.01):
    return np.asarray(
        require_native().hh_batch(
            np.asarray(state, dtype=float).tolist(),
            np.asarray(currents, dtype=float).tolist(),
            dt,
        )
    )

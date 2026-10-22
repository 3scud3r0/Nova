"""Actual directed species affinity forces with periodic spatial cell lists."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from nova.bioma.determinism import SplitMix64, digest_state


@dataclass(frozen=True)
class ParticleLifeConfig:
    count: int = 2048
    species: int = 8
    seed: int = 42
    cutoff: float = 0.18
    repulsion_radius: float = 0.25
    strength: float = 4.0
    damping: float = 1.8
    dt: float = 1 / 120
    max_speed: float = 1.5
    normalize_neighbors: bool = True
    max_neighbors: int = 2048

    def __post_init__(self):
        if (
            not 2 <= self.count <= 100000
            or not 1 <= self.species <= 8
            or not 0.06 <= self.cutoff <= 0.4
            or not 0.05 <= self.repulsion_radius <= 0.6
            or not 0 < self.strength <= 30
            or not 0 <= self.damping <= 20
            or not 0 < self.dt <= 1 / 30
            or not 0 < self.max_speed <= 5
            or not 16 <= self.max_neighbors <= 4096
        ):
            raise ValueError("particle law/resource budget exceeded")
        SplitMix64(self.seed)


def affinity_matrix(seed, species=8, symmetric=False):
    matrix = SplitMix64(seed ^ 0xAFF1717).uniform((8, 8), -1, 1)
    matrix[np.diag_indices(8)] = 0.7
    if symmetric:
        matrix = (matrix + matrix.T) * 0.5
    return matrix


def radial_force(q, affinity, beta=0.25):
    q = np.asarray(q, dtype=float)
    return np.where(
        q < beta, q / beta - 1, affinity * (1 - np.abs(2 * q - 1 - beta) / (1 - beta))
    ) * (q < 1)


class ParticleLife:
    """CPU reference, not the 100k browser backend.

    Directed affinities are active/nonconservative; damping exports energy.
    Neighbor truncation is counted, never described as an exact full solve.
    """

    def __init__(self, config=None, matrix=None):
        self.config = config or ParticleLifeConfig()
        c = self.config
        rng = SplitMix64(c.seed)
        self.position = rng.uniform((c.count, 3), -1, 1)
        self.velocity = np.zeros_like(self.position)
        self.types = rng.integers(0, c.species, (c.count,))
        self.matrix = (
            affinity_matrix(c.seed, c.species)
            if matrix is None
            else np.asarray(matrix, dtype=float)
        )
        if (
            self.matrix.shape != (8, 8)
            or not np.isfinite(self.matrix).all()
            or np.any(abs(self.matrix) > 1)
        ):
            raise ValueError("8x8 affinity matrix in [-1,1] required")
        self.tick = 0
        self.truncated = 0
        self.speed_clamps = 0

    def step(self, steps=1):
        if not 1 <= steps <= 4096 or self.config.count > 8192:
            raise ValueError(
                "CPU reference work budget exceeded; use browser compute for larger scenes"
            )
        c = self.config
        dim = max(1, int(2 / c.cutoff))
        cell_width = 2 / dim
        for _ in range(steps):
            buckets = {}
            cell = np.floor((self.position + 1) / cell_width).astype(int) % dim
            for i, key in enumerate(map(tuple, cell)):
                buckets.setdefault(key, []).append(i)
            acceleration = np.zeros_like(self.position)
            for i in range(c.count):
                candidates = []
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for dz in (-1, 0, 1):
                            candidates.extend(
                                buckets.get(tuple((cell[i] + [dx, dy, dz]) % dim), ())
                            )
                if len(candidates) > c.max_neighbors:
                    self.truncated += 1
                    candidates = candidates[: c.max_neighbors]
                ids = np.asarray(candidates, dtype=int)
                delta = self.position[ids] - self.position[i]
                delta -= 2 * np.round(delta / 2)
                distance = np.linalg.norm(delta, axis=1)
                keep = (distance > 1e-9) & (distance < c.cutoff)
                ids = ids[keep]
                delta = delta[keep]
                distance = distance[keep]
                if len(ids):
                    weights = radial_force(
                        distance / c.cutoff,
                        self.matrix[self.types[i], self.types[ids]],
                        c.repulsion_radius,
                    )
                    acceleration[i] = (
                        c.strength
                        * np.sum(delta / distance[:, None] * weights[:, None], axis=0)
                        / (max(1, len(ids)) if c.normalize_neighbors else 1)
                    )
            self.velocity = (self.velocity + c.dt * acceleration) * np.exp(
                -c.damping * c.dt
            )
            speed = np.linalg.norm(self.velocity, axis=1)
            self.speed_clamps += int(np.count_nonzero(speed > c.max_speed))
            self.velocity *= np.minimum(1, c.max_speed / np.maximum(speed, 1e-12))[
                :, None
            ]
            self.position = (self.position + c.dt * self.velocity + 1) % 2 - 1
            self.tick += 1
        return self.metrics()

    def metrics(self):
        return {
            "tick": self.tick,
            "particles": self.config.count,
            "kinetic_proxy": float(0.5 * np.sum(self.velocity**2)),
            "truncated_queries": self.truncated,
            "speed_clamps": self.speed_clamps,
            "conservative": False,
        }

    def save(self, path):
        from nova.checkpoint import save_state

        state = {
            "kind": "NOVA-PARTICLE-LIFE-CPU-v1",
            "config": asdict(self.config),
            "position": self.position,
            "velocity": self.velocity,
            "types": self.types,
            "matrix": self.matrix,
            "tick": self.tick,
            "truncated": self.truncated,
            "speed_clamps": self.speed_clamps,
        }
        save_state(path, state)
        return {
            "checkpoint": str(path),
            "state_sha256": digest_state(state),
        }

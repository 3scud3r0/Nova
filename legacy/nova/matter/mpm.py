"""Small CPU MLS-MPM/APIC/FLIP reference with explicit constitutive choices.

Not the real-time browser solver. Free-surface incompressibility, exact angular
momentum under walls/clipping and fully resolved FSI are not asserted.
"""

from dataclasses import dataclass
from itertools import product

import numpy as np

from nova.bioma.determinism import SplitMix64

from .constitutive import (
    herschel_bulkley,
    saint_venant_kirchhoff,
    thixotropic_structure,
)


@dataclass(frozen=True)
class MPMConfig:
    particles: int = 512
    grid: int = 24
    dt: float = 0.001
    density: float = 1.0
    mu: float = 10.0
    lam: float = 10.0
    bulk: float = 20.0
    gravity: float = -1.0
    material: str = "liquid"
    flip: float = 0.9
    seed: int = 42

    def __post_init__(self):
        if (
            not 8 <= self.particles <= 8192
            or not 8 <= self.grid <= 48
            or not 0 < self.dt <= 0.005
            or self.material not in ("liquid", "stvk")
            or min(self.mu, self.lam, self.bulk) < 0
            or not self.density > 0
            or not 0 <= self.flip <= 1
            or not np.isfinite(
                [self.dt, self.density, self.mu, self.lam, self.bulk, self.gravity]
            ).all()
        ):
            raise ValueError("MPM resource/material budget exceeded")


class MaterialPointSystem:
    def __init__(self, config=None):
        self.config = config or MPMConfig()
        c = self.config
        rng = SplitMix64(c.seed)
        self.x = rng.uniform((c.particles, 3), 0.3, 0.7)
        self.v = np.zeros_like(self.x)
        self.C = np.zeros((c.particles, 3, 3))
        self.F = np.repeat(np.eye(3)[None], c.particles, axis=0)
        self.structure = np.ones(c.particles)
        self.tick = 0
        self.projected_singular_values = 0
        self.wall_impulse = np.zeros(3)
        self.mass = c.density * 0.4**3 / c.particles
        self.volume = self.mass / c.density

    def step(self, steps=1):
        c = self.config
        dx = 1 / c.grid
        dt = c.dt
        if not 1 <= steps <= 1000:
            raise ValueError("MPM step budget exceeded")
        for _ in range(steps):
            wave_speed = np.sqrt((c.lam + 2 * c.mu + c.bulk) / c.density)
            if dt * (wave_speed + np.linalg.norm(self.v, axis=1).max()) / dx > 0.4:
                raise ValueError("MPM explicit CFL condition exceeded")
            mass = np.zeros((c.grid,) * 3)
            momentum = np.zeros((*mass.shape, 3))
            initial_momentum = np.zeros_like(momentum)
            base = np.floor(self.x / dx - 0.5).astype(int)
            fx = self.x / dx - base
            weights = np.stack(
                (0.5 * (1.5 - fx) ** 2, 0.75 - (fx - 1) ** 2, 0.5 * (fx - 0.5) ** 2),
                axis=1,
            )
            D = 0.5 * (self.C + np.swapaxes(self.C, 1, 2))
            shear = np.sqrt(2 * np.sum(D * D, axis=(1, 2)))
            self.structure = thixotropic_structure(self.structure, shear, dt)
            if c.material == "stvk":
                P, _ = saint_venant_kirchhoff(self.F, c.mu, c.lam)
                stress = P @ np.swapaxes(self.F, 1, 2)
            else:
                J = np.linalg.det(self.F)
                pressure = c.bulk * (np.clip(J, 0.5, 2.0) ** -4 - 1)
                eta = herschel_bulkley(shear, structure=self.structure)
                stress = (
                    -pressure[:, None, None] * np.eye(3) + 2 * eta[:, None, None] * D
                )
            affine = self.mass * self.C - dt * self.volume * 4 / dx**2 * stress
            records = []
            for offset in product(range(3), repeat=3):
                node = base + offset
                if np.any(node < 0) or np.any(node >= c.grid):
                    raise ValueError(
                        "MPM support crossed grid; reduce step or maintain boundary margin"
                    )
                w = (
                    weights[:, offset[0], 0]
                    * weights[:, offset[1], 1]
                    * weights[:, offset[2], 2]
                )
                dpos = (np.asarray(offset) - fx) * dx
                index = tuple(node.T)
                np.add.at(mass, index, w * self.mass)
                carrier = self.mass * self.v + np.einsum(
                    "nij,nj->ni", self.mass * self.C, dpos
                )
                np.add.at(initial_momentum, index, w[:, None] * carrier)
                np.add.at(
                    momentum,
                    index,
                    w[:, None]
                    * (self.mass * self.v + np.einsum("nij,nj->ni", affine, dpos)),
                )
                records.append((index, w, dpos))
            occupied = mass > 0
            old = np.zeros_like(momentum)
            new = np.zeros_like(momentum)
            old[occupied] = initial_momentum[occupied] / mass[occupied, None]
            new[occupied] = momentum[occupied] / mass[occupied, None]
            new[..., 1][occupied] += dt * c.gravity
            coordinates = np.indices(mass.shape)
            for axis in range(3):
                hit = occupied & (
                    ((coordinates[axis] < 2) & (new[..., axis] < 0))
                    | ((coordinates[axis] > c.grid - 3) & (new[..., axis] > 0))
                )
                self.wall_impulse[axis] -= np.sum(mass[hit] * new[..., axis][hit])
                new[..., axis][hit] = 0
            pic = np.zeros_like(self.v)
            delta = np.zeros_like(self.v)
            C = np.zeros_like(self.C)
            for index, w, dpos in records:
                vg = new[index]
                pic += w[:, None] * vg
                delta += w[:, None] * (vg - old[index])
                C += 4 / dx**2 * w[:, None, None] * vg[:, :, None] * dpos[:, None, :]
            self.v = (1 - c.flip) * pic + c.flip * (self.v + delta)
            self.C = C
            self.x += dt * self.v
            self.x = np.clip(self.x, 1.6 * dx, 1 - 2.6 * dx)
            trial = (np.eye(3) + dt * self.C) @ self.F
            if np.any(np.linalg.det(trial) <= 0):
                raise ValueError("orientation-reversing MPM step; reduce dt")
            U, s, Vt = np.linalg.svd(trial)
            clipped = np.clip(s, 0.6, 1.4)
            self.projected_singular_values += int(np.count_nonzero(clipped != s))
            self.F = (U * clipped[:, None, :]) @ Vt
            if not all(np.isfinite(v).all() for v in (self.x, self.v, self.F)):
                raise FloatingPointError("nonfinite MPM state")
            self.tick += 1
        return self.metrics()

    def metrics(self):
        return {
            "tick": self.tick,
            "mass": self.mass * len(self.x),
            "momentum": (self.mass * self.v.sum(0)).tolist(),
            "angular_momentum": (self.mass * np.cross(self.x, self.v).sum(0)).tolist(),
            "kinetic": float(0.5 * self.mass * np.sum(self.v**2)),
            "mean_structure": float(self.structure.mean()),
            "projected_singular_values": self.projected_singular_values,
            "wall_impulse": self.wall_impulse.tolist(),
            "incompressibility": "equation of state; no exact pressure projection",
        }

"""Explicit numerical substrates: reaction/diffusion, life, fluid, wave, particles.

All quantities are nondimensional. Fluid is periodic incompressible flow using
semi-Lagrangian advection and spectral pressure projection, not a turbulence or
molecular simulator. Stability/clipping diagnostics are part of the state.
"""

from __future__ import annotations
from dataclasses import dataclass, asdict
from fractions import Fraction
from itertools import product
import numpy as np
from scipy.ndimage import map_coordinates
from .determinism import SplitMix64, digest_arrays


@dataclass(frozen=True)
class PhysicsConfig:
    mode: str = "gray_scott"
    shape: tuple[int, ...] = (32, 32, 32)
    seed: int = 0
    dt: float = 0.1
    dx: float = 1.0
    feed: float = 0.035
    kill: float = 0.065
    diffusion_u: float = 0.16
    diffusion_v: float = 0.08
    viscosity: float = 0.02
    thermal_diffusion: float = 0.01
    wave_speed: float = 1.0
    wave_damping: float = 0.02
    lenia_radius: float = 4.0
    lenia_mu: float = 0.15
    lenia_sigma: float = 0.035
    birth: tuple[int, ...] = ()
    survive: tuple[int, ...] = ()
    particles: int = 128
    max_cells: int = 262144
    max_particles: int = 4096
    max_substeps: int = 128

    def __post_init__(self):
        if (
            not 1 <= self.max_cells <= 262144
            or not 0 <= self.max_particles <= 4096
            or not 1 <= self.max_substeps <= 128
        ):
            raise ValueError("absolute allocation/iteration budget exceeded")
        if self.mode not in (
            "gray_scott",
            "fixed_gray_scott",
            "lenia",
            "conway",
            "fluid",
            "wave",
            "particles",
            "hybrid",
            "nca",
        ):
            raise ValueError("unknown field mode")
        if len(self.shape) not in (2, 3) or any(
            not isinstance(n, int) or not 4 <= n <= 128 for n in self.shape
        ):
            raise ValueError("shape requires 2/3 dimensions in [4,128]")
        if (
            int(np.prod(self.shape)) > self.max_cells
            or not 0 <= self.particles <= self.max_particles
        ):
            raise ValueError("field/particle budget exceeded")
        values = (
            self.dt,
            self.dx,
            self.feed,
            self.kill,
            self.diffusion_u,
            self.diffusion_v,
            self.viscosity,
            self.thermal_diffusion,
            self.wave_speed,
            self.wave_damping,
            self.lenia_radius,
            self.lenia_sigma,
        )
        if (
            any(not np.isfinite(v) or not 0 <= v <= 1000 for v in values)
            or min(self.dt, self.dx, self.lenia_radius, self.lenia_sigma) <= 0
            or self.max_substeps < 1
        ):
            raise ValueError("invalid physical scales")
        if not 1e-3 <= self.dx <= 1e3 or not 1e-6 <= self.dt <= 10:
            raise ValueError("spatial/time scale budget exceeded")
        if self.mode == "fixed_gray_scott" and (
            self.dx != 1
            or self.dt < 1 / (1 << 16)
            or self.dt > 1
            or max(self.feed, self.kill, self.diffusion_u, self.diffusion_v) > 1
        ):
            raise ValueError("fixed-point coefficients must be in [0,1], dt<=1")
        SplitMix64(self.seed)


class PhysicsEngine:
    protocol = "NOVA-FIELD-v1"
    Q = 1 << 16

    def __init__(self, config: PhysicsConfig | None = None):
        self.config = config or PhysicsConfig()
        c = self.config
        self.shape = tuple(c.shape)
        self.ndim = len(self.shape)
        self.rng = SplitMix64(c.seed)
        self.tick = 0
        self.elapsed = 0.0
        self.diagnostics = {
            "clipped_values": 0,
            "external_nutrient": 0.0,
            "substeps": 0,
        }
        self.u = np.ones(self.shape)
        self.v = np.zeros(self.shape)
        center = tuple(
            slice(n // 2 - max(1, n // 8), n // 2 + max(1, n // 8)) for n in self.shape
        )
        self.v[center] = self.rng.uniform(self.v[center].shape, 0.2, 0.8)
        self.life = (self.rng.integers(0, 4, self.shape) == 0).astype(np.uint8)
        self.fixed_u = np.full(self.shape, self.Q, dtype=np.int64)
        self.fixed_v = np.zeros(self.shape, dtype=np.int64)
        self.fixed_v[center] = SplitMix64(c.seed ^ 0xF17ED).integers(
            self.Q // 5, 4 * self.Q // 5, self.v[center].shape
        )
        if c.mode == "fixed_gray_scott":
            self.v = self.fixed_v.astype(float) / self.Q
        self.velocity = np.zeros((self.ndim, *self.shape))
        self.temperature = np.zeros(self.shape)
        self.pressure = np.zeros(self.shape)
        self.wave = np.zeros(self.shape)
        self.wave_velocity = np.zeros(self.shape)
        self.channels = np.zeros((4, *self.shape))
        self.channels[0] = self.v
        self.particle_positions = self.rng.uniform(
            (c.particles, self.ndim)
        ) * np.asarray(self.shape)
        self.particle_velocity = np.zeros_like(self.particle_positions)
        self._coordinates = np.indices(self.shape, dtype=float)
        ks = []
        for axis, n in enumerate(self.shape):
            frequency = 2 * np.pi * np.fft.fftfreq(n, d=c.dx)
            if n % 2 == 0:
                frequency[n // 2] = 0  # real spectral derivative of Nyquist modes
            view = [1] * self.ndim
            view[axis] = n
            ks.append(frequency.reshape(view))
        self._k = ks
        self._k2 = sum(k * k for k in ks)
        radius = np.sqrt(
            sum(
                np.minimum(a, n - a) ** 2 for a, n in zip(self._coordinates, self.shape)
            )
        )
        kernel = np.exp(-0.5 * ((radius / c.lenia_radius - 0.5) / 0.15) ** 2) * (
            radius < c.lenia_radius
        )
        self._lenia_kernel = np.fft.fftn(kernel / max(kernel.sum(), 1e-12))
        self._nca_weights = self.rng.uniform((8, 4), -0.08, 0.08)

    def laplacian(self, x):
        return (
            sum(np.roll(x, 1, a) + np.roll(x, -1, a) - 2 * x for a in range(self.ndim))
            / self.config.dx**2
        )

    def _clip(self, x, low=0.0, high=1.0):
        self.diagnostics["clipped_values"] += int(
            np.count_nonzero((x < low) | (x > high))
        )
        return np.clip(x, low, high)

    def sample(self, field, positions):
        positions = np.asarray(positions, dtype=float)
        return map_coordinates(
            field, positions.T, order=1, mode="grid-wrap", prefilter=False
        )

    def inject(self, position, *, nutrient=0.0, heat=0.0, signal=0.0, impulse=None):
        index = tuple(
            (np.floor(position).astype(int) % np.asarray(self.shape)).tolist()
        )
        self.v[index] = float(np.clip(self.v[index] + nutrient, 0, 1))
        self.temperature[index] += heat
        self.wave_velocity[index] += signal
        self.diagnostics["external_nutrient"] += float(nutrient)
        if impulse is not None:
            self.velocity[(slice(None), *index)] += np.asarray(impulse)

    def consume(self, position, amount):
        index = tuple(
            (np.floor(position).astype(int) % np.asarray(self.shape)).tolist()
        )
        taken = min(max(float(amount), 0.0), float(self.v[index]))
        self.v[index] -= taken
        return taken

    def _reaction(self, dt):
        c = self.config
        reaction = self.u * self.v * self.v
        du = c.diffusion_u * self.laplacian(self.u) - reaction + c.feed * (1 - self.u)
        dv = (
            c.diffusion_v * self.laplacian(self.v)
            + reaction
            - (c.feed + c.kill) * self.v
        )
        self.u = self._clip(self.u + dt * du)
        self.v = self._clip(self.v + dt * dv)

    def _fixed_reaction(self):
        c = self.config
        Q = self.Q
        quant = lambda x: int(Fraction(str(x)) * Q + Fraction(1, 2))
        dt, du, dv, feed, kill = map(
            quant, (c.dt, c.diffusion_u, c.diffusion_v, c.feed, c.kill)
        )
        u, v = self.fixed_u, self.fixed_v
        lap = lambda x: sum(
            np.roll(x, 1, a) + np.roll(x, -1, a) - 2 * x for a in range(self.ndim)
        )
        # dx must be integral-compatible; division represented by exact rational integers.
        dx2 = Fraction(str(c.dx)) ** 2
        lu = (lap(u) * dx2.denominator) // dx2.numerator
        lv = (lap(v) * dx2.denominator) // dx2.numerator
        reaction = (((u * v) // Q) * v) // Q
        nu = u + (dt * ((du * lu) // Q - reaction + (feed * (Q - u)) // Q)) // Q
        nv = v + (dt * ((dv * lv) // Q + reaction - ((feed + kill) * v) // Q)) // Q
        self.diagnostics["clipped_values"] += int(
            np.count_nonzero((nu < 0) | (nu > Q) | (nv < 0) | (nv > Q))
        )
        self.fixed_u = np.clip(nu, 0, Q)
        self.fixed_v = np.clip(nv, 0, Q)
        self.u = self.fixed_u.astype(float) / Q
        self.v = self.fixed_v.astype(float) / Q

    def _conway(self):
        neighbors = np.zeros(self.shape, dtype=np.int16)
        for shift in product((-1, 0, 1), repeat=self.ndim):
            if any(shift):
                neighbors += np.roll(self.life, shift, tuple(range(self.ndim)))
        birth = self.config.birth or ((3,) if self.ndim == 2 else (6,))
        survive = self.config.survive or ((2, 3) if self.ndim == 2 else (5, 6, 7))
        self.life = (
            (self.life.astype(bool) & np.isin(neighbors, survive))
            | (~self.life.astype(bool) & np.isin(neighbors, birth))
        ).astype(np.uint8)
        self.v = self.life.astype(float)

    def _lenia(self, dt):
        potential = np.fft.ifftn(np.fft.fftn(self.v) * self._lenia_kernel).real
        growth = (
            2
            * np.exp(
                -0.5
                * ((potential - self.config.lenia_mu) / self.config.lenia_sigma) ** 2
            )
            - 1
        )
        self.v = self._clip(self.v + dt * growth)

    def _advect(self, field, dt):
        coordinates = self._coordinates - dt * self.velocity / self.config.dx
        return map_coordinates(
            field, coordinates, order=1, mode="grid-wrap", prefilter=False
        )

    def _fluid(self, dt):
        c = self.config
        advected = np.stack([self._advect(v, dt) for v in self.velocity])
        vh = [np.fft.fftn(v) / (1 + c.viscosity * dt * self._k2) for v in advected]
        dot = sum(k * v for k, v in zip(self._k, vh))
        denominator = np.where(self._k2 == 0, 1, self._k2)
        self.pressure = np.fft.ifftn(-1j * dot / (dt * denominator)).real
        self.velocity = np.stack(
            [np.fft.ifftn(v - k * dot / denominator).real for k, v in zip(self._k, vh)]
        )
        self.v = self._clip(self._advect(self.v, dt))
        self.temperature = self._advect(
            self.temperature, dt
        ) + dt * c.thermal_diffusion * self.laplacian(self.temperature)

    def _wave(self, dt):
        c = self.config
        self.wave_velocity += dt * (
            c.wave_speed**2 * self.laplacian(self.wave)
            - c.wave_damping * self.wave_velocity
        )
        self.wave += dt * self.wave_velocity

    def _particles(self, dt):
        if not len(self.particle_positions):
            return
        flow = np.stack(
            [self.sample(v, self.particle_positions) for v in self.velocity], axis=1
        )
        gravity = np.zeros(self.ndim)
        gravity[-1] = -0.1
        self.particle_velocity += dt * (gravity + 0.2 * (flow - self.particle_velocity))
        self.particle_positions += dt * self.particle_velocity
        for axis, extent in enumerate(self.shape):
            low = self.particle_positions[:, axis] < 0
            high = self.particle_positions[:, axis] > extent - 1
            self.particle_velocity[low | high, axis] *= -0.7
            self.particle_positions[:, axis] = np.clip(
                self.particle_positions[:, axis], 0, extent - 1
            )

    def _nca(self, dt):
        # A fixed local neural cellular automaton, not a pretrained life model.
        perception = np.concatenate(
            (self.channels, np.stack([self.laplacian(x) for x in self.channels])),
            axis=0,
        )
        update = np.tanh(np.einsum("c...,co->o...", perception, self._nca_weights))
        self.channels = self._clip(self.channels + dt * update)
        self.v = self.channels[0].copy()

    def step(self, steps=1):
        if not isinstance(steps, int) or not 1 <= steps <= 10000:
            raise ValueError("steps must be in [1,10000]")
        c = self.config
        bound = max(
            2
            * self.ndim
            * max(c.diffusion_u, c.diffusion_v, c.thermal_diffusion)
            / c.dx**2,
            c.wave_speed * np.sqrt(self.ndim) / c.dx,
            1.0,
        )
        count = max(1, int(np.ceil(c.dt * bound / 0.5)))
        if count > c.max_substeps:
            raise ValueError("stability requires too many substeps")
        if (
            c.mode == "fixed_gray_scott"
            and c.dt * 2 * self.ndim * max(c.diffusion_u, c.diffusion_v) / c.dx**2 > 0.5
        ):
            raise ValueError("fixed-point stencil exceeds configured stability bound")
        for _ in range(steps):
            if c.mode == "conway":
                self._conway()
            elif c.mode == "fixed_gray_scott":
                self._fixed_reaction()
            else:
                for _ in range(count):
                    dt = c.dt / count
                    if c.mode in ("gray_scott", "hybrid"):
                        self._reaction(dt)
                    if c.mode == "lenia":
                        self._lenia(dt)
                    if c.mode == "nca":
                        self._nca(dt)
                    if c.mode in ("fluid", "hybrid", "particles"):
                        self._fluid(dt)
                    if c.mode in ("wave", "hybrid"):
                        self._wave(dt)
                    if c.mode in ("particles", "hybrid"):
                        self._particles(dt)
            self.tick += 1
            self.elapsed = self.tick * c.dt
            self.diagnostics["substeps"] = count
            if not all(
                np.isfinite(x).all()
                for x in (
                    self.u,
                    self.v,
                    self.velocity,
                    self.wave,
                    self.temperature,
                    self.particle_positions,
                    self.particle_velocity,
                    self.channels,
                )
            ):
                raise FloatingPointError("nonfinite physical state")
        return self.metrics()

    def metrics(self):
        divergence = np.fft.ifftn(
            sum(1j * k * np.fft.fftn(v) for k, v in zip(self._k, self.velocity))
        ).real
        return {
            "tick": self.tick,
            "mass_u": float(self.u.sum()),
            "mass_v": float(self.v.sum()),
            "kinetic": float(0.5 * np.sum(self.velocity**2)),
            "wave_energy_proxy": float(0.5 * np.sum(self.wave_velocity**2)),
            "spectral_divergence_rms": float(np.sqrt(np.mean(divergence**2))),
            **self.diagnostics,
        }

    def state_dict(self):
        arrays = {
            k: getattr(self, k).copy()
            for k in (
                "u",
                "v",
                "life",
                "fixed_u",
                "fixed_v",
                "velocity",
                "temperature",
                "pressure",
                "wave",
                "wave_velocity",
                "channels",
                "particle_positions",
                "particle_velocity",
            )
        }
        return {
            "config": asdict(self.config),
            "tick": self.tick,
            "rng_state": self.rng.state,
            "diagnostics": self.diagnostics.copy(),
            "arrays": arrays,
        }

    @classmethod
    def from_state_dict(cls, state):
        c = state["config"].copy()
        c["shape"] = tuple(c["shape"])
        c["birth"] = tuple(c["birth"])
        c["survive"] = tuple(c["survive"])
        obj = cls(PhysicsConfig(**c))
        for key, value in state["arrays"].items():
            if (
                key not in obj.state_dict()["arrays"]
                or np.shape(value) != getattr(obj, key).shape
            ):
                raise ValueError("field checkpoint shape mismatch")
            setattr(obj, key, np.asarray(value).copy())
        obj.tick = state["tick"]
        obj.elapsed = obj.tick * obj.config.dt
        obj.rng.state = state["rng_state"]
        obj.diagnostics = state["diagnostics"].copy()
        return obj

    def state_hash(self):
        # Strict modes hash only authoritative integer state and integer clock.
        if self.config.mode == "conway":
            return digest_arrays(
                {"life": self.life}, {"tick": self.tick, "rng": self.rng.state}
            )
        if self.config.mode == "fixed_gray_scott":
            return digest_arrays(
                {"u": self.fixed_u, "v": self.fixed_v},
                {"tick": self.tick, "rng": self.rng.state},
            )
        state = self.state_dict()
        return digest_arrays(
            state["arrays"], {"tick": self.tick, "rng": self.rng.state}
        )

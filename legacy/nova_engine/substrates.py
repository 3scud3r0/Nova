"""Bounded NumPy control/reference substrates, independent of the native hot loop."""
from dataclasses import dataclass
import numpy as np


@dataclass
class Lenia:
    """Periodic 2D FFT Lenia with normalized radial kernel and Gaussian growth."""
    state: np.ndarray
    radius: float = 12.0
    mu: float = 0.15
    sigma: float = 0.015
    dt: float = 0.1

    def __post_init__(self):
        self.state = np.array(self.state, dtype=np.float64, copy=True)
        if (self.state.ndim != 2 or min(self.state.shape) < 8 or self.state.size > 1024**2
                or not np.isfinite(self.state).all() or np.any((self.state < 0) | (self.state > 1))
                or not np.isfinite([self.radius, self.mu, self.sigma, self.dt]).all()
                or not 1 <= self.radius <= min(self.state.shape) / 2
                or self.sigma <= 0 or not 0 < self.dt <= 0.2):
            raise ValueError("invalid Lenia grid or coefficients")
        y, x = np.indices(self.state.shape)
        r = np.hypot(x - self.state.shape[1] // 2, y - self.state.shape[0] // 2) / self.radius
        kernel = np.exp(-0.5 * ((r - 0.5) / 0.15)**2) * (r < 1)
        kernel /= kernel.sum()
        self._kernel = np.fft.rfft2(np.fft.ifftshift(kernel))

    def potential(self):
        return np.fft.irfft2(np.fft.rfft2(self.state) * self._kernel, s=self.state.shape)

    def step(self, ticks=1):
        if not 0 <= ticks <= 100000:
            raise ValueError("tick budget exceeded")
        for _ in range(ticks):
            growth = 2 * np.exp(-0.5 * ((self.potential() - self.mu) / self.sigma)**2) - 1
            self.state = np.clip(self.state + self.dt * growth, 0, 1)
        return self.state


class ConservativeFlow(Lenia):
    """Flow-Lenia-inspired conservative upwind transport, not its published solver.

    The growth response defines a velocity potential; it is never added as mass.
    Periodic fluxes conserve total mass up to floating-point summation error.
    """
    def step(self, ticks=1):
        if not 0 <= ticks <= 100000:
            raise ValueError("tick budget exceeded")
        for _ in range(ticks):
            potential = 2 * np.exp(-0.5 * ((self.potential() - self.mu) / self.sigma)**2) - 1
            velocity = [(np.roll(potential, -1, axis) - np.roll(potential, 1, axis)) / 2
                        for axis in range(2)]
            max_cfl = self.dt * sum(np.max(np.abs(v)) for v in velocity)
            if max_cfl > 0.9:
                raise ValueError("flow CFL exceeded; reduce dt")
            change = np.zeros_like(self.state)
            for axis, v in enumerate(velocity):
                face_v = (v + np.roll(v, -1, axis)) / 2
                flux = face_v * np.where(face_v >= 0, self.state, np.roll(self.state, -1, axis))
                change -= self.dt * (flux - np.roll(flux, 1, axis))
            candidate = self.state + change
            if not np.isfinite(candidate).all() or candidate.min() < -1e-12:
                raise FloatingPointError("invalid conservative flow step")
            self.state = candidate
        return self.state


def conway_nd(state, birth=(3,), survive=(2, 3), *, neighborhood="moore"):
    """Exact periodic integer 2D/3D automata; 3D rules must be explicitly chosen."""
    from itertools import product
    a = np.asarray(state)
    if a.ndim not in (2, 3) or a.size > 256**3 or min(a.shape) < 3 or np.any((a != 0) & (a != 1)):
        raise ValueError("expected bounded 2D/3D boolean grid with axes >=3")
    if neighborhood not in ("moore", "von-neumann"):
        raise ValueError("unknown neighborhood")
    total = np.zeros(a.shape, np.uint8)
    for shift in product((-1, 0, 1), repeat=a.ndim):
        distance = sum(abs(x) for x in shift)
        if distance == 0 or (neighborhood == "von-neumann" and distance != 1):
            continue
        total += np.roll(a.astype(np.uint8), shift, tuple(range(a.ndim)))
    return np.where(a, np.isin(total, survive), np.isin(total, birth))


def multiverse_specs(seed=42, count=16):
    """Generate bounded law candidates; each specification is reproducible metadata."""
    if not 1 <= count <= 10000:
        raise ValueError("universe budget exceeded")
    rng = np.random.default_rng(seed)
    for index in range(count):
        yield {"universe": index, "seed": int(rng.integers(0, 2**63)),
               "affinities": rng.uniform(-1, 1, (8, 8)).tolist(),
               "damping": float(rng.uniform(0.1, 3)), "dt": 1 / 120,
               "cutoff": float(rng.uniform(0.15, 0.5)), "proof_status": "unverified"}

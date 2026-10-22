"""Colloidal/thermodynamic reference equations; quantities require declared units."""

import numpy as np

from nova.bioma.determinism import SplitMix64


def dlvo_potential(
    gap, *, radius=1e-6, hamaker=1e-20, permittivity=7e-10, zeta=0.025, kappa=1e8
):
    gap = np.asarray(gap, dtype=float)
    if (
        np.any(gap <= 0)
        or not np.isfinite(gap).all()
        or min(radius, hamaker, permittivity, kappa) <= 0
        or not np.isfinite(zeta)
    ):
        raise ValueError("positive finite separated-sphere parameters required")
    # Derjaguin small-gap approximation for equal spheres, not a molecular model.
    return -hamaker * radius / (
        12 * gap
    ) + 2 * np.pi * permittivity * radius * zeta * zeta * np.log1p(np.exp(-kappa * gap))


def regular_solution(fraction, temperature, chi, gas_constant=8.314462618):
    fraction = np.asarray(fraction, dtype=float)
    if (
        not np.isfinite(fraction).all()
        or np.any((fraction <= 0) | (fraction >= 1))
        or not temperature > 0
        or not np.isfinite([temperature, chi]).all()
    ):
        raise ValueError("mixture fractions must be interior and temperature positive")
    free = (
        gas_constant
        * temperature
        * (
            fraction * np.log(fraction)
            + (1 - fraction) * np.log1p(-fraction)
            + chi * fraction * (1 - fraction)
        )
    )
    chemical = (
        gas_constant
        * temperature
        * (np.log(fraction / (1 - fraction)) + chi * (1 - 2 * fraction))
    )
    return free, chemical


def onsager_flux(forces, mobility):
    forces = np.asarray(forces, dtype=float)
    matrix = np.asarray(mobility, dtype=float)
    if (
        matrix.shape != (forces.shape[-1], forces.shape[-1])
        or not np.isfinite(matrix).all()
        or not np.isfinite(forces).all()
        or not np.allclose(matrix, matrix.T, atol=1e-12)
        or np.linalg.eigvalsh(matrix).min() < -1e-12
    ):
        raise ValueError("symmetric positive-semidefinite mobility required")
    flux = forces @ matrix.T
    production = np.sum(flux * forces, axis=-1)
    return flux, production


class GillespieReactor:
    """Exact SSA for a finite, well-mixed mass-action reaction network."""

    def __init__(self, reactants, products, rates, counts, seed=0, max_events=100000):
        self.reactants = np.asarray(reactants, dtype=np.int64)
        self.products = np.asarray(products, dtype=np.int64)
        self.rates = np.asarray(rates, dtype=float)
        self.counts = np.asarray(counts, dtype=np.int64)
        if (
            self.reactants.ndim != 2
            or self.reactants.shape != self.products.shape
            or self.reactants.shape[1] != len(self.counts)
            or self.rates.shape != (len(self.reactants),)
            or max(self.reactants.shape) > 32
            or np.any(self.reactants < 0)
            or np.any(self.products < 0)
            or np.any(self.counts < 0)
            or np.any(self.reactants > 4)
            or np.any(self.reactants.sum(axis=1) > 4)
            or np.any(self.products > 8)
            or np.any(self.counts > 1_000_000_000)
            or not np.isfinite(self.rates).all()
            or np.any(self.rates < 0)
            or not 1 <= max_events <= 100000
        ):
            raise ValueError("reaction network budget/domain exceeded")
        self.rng = SplitMix64(seed)
        self.time = 0.0
        self.events = 0
        self.max_events = max_events

    def step(self, until):
        import math

        if not np.isfinite(until) or until < self.time:
            raise ValueError("invalid reaction clock")
        while self.events < self.max_events:
            prop = self.rates.copy()
            for r in range(len(prop)):
                for species, order in enumerate(self.reactants[r]):
                    prop[r] *= (
                        math.comb(int(self.counts[species]), int(order))
                        if self.counts[species] >= order
                        else 0
                    )
            total = prop.sum()
            if not np.isfinite(prop).all() or not np.isfinite(total):
                raise FloatingPointError("reaction propensities overflow")
            if not total > 0:
                return {"time": self.time, "events": self.events, "status": "absorbing"}
            wait = -np.log(max(float(self.rng.uniform((1,))[0]), 2.0**-53)) / total
            if self.time + wait > until:
                # Finite-interval API restarts the exponential clock; memorylessness
                # preserves its distribution, not a single RNG trajectory partition.
                self.time = until
                return {"time": self.time, "events": self.events, "status": "horizon"}
            choice = int(
                np.searchsorted(
                    np.cumsum(prop), self.rng.uniform((1,))[0] * total, side="right"
                )
            )
            self.counts += self.products[choice] - self.reactants[choice]
            if np.any(self.counts > 1_000_000_000):
                raise ValueError("molecule count budget exceeded")
            self.time += wait
            self.events += 1
        return {"time": self.time, "events": self.events, "status": "budget_exhausted"}


def regular_solution_binodal(chi):
    """Coexistence of a symmetric mean-field regular solution, not measured ink."""
    from scipy.optimize import brentq
    from scipy.special import expit

    if not np.isfinite(chi) or not 0 <= chi <= 100:
        raise ValueError("regular-solution parameter budget exceeded")
    if chi <= 2:
        return {"phases": 1, "fractions": [0.5], "critical_chi": 2.0}
    if chi - 2 < 1e-6:
        c = 0.5 - np.sqrt(3 * (chi - 2) / 8)
    else:
        root = brentq(
            lambda z: z + chi * (1 - 2 * expit(z)), -chi - 1, -1e-6, xtol=1e-12
        )
        c = float(expit(root))
    return {
        "phases": 2,
        "fractions": [c, 1 - c],
        "critical_chi": 2.0,
        "scope": "symmetric mean-field common tangent",
    }

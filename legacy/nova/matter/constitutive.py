"""Constitutive laws: regularized yield stress, thixotropy and finite strain."""

import numpy as np


def herschel_bulkley(
    shear_rate,
    *,
    yield_stress=0.1,
    consistency=0.02,
    exponent=0.6,
    regularization=100.0,
    structure=1.0,
):
    rate = np.asarray(shear_rate, dtype=float)
    if (
        not np.isfinite(rate).all()
        or np.any(rate < 0)
        or min(yield_stress, consistency) < 0
        or not 0.1 <= exponent <= 2
        or not 0 < regularization <= 1e4
        or not np.all((np.asarray(structure) >= 0) & (np.asarray(structure) <= 1))
    ):
        raise ValueError("invalid rheology/domain")
    safe = np.maximum(rate, 1e-8)
    plastic = (
        yield_stress
        * np.asarray(structure)
        * (-np.expm1(-regularization * safe))
        / safe
    )
    return plastic + consistency * safe ** (exponent - 1)


def thixotropic_structure(
    previous, shear_rate, dt, *, rebuild_time=2.0, break_rate=1.0
):
    previous, shear_rate = np.broadcast_arrays(previous, shear_rate)
    if (
        not 0 < dt <= 0.1
        or rebuild_time <= 0
        or break_rate < 0
        or not np.isfinite(previous).all()
        or not np.isfinite(shear_rate).all()
        or np.any((previous < 0) | (previous > 1) | (shear_rate < 0))
    ):
        raise ValueError("invalid thixotropic state/time")
    # Exact solution while shear is held fixed; remains in [0,1].
    rate = 1 / rebuild_time + break_rate * shear_rate
    equilibrium = (1 / rebuild_time) / rate
    return equilibrium + (previous - equilibrium) * np.exp(-rate * dt)


def saint_venant_kirchhoff(F, mu, lam):
    F = np.asarray(F, dtype=float)
    d = F.shape[-1]
    if (
        F.shape[-2:] != (d, d)
        or d not in (2, 3)
        or not np.isfinite(F).all()
        or mu < 0
        or lam < 0
    ):
        raise ValueError("invalid elastic state/moduli")
    E = 0.5 * (np.swapaxes(F, -1, -2) @ F - np.eye(d))
    trace = np.trace(E, axis1=-2, axis2=-1)
    second = 2 * mu * E + lam * trace[..., None, None] * np.eye(d)
    return F @ second, mu * np.sum(E * E, axis=(-2, -1)) + 0.5 * lam * trace**2


def marangoni_tangent(
    normal, temperature_gradient, concentration_gradient, dsigma_dT, dsigma_dc
):
    normal = np.asarray(normal, dtype=float)
    g = dsigma_dT * np.asarray(temperature_gradient) + dsigma_dc * np.asarray(
        concentration_gradient
    )
    norm = np.linalg.norm(normal, axis=-1, keepdims=True)
    if np.any(norm < 1e-12) or not np.isfinite(g).all():
        raise ValueError("finite nonzero interface normals required")
    n = normal / norm
    return g - n * np.sum(g * n, axis=-1, keepdims=True)


def immersed_drag(body_velocity, fluid_velocity, weights, drag=1.0):
    weights = np.asarray(weights, dtype=float)
    fluid_velocity = np.asarray(fluid_velocity, dtype=float)
    body_velocity = np.asarray(body_velocity, dtype=float)
    if (
        weights.ndim != 1
        or fluid_velocity.shape != (len(weights), len(body_velocity))
        or np.any(weights < 0)
        or weights.sum() <= 0
        or drag < 0
        or not all(
            np.isfinite(x).all() for x in (weights, fluid_velocity, body_velocity)
        )
    ):
        raise ValueError("invalid immersed coupling")
    weights = weights / weights.sum()
    fluid_force = drag * weights[:, None] * (body_velocity - fluid_velocity)
    return -fluid_force.sum(axis=0), fluid_force

"""Analytic distance primitives and bounded sphere tracing of genuine SDFs."""

import numpy as np


def sphere(points, center=(0.0, 0.0, 0.0), radius=1.0):
    p = np.asarray(points, dtype=float)
    center = np.asarray(center, dtype=float)
    if (
        p.shape[-1] != 3
        or center.shape != (3,)
        or not radius > 0
        or not np.isfinite(p).all()
        or not np.isfinite(center).all()
    ):
        raise ValueError("invalid sphere geometry")
    return np.linalg.norm(p - center, axis=-1) - radius


def torus(points, major_radius=1.0, minor_radius=0.2):
    p = np.asarray(points, dtype=float)
    if (
        p.shape[-1] != 3
        or not 0 < minor_radius < major_radius
        or not np.isfinite(p).all()
    ):
        raise ValueError("invalid torus geometry")
    q = np.stack(
        (np.linalg.norm(p[..., [0, 2]], axis=-1) - major_radius, p[..., 1]), axis=-1
    )
    return np.linalg.norm(q, axis=-1) - minor_radius


def smooth_union(a, b, radius=0.1):
    if not np.isfinite(radius) or radius <= 0:
        raise ValueError("positive smoothing radius required")
    h = np.clip(0.5 + 0.5 * (np.asarray(b) - a) / radius, 0, 1)
    return np.asarray(b) * (1 - h) + np.asarray(a) * h - radius * h * (1 - h)


def sphere_trace(
    distance,
    origin,
    direction,
    max_distance=10.0,
    max_steps=256,
    epsilon=1e-4,
    lipschitz=1.0,
):
    origin, direction = (
        np.asarray(origin, dtype=float),
        np.asarray(direction, dtype=float),
    )
    if (
        origin.shape != (3,)
        or direction.shape != (3,)
        or not np.isfinite(origin).all()
        or not np.isfinite(direction).all()
        or np.linalg.norm(direction) < 1e-12
        or not 1 <= max_steps <= 1024
        or not 0 < epsilon < 0.1
        or not 0 < max_distance <= 100
        or not 1 <= lipschitz <= 100
    ):
        raise ValueError("invalid ray/iteration bounds")
    direction = direction / np.linalg.norm(direction)
    t = 0.0
    for step in range(max_steps):
        d = float(distance(origin + t * direction))
        if not np.isfinite(d):
            raise ValueError("distance returned nonfinite value")
        if abs(d) < epsilon:
            return {
                "hit": True,
                "distance": t,
                "point": (origin + t * direction).tolist(),
                "steps": step + 1,
            }
        # For an origin inside a closed SDF, |d| bounds distance to its boundary.
        t += abs(d) / lipschitz
        if t > max_distance:
            break
    return {
        "hit": False,
        "distance": t,
        "steps": step + 1,
        "scope": "requires a valid distance/Lipschitz bound; occupancy density is not an SDF",
    }

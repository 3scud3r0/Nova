"""Conditional symplectic integration and fold/cusp normal-form diagnostics."""

import numpy as np


def yoshida4(q, p, force, dt, mass=1.0):
    q, p = np.asarray(q, dtype=float).copy(), np.asarray(p, dtype=float).copy()
    if (
        q.shape != p.shape
        or not np.isfinite(q).all()
        or not np.isfinite(p).all()
        or not np.isfinite(dt)
        or not 0 < abs(dt) <= 1
        or np.any(np.asarray(mass) <= 0)
    ):
        raise ValueError("invalid separable Hamiltonian state/time")
    # Negative intermediate step is essential; unsuitable for irreversible/damped forces.
    root = 2 ** (1 / 3)
    w1 = 1 / (2 - root)
    w0 = -root / (2 - root)
    for w in (w1, w0, w1):
        h = w * dt
        p += 0.5 * h * np.asarray(force(q))
        q += h * p / mass
        p += 0.5 * h * np.asarray(force(q))
    return q, p


def cusp_equilibria(a, b):
    if not np.isfinite([a, b]).all():
        raise ValueError("finite cusp parameters required")
    roots = np.roots([1.0, 0.0, a, b])
    real = sorted(float(z.real) for z in roots if abs(z.imag) < 1e-8)
    return {
        "equilibria": [
            {
                "x": x,
                "curvature": 3 * x * x + a,
                "locally_stable": bool(3 * x * x + a > 0),
            }
            for x in real
        ],
        "discriminant": float(-4 * a**3 - 27 * b * b),
        "scope": "canonical potential x^4/4+a*x^2/2+b*x; not a universal rupture detector",
    }


def catastrophe_normal_form(x, controls, kind="cusp"):
    """Fold/cusp/swallowtail/butterfly polynomial potentials, bounded reference."""
    x = np.asarray(x, dtype=float)
    controls = np.asarray(controls, dtype=float)
    orders = {
        "fold": (3, [1]),
        "cusp": (4, [2, 1]),
        "swallowtail": (5, [3, 2, 1]),
        "butterfly": (6, [4, 3, 2, 1]),
    }
    if kind not in orders:
        raise ValueError("unknown catastrophe normal form")
    degree, powers = orders[kind]
    if (
        controls.shape != (len(powers),)
        or not np.isfinite(controls).all()
        or not np.isfinite(x).all()
        or np.any(abs(x) > 100)
        or np.any(abs(controls) > 100)
    ):
        raise ValueError("normal-form domain/budget exceeded")
    potential = x**degree / degree
    gradient = x ** (degree - 1)
    hessian = (degree - 1) * x ** (degree - 2)
    for c, p in zip(controls, powers):
        potential += c * x**p / p
        gradient += c * x ** (p - 1)
        if p > 1:
            hessian += c * (p - 1) * x ** (p - 2)
    return potential, gradient, hessian

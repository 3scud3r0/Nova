"""Sparse polynomial discovery with held-out groups and rationalized coefficients."""

from __future__ import annotations
from dataclasses import dataclass
from fractions import Fraction
from itertools import combinations_with_replacement
import hashlib
import numpy as np
from .polynomial import Polynomial


@dataclass
class SymbolicCandidate:
    polynomial: Polynomial
    metrics: dict
    provenance: dict

    def to_dict(self):
        return {
            "polynomial": self.polynomial.to_dict(),
            "expression": self.polynomial.expression(),
            "metrics": self.metrics,
            "provenance": self.provenance,
            "status": "empirical_candidate",
        }


class SymbolicRegressor:
    """Greedy sparse least squares over a declared polynomial library.

    Train/holdout splitting is by trajectory groups when supplied, otherwise by
    ordered blocks. A formula fitting a latent model is not automatically a law
    in physical coordinates. Rationalization is checked on held-out data.
    """

    def __init__(
        self, degree=3, max_terms=8, max_features=256, complexity_penalty=1e-5
    ):
        if (
            not 1 <= degree <= 5
            or not 1 <= max_terms <= 32
            or not 1 <= max_features <= 512
        ):
            raise ValueError("symbolic search budget exceeded")
        self.degree, self.max_terms, self.max_features, self.penalty = (
            degree,
            max_terms,
            max_features,
            complexity_penalty,
        )

    def fit(self, x, y, variables, groups=None, provenance=None):
        x = np.asarray(x, dtype=float)
        y = np.asarray(y, dtype=float)
        if (
            x.ndim != 2
            or x.shape[1] != len(variables)
            or not 1 <= x.shape[1] <= 8
            or y.shape != (len(x),)
            or len(x) < 12
            or not np.isfinite(x).all()
            or not np.isfinite(y).all()
        ):
            raise ValueError("invalid symbolic observations")
        if groups is None:
            train = np.arange(len(x)) < int(0.75 * len(x))
            split = "ordered_block"
        else:
            groups = np.asarray(groups)
            unique = list(dict.fromkeys(groups.tolist()))
            if len(unique) < 2:
                raise ValueError("held-out trajectory groups required")
            train = np.isin(groups, unique[: max(1, int(0.75 * len(unique)))])
            split = "trajectory_groups"
        test = ~train
        if train.sum() < 4 or test.sum() < 2:
            raise ValueError("insufficient held-out observations")
        powers = [(0,) * x.shape[1]]
        for degree in range(1, self.degree + 1):
            for indices in combinations_with_replacement(range(x.shape[1]), degree):
                p = [0] * x.shape[1]
                for i in indices:
                    p[i] += 1
                powers.append(tuple(p))
                if len(powers) > self.max_features:
                    raise ValueError(
                        "feature library exceeds budget; lower degree/dimension"
                    )
        design = np.stack([np.prod(x ** np.asarray(p), axis=1) for p in powers], axis=1)
        if not np.isfinite(design).all():
            raise ValueError("overflow in symbolic library")
        selected = []
        residual = y[train].copy()
        scale = np.maximum(np.linalg.norm(design[train], axis=0), 1e-12)
        available = set(range(len(powers)))
        best = float(np.mean(residual**2))
        for _ in range(min(self.max_terms, len(powers))):
            index = max(
                sorted(available),
                key=lambda i: abs(float(design[train, i] @ residual)) / scale[i],
            )
            trial = selected + [index]
            coef = np.linalg.lstsq(design[train][:, trial], y[train], rcond=1e-10)[0]
            error = y[train] - design[train][:, trial] @ coef
            objective = float(np.mean(error**2)) + self.penalty * len(trial)
            if selected and objective >= best:
                break
            selected = trial
            available.remove(index)
            residual = error
            best = objective
        coef = np.linalg.lstsq(design[train][:, selected], y[train], rcond=1e-10)[0]
        polynomial = Polynomial(
            variables,
            {
                powers[i]: Fraction(float(c)).limit_denominator(10000)
                for i, c in zip(selected, coef)
            },
        )
        prediction = polynomial.evaluate(x)
        baseline = float(np.mean((y[test] - y[train].mean()) ** 2))
        condition = float(np.linalg.cond(design[train][:, selected]))
        condition = condition if np.isfinite(condition) else None
        return SymbolicCandidate(
            polynomial,
            {
                "train_mse": float(np.mean((prediction[train] - y[train]) ** 2)),
                "heldout_mse": float(np.mean((prediction[test] - y[test]) ** 2)),
                "mean_baseline_mse": baseline,
                "terms": len(polynomial.terms),
                "train_samples": int(train.sum()),
                "heldout_samples": int(test.sum()),
                "split": split,
                "design_condition": condition,
            },
            {
                **(provenance or {}),
                "feature_variables": list(variables),
                "data_sha256": hashlib.sha256(x.tobytes() + y.tobytes()).hexdigest(),
            },
        )

    def distill_latent(self, world, z, actions, coordinates, dt=1.0):
        z = np.asarray(z)
        actions = np.asarray(actions)
        if dt <= 0 or len(coordinates) + actions.shape[1] > 8:
            raise ValueError("explicit low-dimensional observable selection required")
        future = world.predict(z, actions)
        x = np.c_[z[:, coordinates], actions]
        names = [f"z{i}" for i in coordinates] + [
            f"a{i}" for i in range(actions.shape[1])
        ]
        return [
            self.fit(
                x,
                (future[:, index] - z[:, index]) / dt,
                names,
                provenance={
                    "scope": "selected_latent_coordinates",
                    "coordinate": index,
                    "dt": dt,
                    "warning": "unobserved latent coordinates may invalidate closure; not a physical-coordinate theorem",
                },
            )
            for index in coordinates
        ]

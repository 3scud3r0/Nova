"""Bounded STLSQ SINDy with polynomial/trigonometric library and temporal holdout."""

from itertools import combinations_with_replacement
import numpy as np


class SINDyEquations:
    def __init__(self, degree=3, threshold=0.05, ridge=1e-4, iterations=20, trig=True):
        if (
            not 1 <= degree <= 3
            or threshold < 0
            or ridge <= 0
            or not 1 <= iterations <= 100
        ):
            raise ValueError("invalid SINDy configuration")
        self.degree, self.threshold, self.ridge, self.iterations, self.trig = (
            degree,
            threshold,
            ridge,
            iterations,
            trig,
        )
        self.terms = None
        self.coefficients = None

    def library(self, x, *, fit=False):
        x = np.asarray(x, float)
        if x.ndim != 2 or not 1 <= x.shape[1] <= 16 or not np.isfinite(x).all():
            raise ValueError("SINDy requires finite 1..16 dimensional states")
        if fit:
            terms = [("constant", ())]
            for degree in range(1, self.degree + 1):
                terms.extend(
                    ("polynomial", axes)
                    for axes in combinations_with_replacement(range(x.shape[1]), degree)
                )
            if self.trig:
                terms.extend(
                    (name, (axis,))
                    for name in ("sin", "cos")
                    for axis in range(x.shape[1])
                )
            self.terms = terms
        if self.terms is None or len(x) * len(self.terms) > 20_000_000:
            raise ValueError("SINDy library absent or exceeds memory budget")
        columns = []
        for name, axes in self.terms:
            if name == "constant":
                value = np.ones(len(x))
            elif name == "polynomial":
                value = np.prod(x[:, axes], axis=1)
            elif name == "sin":
                value = np.sin(x[:, axes[0]])
            else:
                value = np.cos(x[:, axes[0]])
            columns.append(value)
        library = np.stack(columns, axis=1)
        if not np.isfinite(library).all():
            raise ValueError("nonfinite polynomial/trigonometric library")
        return library

    def fit(self, states, time, *, fraction=0.8):
        x, t = np.asarray(states, float), np.asarray(time, float)
        if (
            x.ndim != 2
            or t.shape != (len(x),)
            or len(x) < 20
            or not 0.5 <= fraction <= 0.9
            or not np.isfinite(t).all()
            or not np.all(np.diff(t) > 0)
        ):
            raise ValueError("expected ordered trajectory and temporal holdout")
        split = int(len(x) * fraction)
        if split < 8 or len(x) - split < 4:
            raise ValueError("insufficient train/held-out samples")
        train, held = x[:split], x[split:]
        derivative = np.gradient(train, t[:split], axis=0, edge_order=2)
        held_derivative = np.gradient(held, t[split:], axis=0, edge_order=2)
        theta = self.library(train, fit=True)
        scale = np.linalg.norm(theta, axis=0).clip(1e-8)
        normalized = theta / scale
        coefficients = (
            np.linalg.solve(
                normalized.T @ normalized + self.ridge * np.eye(theta.shape[1]),
                normalized.T @ derivative,
            )
            / scale[:, None]
        )
        for _ in range(self.iterations):
            for dimension in range(x.shape[1]):
                active = np.abs(coefficients[:, dimension]) >= self.threshold
                coefficients[~active, dimension] = 0
                if active.any():
                    sub = normalized[:, active]
                    coefficients[active, dimension] = (
                        np.linalg.solve(
                            sub.T @ sub + self.ridge * np.eye(active.sum()),
                            sub.T @ derivative[:, dimension],
                        )
                        / scale[active]
                    )
        if not np.isfinite(coefficients).all():
            raise FloatingPointError("nonfinite SINDy coefficients")
        self.coefficients = coefficients
        residual = self.library(held) @ coefficients - held_derivative
        return dict(
            status="candidate-not-verified",
            heldout_samples=len(held),
            heldout_derivative_rmse=float(np.sqrt(np.mean(residual**2))),
            terms=[dict(kind=name, axes=list(axes)) for name, axes in self.terms],
            coefficients=coefficients.tolist(),
            dimension=x.shape[1],
            threshold=self.threshold,
            scope="finite-difference fit; not an exact recovered law",
        )

    @staticmethod
    def fit_pysindy(states, time, *, threshold=0.05, degree=3):
        import pysindy as ps

        x, t = np.asarray(states, float), np.asarray(time, float)
        if (
            x.ndim != 2
            or x.size > 2_000_000
            or t.shape != (len(x),)
            or not np.isfinite(x).all()
            or not np.all(np.diff(t) > 0)
        ):
            raise ValueError("invalid PySINDy samples")
        model = ps.SINDy(
            feature_library=ps.PolynomialLibrary(degree=degree),
            optimizer=ps.STLSQ(threshold=threshold),
        )
        model.fit(x, t=t)
        return dict(
            status="candidate-not-verified",
            equations=model.equations(),
            coefficients=model.coefficients().tolist(),
            feature_names=model.get_feature_names(),
        )

"""Fit canonical Hamiltonians from measured vector fields, with explicit assumptions."""

import numpy as np
from .non_polynomial import Expression
from .polynomial import Polynomial
from .verification import PolynomialVerifier


class HamiltonianSearch:
    def __init__(self, variables, basis):
        if (
            not len(variables) % 2 == 0
            or not 2 <= len(variables) <= 8
            or not 1 <= len(basis) <= 64
        ):
            raise ValueError("canonical variables/basis budget exceeded")
        self.variables = list(variables)
        self.basis = [Expression.parse(source, variables) for source in basis]

    def fit(self, states, derivatives):
        x = np.asarray(states, dtype=float)
        dx = np.asarray(derivatives, dtype=float)
        d = len(self.variables)
        half = d // 2
        if (
            x.shape != dx.shape
            or x.ndim != 2
            or x.shape[1] != d
            or not 16 <= len(x) <= 50000
            or not np.isfinite(x).all()
            or not np.isfinite(dx).all()
        ):
            raise ValueError("invalid canonical observations")
        columns = []
        for expression in self.basis:
            gradient = np.stack(
                [
                    expression.derivative(name).evaluate(x, self.variables)
                    for name in self.variables
                ],
                axis=1,
            )
            columns.append(np.c_[gradient[:, half:], -gradient[:, :half]])
        design = np.stack(columns, axis=-1)
        cut = int(0.75 * len(x))
        matrix = design[:cut].reshape(-1, len(self.basis))
        target = dx[:cut].ravel()
        coefficients = np.linalg.lstsq(matrix, target, rcond=1e-10)[0]
        h = Expression.constant(0)
        for c, expression in zip(coefficients, self.basis):
            h = Expression(
                "add",
                (h, Expression("mul", (Expression.constant(float(c)), expression))),
            )
        prediction = np.einsum("ndk,k->nd", design, coefficients)
        energy = h.evaluate(x, self.variables)
        # This generic algebraic cancellation assumes differentiability and the
        # canonical time-independent equations. It does not prove data obey them.
        names = ["dq", "dp"]
        lhs = Polynomial.parse("dq*dp-dp*dq", names)
        identity = (
            PolynomialVerifier()
            .identity(
                lhs,
                Polynomial.parse("0", names),
                model={
                    "assumptions": "time-independent differentiable canonical Hamiltonian model"
                },
            )
            .to_dict()
        )
        return {
            "status": "empirical_hamiltonian_candidate",
            "expression": h.simplify().text(),
            "tree": h.to_dict(),
            "variables": self.variables,
            "coefficients": coefficients.tolist(),
            "train_vector_mse": float(np.mean((prediction[:cut] - dx[:cut]) ** 2)),
            "heldout_vector_mse": float(np.mean((prediction[cut:] - dx[cut:]) ** 2)),
            "observed_energy_range": float(np.ptp(energy)),
            "canonical_algebra_identity": identity,
            "scope": "energy cancellation conditional on autonomous canonical model; no Noether symmetry discovery or integrator conservation claim",
        }

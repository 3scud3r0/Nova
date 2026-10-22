"""Exact model-relative proofs and optional SMT; no truth-by-checksum shortcut."""

from __future__ import annotations
from dataclasses import dataclass, asdict
import hashlib
from .polynomial import Polynomial
from nova.bioma.determinism import canonical_json


@dataclass(frozen=True)
class VerificationReceipt:
    status: str
    backend: str
    claim_sha256: str
    model_sha256: str
    assumptions: tuple[str, ...]
    details: dict

    def to_dict(self):
        return asdict(self)


def receipt(status, backend, claim, model=None, assumptions=(), details=None):
    return VerificationReceipt(
        status,
        backend,
        hashlib.sha256(canonical_json(claim)).hexdigest(),
        hashlib.sha256(canonical_json(model or {})).hexdigest(),
        tuple(assumptions),
        details or {},
    )


class PolynomialVerifier:
    def identity(self, lhs: Polynomial, rhs: Polynomial, *, model=None):
        difference = lhs - rhs
        claim = {
            "kind": "polynomial_identity",
            "lhs": lhs.to_dict(),
            "rhs": rhs.to_dict(),
        }
        return receipt(
            "proved" if not difference.terms else "refuted",
            "exact-rational-normalization-v1",
            claim,
            model,
            ("over rational/real variables in the encoded polynomial model",),
            {"residual": difference.to_dict()},
        )

    def invariant(self, invariant: Polynomial, vector_field: list[Polynomial]):
        if len(vector_field) != len(invariant.variables):
            raise ValueError("vector field dimension mismatch")
        derivative = invariant.constant(0)
        for i, component in enumerate(vector_field):
            derivative = derivative + invariant.derivative(i) * component
        model = {
            "variables": list(invariant.variables),
            "vector_field": [p.to_dict() for p in vector_field],
        }
        claim = {"kind": "continuous_ode_invariant", "invariant": invariant.to_dict()}
        return receipt(
            "proved" if not derivative.terms else "refuted",
            "exact-rational-lie-derivative-v1",
            claim,
            model,
            (
                "continuous polynomial ODE exactly as encoded; no claim about floating integrator or real world",
            ),
            {"lie_derivative": derivative.to_dict()},
        )


class Z3Verifier:
    def __init__(self, timeout_ms=5000):
        if not 1 <= timeout_ms <= 30000:
            raise ValueError("SMT timeout out of range")
        self.timeout = timeout_ms

    def identity(self, lhs: Polynomial, rhs: Polynomial, assumptions=()):
        if lhs.variables != rhs.variables or any(
            p.variables != lhs.variables for p in assumptions
        ):
            raise ValueError("variable context mismatch")
        claim = {
            "kind": "polynomial_identity",
            "lhs": lhs.to_dict(),
            "rhs": rhs.to_dict(),
        }
        model = {"domain": [p.to_dict() for p in assumptions]}
        try:
            import z3
        except ImportError:
            return receipt(
                "unavailable",
                "z3",
                claim,
                model,
                details={"reason": "install nova-research[science]"},
            )
        variables = {name: z3.Real(name) for name in lhs.variables}

        def encode(p):
            value = z3.RealVal(0)
            for powers, c in p.terms.items():
                term = z3.RealVal(f"{c.numerator}/{c.denominator}")
                for name, power in zip(p.variables, powers):
                    term *= variables[name] ** power
                value += term
            return value

        solver = z3.Solver()
        solver.set(timeout=self.timeout)
        for assumption in assumptions:
            solver.add(encode(assumption) >= 0)
        # Distinguish an empty assumption domain from a nonvacuous theorem.
        domain = solver.check()
        if domain != z3.sat:
            return receipt(
                "unknown" if domain == z3.unknown else "vacuous",
                "z3",
                claim,
                model,
                details={"domain": str(domain)},
            )
        solver.add(encode(lhs) != encode(rhs))
        result = solver.check()
        details = {"solver_version": z3.get_version_string(), "result": str(result)}
        if result == z3.sat:
            details["counterexample"] = {
                name: str(solver.model().eval(v, model_completion=True))
                for name, v in variables.items()
            }
        return receipt(
            "proved"
            if result == z3.unsat
            else "refuted"
            if result == z3.sat
            else "unknown",
            "z3",
            claim,
            model,
            ("only within the encoded nonempty real-polynomial domain",),
            details,
        )

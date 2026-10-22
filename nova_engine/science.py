"""Optional scientific adapters. Dependency and verification failures stay explicit."""
from pathlib import Path
import hashlib
import json
import subprocess
import numpy as np


def discover_pysr(x, y, *, iterations=40, seed=42):
    from pysr import PySRRegressor
    x, y = np.asarray(x, float), np.asarray(y, float)
    if (x.ndim != 2 or x.shape[0] != y.size or x.size > 10_000_000
            or not np.isfinite(x).all() or not np.isfinite(y).all()):
        raise ValueError("invalid regression samples")
    model = PySRRegressor(niterations=iterations, binary_operators=["+", "-", "*"],
                          unary_operators=[], random_state=seed, deterministic=True,
                          parallelism="serial", maxsize=20)
    model.fit(x, y)
    return {"equations": model.equations_.to_dict(orient="records"),
            "status": "candidate_not_verified", "physical_truth_proved": False}


def verify_lean(project, source, *, timeout=120):
    """Compile an explicitly selected local Lean file under a local mathlib project.

    This executes the project's Lean toolchain. Never feed untrusted received source.
    """
    root, file = Path(project).resolve(), Path(source).resolve()
    if not file.is_relative_to(root) or file.suffix != ".lean":
        raise ValueError("Lean source must be inside the selected project")
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    try:
        proc = subprocess.run(["lake", "env", "lean", str(file.relative_to(root))],
                              cwd=root, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "source_sha256": digest, "physical_truth_proved": False}
    except FileNotFoundError:
        return {"status": "unavailable", "source_sha256": digest, "physical_truth_proved": False}
    # Lean accepts `sorry`; a successful exit alone is not a closed proof receipt.
    source_text = file.read_text()
    import re
    unchecked = bool(re.search(r"\b(sorry|admit|axiom|unsafe)\b", source_text))
    return {"status": "proved" if proc.returncode == 0 and not unchecked else "unverified",
            "source_sha256": digest, "returncode": proc.returncode,
            "diagnostics": (proc.stdout + proc.stderr)[-16384:],
            "scope": "selected Lean declaration; inspect axioms with #print axioms",
            "physical_truth_proved": False}


def z3_counterexample(coefficients, bounds):
    """Ask whether a supplied linear identity can be nonzero over a finite box."""
    import z3
    if len(coefficients) != len(bounds) + 1:
        raise ValueError("one intercept plus one coefficient per bounded variable required")
    variables = [z3.Real(f"x{i}") for i in range(len(bounds))]
    solver = z3.Solver()
    solver.set(timeout=10000)
    for variable, (lo, hi) in zip(variables, bounds):
        if not np.isfinite([lo, hi]).all() or lo > hi:
            raise ValueError("invalid bounds")
        solver.add(variable >= str(lo), variable <= str(hi))
    if not np.isfinite(coefficients).all():
        raise ValueError("nonfinite coefficients")
    expression = z3.RealVal(str(coefficients[0])) + sum(
        z3.RealVal(str(c)) * v for c, v in zip(coefficients[1:], variables))
    solver.add(expression != 0)
    result = solver.check()
    return {"status": str(result), "counterexample": str(solver.model()) if result == z3.sat else None,
            "scope": "exact rational coefficients within supplied bounds, not empirical validation"}


class PersistentGate:
    """Vietoris-Rips H0/H1/H2 on bounded samples, with temporal persistence tracking."""
    def __init__(self, *, min_lifetime=0.2, consecutive_frames=10, max_points=128):
        if not 4 <= max_points <= 256 or min_lifetime <= 0 or consecutive_frames < 1:
            raise ValueError("invalid persistent-homology budget")
        self.threshold, self.required, self.limit = min_lifetime, consecutive_frames, max_points
        self.streak = 0

    def observe(self, positions):
        from ripser import ripser
        points = np.asarray(positions, float)
        if points.ndim != 2 or points.shape[1] != 3 or not np.isfinite(points).all():
            raise ValueError("expected finite (N,3) positions")
        # Caller should preserve stable particle IDs across observations.
        points = points[:self.limit]
        diagrams = ripser(points, maxdim=2)["dgms"] if len(points) >= 4 else []
        rich = any(np.any((d[:, 1] - d[:, 0]) > self.threshold)
                   for d in diagrams[1:] if len(d))
        self.streak = self.streak + 1 if rich else 0
        return {"accepted": self.streak >= self.required, "streak": self.streak,
                "diagrams": [d.tolist() for d in diagrams], "sample_size": len(points),
                "scope": "persistent features of a subsample; consecutive presence is not identity tracking"}


def causal_intervention(factory, action, observables, *, ticks=100):
    """Paired deterministic control/intervention, not causal discovery from correlation."""
    control, treated = factory(), factory()
    action(treated)
    control.step(ticks)
    treated.step(ticks)
    a, b = np.asarray(observables(control)), np.asarray(observables(treated))
    return {"control": a.tolist(), "intervention": b.tolist(), "effect": (b-a).tolist(),
            "scope": "one intervention in the declared simulator; no real-world causal claim"}

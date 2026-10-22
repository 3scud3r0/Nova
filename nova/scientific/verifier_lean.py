"""Lean adapter for internally generated polynomial identities, never peer code."""

from pathlib import Path
import shutil
import subprocess
import tempfile
from .polynomial import Polynomial
from .verification import receipt


class LeanVerifier:
    """Requires a user-provisioned Lean4 + Mathlib project. No network downloads.

    Only bounded expressions regenerated from Polynomial objects are compiled.
    Remote .lean files, tactics, #eval and arbitrary imports are not accepted.
    """

    def __init__(self, project, timeout=30):
        self.project = Path(project).resolve()
        self.timeout = timeout
        if not 1 <= timeout <= 120:
            raise ValueError("Lean timeout out of range")

    @staticmethod
    def _expression(p):
        pieces = []
        for powers, c in sorted(p.terms.items()):
            factors = [f"(({c.numerator} : ℝ) / {c.denominator})"]
            factors.extend(
                f"({name} ^ {power})"
                for name, power in zip(p.variables, powers)
                if power
            )
            pieces.append(" * ".join(factors))
        return " + ".join(pieces) or "(0 : ℝ)"

    def identity(self, lhs: Polynomial, rhs: Polynomial):
        if lhs.variables != rhs.variables:
            raise ValueError("variable context mismatch")
        claim = {
            "kind": "polynomial_identity",
            "lhs": lhs.to_dict(),
            "rhs": rhs.to_dict(),
        }
        if not self.project.is_dir() or not shutil.which("lake"):
            return receipt(
                "unavailable",
                "lean4-mathlib",
                claim,
                details={"reason": "local lake/Mathlib project required"},
            )
        names = " ".join(lhs.variables)
        source = f"import Mathlib\nset_option maxHeartbeats 200000\nexample ({names} : ℝ) : {self._expression(lhs)} = {self._expression(rhs)} := by\n  ring\n"
        with tempfile.TemporaryDirectory(
            prefix=".nova-proof-", dir=self.project
        ) as directory:
            path = Path(directory) / "Claim.lean"
            path.write_text(source)
            try:
                result = subprocess.run(
                    ["lake", "env", "lean", str(path)],
                    cwd=self.project,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout,
                    check=False,
                )
                version = subprocess.run(
                    ["lake", "env", "lean", "--version"],
                    cwd=self.project,
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                return receipt(
                    "unknown", "lean4-mathlib", claim, details={"reason": "timeout"}
                )
        return receipt(
            "proved" if result.returncode == 0 else "not_proved",
            "lean4-mathlib",
            claim,
            assumptions=(
                "generated real-polynomial identity, Mathlib ring tactic and local toolchain",
            ),
            details={
                "returncode": result.returncode,
                "lean_version": version.stdout.strip()[:512],
                "diagnostics": (result.stdout + result.stderr)[-8192:],
            },
        )

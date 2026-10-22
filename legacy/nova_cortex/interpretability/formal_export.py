"""Safe polynomial candidate export. Definitions are not proofs of recovered physics."""

from fractions import Fraction
from pathlib import Path
import json
import hashlib


def _coefficient(value):
    # The rational approximation is a declared modeling step, not an exact fit.
    return Fraction(float(value)).limit_denominator(1_000_000)


def polynomial_field(result, *, variables=None):
    dimension = int(result["dimension"])
    terms, coefficients = result["terms"], result["coefficients"]
    if not 1 <= dimension <= 16 or len(terms) != len(coefficients):
        raise ValueError("invalid symbolic result")
    if any(term["kind"] not in {"constant", "polynomial"} for term in terms):
        raise ValueError("formal polynomial export requires a nontrigonometric library")
    field = []
    for output in range(dimension):
        rows = []
        for term, coefficient in zip(terms, coefficients):
            value = _coefficient(coefficient[output])
            if not value:
                continue
            powers = [0] * dimension
            for axis in term["axes"]:
                if not 0 <= axis < dimension:
                    raise ValueError("invalid polynomial axis")
                powers[axis] += 1
            rows.append(
                dict(
                    numerator=str(value.numerator),
                    denominator=str(value.denominator),
                    powers=powers,
                )
            )
        field.append(rows)
    return field


def export_candidate(result, directory, *, invariant=None):
    root = Path(directory)
    if root.exists() and any(root.iterdir()):
        raise ValueError("candidate output must be empty")
    root.mkdir(parents=True, exist_ok=True)
    field = polynomial_field(result)
    dimension = len(field)
    # A caller may explicitly select another polynomial invariant. Sum of squares
    # is a hypothesis for auditing, not inferred from an HNN/Noether argument.
    if invariant is None:
        invariant = [
            dict(
                numerator="1",
                denominator="1",
                powers=[2 if j == i else 0 for j in range(dimension)],
            )
            for i in range(dimension)
        ]
    claim = dict(variables=dimension, invariant=invariant, field=field)
    claim_bytes = json.dumps(claim, sort_keys=True, indent=2).encode()
    (root / "candidate_claim.json").write_bytes(claim_bytes)
    names = [f"x{i}" for i in range(dimension)]
    arguments = " ".join(names)
    lean = [
        "import Mathlib",
        "-- Candidate definitions only. No recovered physical law is asserted.",
        "-- Coefficients are rational approximations of a finite-data fit.",
    ]
    for i, rows in enumerate(field):
        expressions = []
        for term in rows:
            factors = [f"(({term['numerator']} : ℝ) / ({term['denominator']} : ℝ))"]
            factors.extend(
                f"{names[j]} ^ {power}"
                for j, power in enumerate(term["powers"])
                if power
            )
            expressions.append(" * ".join(factors))
        expression = " + ".join(expressions) or "0"
        lean.append(f"def candidate_{i} ({arguments} : ℝ) : ℝ := {expression}")
    (root / "Candidate.lean").write_text("\n".join(lean) + "\n")
    (root / "receipt.json").write_text(
        json.dumps(
            dict(
                status="pending",
                source_sha256=hashlib.sha256(claim_bytes).hexdigest(),
                rational_denominator_limit=1_000_000,
                lean_status="not-executed",
                physical_truth_proved=False,
                scope="Run nova verify --claim candidate_claim.json; any identity concerns this fitted ODE only",
            ),
            indent=2,
        )
    )
    return claim


def audit_candidate(directory, nova_binary, *, lean_project=None, timeout=120):
    """Execute only the explicitly selected native verifier and generated Lean.

    The generated theorem is conditional on the fitted polynomial ODE, even if
    both exact arithmetic and Lean succeed. It never certifies the empirical fit.
    """
    import subprocess
    import tempfile

    root = Path(directory).resolve()
    claim = json.loads((root / "candidate_claim.json").read_text())
    receipt_path = root / "exact-receipt.json"
    subprocess.run(
        [
            str(Path(nova_binary).resolve()),
            "verify",
            "--claim",
            str(root / "candidate_claim.json"),
            "--output",
            str(receipt_path),
        ],
        check=True,
        timeout=timeout,
        stdout=subprocess.DEVNULL,
    )
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("reward") != 1 or receipt.get("status") != "verified":
        return dict(exact=receipt, lean_status="not-attempted-refuted-identity")
    expressions = []
    n = claim["variables"]
    for axis in range(n):
        for invariant in claim["invariant"]:
            if not invariant["powers"][axis]:
                continue
            for term in claim["field"][axis]:
                value = Fraction(invariant["numerator"]) / Fraction(
                    invariant["denominator"]
                )
                value *= (
                    invariant["powers"][axis]
                    * Fraction(term["numerator"])
                    / Fraction(term["denominator"])
                )
                powers = [
                    a + b - int(i == axis)
                    for i, (a, b) in enumerate(zip(invariant["powers"], term["powers"]))
                ]
                factors = [f"(({value.numerator} : ℝ) / ({value.denominator} : ℝ))"]
                factors.extend(
                    f"x{i} ^ {power}" for i, power in enumerate(powers) if power
                )
                expressions.append(" * ".join(factors))
    arguments = " ".join(f"x{i}" for i in range(n))
    expression = " + ".join(expressions) or "0"
    source = (
        "import Mathlib\n-- Identity only for the declared fitted polynomial ODE.\n"
        + f"theorem candidate_lie_identity ({arguments} : ℝ) : ({expression}) = 0 := by ring\n"
    )
    (root / "CandidateInvariant.lean").write_text(source)
    result = dict(
        exact=receipt,
        lean_status="pending",
        physical_truth_proved=False,
        lean_source_sha256=hashlib.sha256(source.encode()).hexdigest(),
    )
    if lean_project is not None:
        project = Path(lean_project).resolve()
        with tempfile.TemporaryDirectory(
            prefix="nova-proof-", dir=project
        ) as temporary:
            file = Path(temporary) / "CandidateInvariant.lean"
            file.write_text(source)
            try:
                process = subprocess.run(
                    ["lake", "env", "lean", str(file)],
                    cwd=project,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=timeout,
                )
                result["lean_status"] = (
                    "verified" if process.returncode == 0 else "unverified"
                )
            except subprocess.TimeoutExpired:
                result["lean_status"] = "timeout"
            except FileNotFoundError:
                result["lean_status"] = "unavailable"
    (root / "audit.json").write_text(json.dumps(result, indent=2))
    return result

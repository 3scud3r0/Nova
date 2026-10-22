"""Append-only scientific rows with explicit evidence classes and provenance."""

from pathlib import Path
import hashlib
import os
import re
from .polynomial import Polynomial
from .verification import PolynomialVerifier
from nova.bioma.determinism import canonical_json, strict_json


class DatasetSynthesizer:
    """Generated observations are not upgraded to facts by a remote signature.

    Optional formal claims are locally rechecked using the exact polynomial
    checker. A proof covers the encoded model identity, not every numeric row.
    """

    def __init__(self, directory, *, max_rows=100000, max_row_bytes=262144):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "observations.jsonl"
        self.max_rows = max_rows
        self.max_row_bytes = max_row_bytes
        self.count = 0
        self.head = "0" * 64
        if self.path.exists():
            with self.path.open("rb") as stream:
                for line in stream:
                    if len(line) > max_row_bytes:
                        raise ValueError("existing row exceeds budget")
                    row = strict_json(line, max_row_bytes)
                    digest = row.pop("row_sha256")
                    if (
                        row["previous"] != self.head
                        or hashlib.sha256(canonical_json(row)).hexdigest() != digest
                    ):
                        raise ValueError("dataset chain corrupted")
                    self.head = digest
                    self.count += 1
            if self.count > max_rows:
                raise ValueError("dataset row budget exceeded")

    def append(self, observation, *, seed_digest, units, claim=None):
        if self.count >= self.max_rows:
            raise ValueError("dataset row budget exceeded")
        if not re.fullmatch(r"[0-9a-f]{64}", seed_digest):
            raise ValueError("source seed artifact digest required")
        verification = None
        label = "simulation_observation"
        if claim:
            variables = claim["variables"]
            lhs = Polynomial.parse(claim["lhs"], variables)
            rhs = Polynomial.parse(claim["rhs"], variables)
            verification = (
                PolynomialVerifier()
                .identity(lhs, rhs, model=claim.get("model"))
                .to_dict()
            )
            label = (
                "observation_with_model_identity"
                if verification["status"] == "proved"
                else "observation_with_unproved_candidate"
            )
        row = {
            "schema": "NOVA-DATASET-ROW-v1",
            "index": self.count,
            "previous": self.head,
            "seed_digest": seed_digest,
            "observation": observation,
            "units": dict(units),
            "evidence_class": label,
            "verification": verification,
        }
        raw = canonical_json(row)
        digest = hashlib.sha256(raw).hexdigest()
        row["row_sha256"] = digest
        encoded = canonical_json(row) + b"\n"
        if len(encoded) > self.max_row_bytes:
            raise ValueError("scientific row exceeds budget")
        with self.path.open("ab") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        self.head = digest
        self.count += 1
        return digest

    def manifest(self):
        result = {
            "schema": "NOVA-DATASET-v1",
            "rows": self.count,
            "head": self.head,
            "file": "observations.jsonl",
            "evidence_policy": "simulation observations and scoped model identities; no universal real-world truth guarantee",
        }
        (self.directory / "manifest.json").write_bytes(canonical_json(result))
        return result

"""Append-only, representation-scoped feature labels with held-out evidence."""

from dataclasses import dataclass, asdict
import hashlib
import json
import sqlite3


@dataclass(frozen=True)
class Concept:
    representation_sha256: str
    feature_id: int
    label: str
    activation_threshold: float
    physical_variable: str
    evidence: dict
    causal_score: float | None = None
    status: str = "probe-association"

    def validate(self):
        import math

        if (
            len(self.representation_sha256) != 64
            or any(c not in "0123456789abcdef" for c in self.representation_sha256)
            or not 0 <= self.feature_id < 32768
            or not 1 <= len(self.label) <= 256
            or not 1 <= len(self.physical_variable) <= 128
            or not math.isfinite(self.activation_threshold)
            or self.activation_threshold < 0
            or self.status
            not in {"provisional", "probe-association", "intervention-supported"}
        ):
            raise ValueError("invalid catalog concept")
        if len(json.dumps(self.evidence, allow_nan=False)) > 16384:
            raise ValueError("evidence too large")
        if self.status != "provisional":
            if (
                not self.evidence.get("dataset_sha256")
                or self.evidence.get("heldout_samples", 0) < 8
            ):
                raise ValueError(
                    "audited labels need dataset identity and held-out samples"
                )
            r2, accuracy = (
                self.evidence.get("heldout_r2"),
                self.evidence.get("heldout_accuracy"),
            )
            if not any(
                isinstance(score, (int, float))
                and math.isfinite(score)
                and score >= 0.98
                for score in (r2, accuracy)
            ):
                raise ValueError(
                    "catalog association requires declared held-out R2/accuracy >= .98; this remains association, not proof"
                )
        if self.causal_score is not None:
            if (
                not math.isfinite(self.causal_score)
                or not 0 <= self.causal_score <= 1
                or not self.evidence.get("paired_intervention")
                or self.status != "intervention-supported"
            ):
                raise ValueError("causal score requires paired intervention evidence")
        return self


class MonosemanticCatalog:
    def __init__(self, filename):
        self.connection = sqlite3.connect(str(filename))
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS concepts (representation TEXT, feature INTEGER, digest TEXT UNIQUE, payload TEXT, PRIMARY KEY(representation,feature))"
        )
        self.connection.execute(
            "CREATE TRIGGER IF NOT EXISTS immutable_update BEFORE UPDATE ON concepts BEGIN SELECT RAISE(ABORT,'append-only catalog'); END"
        )
        self.connection.execute(
            "CREATE TRIGGER IF NOT EXISTS immutable_delete BEFORE DELETE ON concepts BEGIN SELECT RAISE(ABORT,'append-only catalog'); END"
        )
        self.connection.commit()

    def register(self, concept):
        concept.validate()
        payload = json.dumps(asdict(concept), sort_keys=True, allow_nan=False)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        with self.connection:
            self.connection.execute(
                "INSERT INTO concepts VALUES (?,?,?,?)",
                (concept.representation_sha256, concept.feature_id, digest, payload),
            )
        return digest

    def lookup(self, representation, feature):
        row = self.connection.execute(
            "SELECT payload FROM concepts WHERE representation=? AND feature=?",
            (representation, int(feature)),
        ).fetchone()
        return Concept(**json.loads(row[0])) if row else None

    def close(self):
        self.connection.close()

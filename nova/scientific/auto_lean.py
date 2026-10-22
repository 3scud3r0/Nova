"""Opt-in proof spool worker. Only bounded regenerated identities enter Lean."""

from __future__ import annotations
import hashlib
import os
from pathlib import Path
import threading
from .polynomial import Polynomial
from .verification import PolynomialVerifier
from .verifier_lean import LeanVerifier
from nova.bioma.determinism import canonical_json, strict_json
from nova.swarm.artifacts import atomic


class ProofDaemon:
    def __init__(self, directory, *, lean_project=None, max_jobs=128, poll_seconds=2):
        self.directory = Path(directory)
        self.queue = self.directory / "pending"
        self.receipts = self.directory / "receipts"
        self.theorems = self.directory / "theorems"
        for path in (self.queue, self.receipts, self.theorems):
            path.mkdir(parents=True, exist_ok=True)
        if not 1 <= max_jobs <= 1024 or not 0.1 <= poll_seconds <= 60:
            raise ValueError("proof worker budget exceeded")
        self.max_jobs = max_jobs
        self.poll_seconds = poll_seconds
        self.lean = LeanVerifier(lean_project) if lean_project else None
        self.stop = threading.Event()

    def submit(self, lhs, rhs, variables, *, model=None):
        left, right = Polynomial.parse(lhs, variables), Polynomial.parse(rhs, variables)
        task = {
            "schema": "NOVA-PROOF-TASK-v1",
            "lhs": left.expression(),
            "rhs": right.expression(),
            "variables": list(variables),
            "model": model or {},
        }
        raw = canonical_json(task)
        if len(raw) > 32768 or len(list(self.queue.glob("*.json"))) >= self.max_jobs:
            raise ValueError("proof queue budget exceeded")
        key = hashlib.sha256(raw).hexdigest()
        atomic(self.queue / (key + ".json"), raw)
        return key

    def process_once(self):
        with (self.directory / ".worker.lock").open("a+b") as lock:
            try:
                if os.name == "nt":
                    import msvcrt

                    lock.seek(0)
                    lock.write(b"0")
                    lock.flush()
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except (BlockingIOError, OSError):
                return []
            try:
                return self._process_unlocked()
            finally:
                if os.name == "nt":
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def _process_unlocked(self):
        results = []
        for path in sorted(self.queue.glob("*.json"))[: self.max_jobs]:
            key = path.stem
            if len(key) != 64:
                continue
            if (self.receipts / (key + ".json")).exists():
                path.unlink()
                continue
            try:
                if path.stat().st_size > 32768:
                    raise ValueError("proof task too large")
                raw = path.read_bytes()
                if hashlib.sha256(raw).hexdigest() != key:
                    raise ValueError("task content address mismatch")
                task = strict_json(raw, 32768)
                if task["schema"] != "NOVA-PROOF-TASK-v1":
                    raise ValueError("unknown task schema")
                lhs = Polynomial.parse(task["lhs"], task["variables"])
                rhs = Polynomial.parse(task["rhs"], task["variables"])
                exact = (
                    PolynomialVerifier()
                    .identity(lhs, rhs, model=task.get("model"))
                    .to_dict()
                )
                result = {
                    "job": key,
                    "exact": exact,
                    "lean": {"status": "unavailable"},
                    "physical_truth_proved": False,
                }
                if exact["status"] == "proved" and self.lean:
                    receipt = self.lean.identity(lhs, rhs).to_dict()
                    result["lean"] = receipt
                    if receipt["status"] == "proved":
                        # Same safe generator as the adapter; peer-supplied Lean source is never used.
                        source = self.lean.source(lhs, rhs)
                        if (
                            hashlib.sha256(source.encode()).hexdigest()
                            != receipt["details"]["source_sha256"]
                        ):
                            raise ValueError(
                                "proof source differs from compiled source"
                            )
                        file = self.theorems / ("thm_" + key + ".lean")
                        atomic(file, source.encode())
                        result["lean_file"] = str(file)
                atomic(self.receipts / (key + ".json"), canonical_json(result))
                results.append(result)
                path.unlink()
            except (
                ValueError,
                TypeError,
                KeyError,
                SyntaxError,
                RecursionError,
                OSError,
            ) as error:
                result = {"job": key, "status": "rejected", "reason": str(error)[:512]}
                atomic(self.receipts / (key + ".json"), canonical_json(result))
                path.unlink()
                results.append(result)
        return results

    def run(self):
        while not self.stop.is_set():
            self.process_once()
            self.stop.wait(self.poll_seconds)

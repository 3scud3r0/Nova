"""Signed reproducible counterexample searches. Finite survival is never a theorem."""

from __future__ import annotations
import hashlib
import time
import numpy as np
from nova.bioma.determinism import canonical_json, SplitMix64
from nova.scientific.non_polynomial import Expression
from .artifacts import SigningIdentity


def make_challenge(
    identity,
    lhs,
    rhs,
    variables,
    bounds,
    *,
    kind="identity",
    seed=0,
    samples=512,
    ttl=86400,
):
    Expression.parse(lhs, variables)
    Expression.parse(rhs, variables)
    return identity.sign(
        {
            "schema": "NOVA-CHALLENGE-v1",
            "kind": kind,
            "lhs": lhs,
            "rhs": rhs,
            "variables": list(variables),
            "bounds": bounds,
            "seed": seed,
            "samples": samples,
            "issued": int(time.time()),
            "deadline": int(time.time()) + ttl,
            "scope": "declared finite-domain model only; no universal physical-law certification",
        }
    )


class CrossValidationWorker:
    def __init__(self, identity, *, max_jobs=128, max_samples=4096):
        if not 1 <= max_jobs <= 256 or not 16 <= max_samples <= 8192:
            raise ValueError("validation worker budget exceeded")
        self.identity = identity
        self.max_jobs = max_jobs
        self.max_samples = max_samples
        self.pending = {}
        self.receipts = {}
        self.completed = 0
        self.max_completed = 4096

    def enqueue(self, envelope, expected_peer):
        peer, claim = SigningIdentity.verify(envelope, expected_peer)
        raw = canonical_json(envelope)
        if (
            len(raw) > 32768
            or len(self.pending) >= self.max_jobs
            or self.completed >= self.max_completed
        ):
            raise ValueError("challenge queue size exceeded")
        if (
            claim.get("schema") != "NOVA-CHALLENGE-v1"
            or claim["kind"] not in ("identity", "oscillator_invariant")
            or not time.time() < claim["deadline"] <= claim["issued"] + 86400
            or claim["issued"] > time.time() + 120
        ):
            raise ValueError("invalid challenge kind/deadline")
        variables = claim["variables"]
        left = Expression.parse(claim["lhs"], variables)
        right = Expression.parse(claim["rhs"], variables)
        bounds = np.asarray(claim["bounds"], dtype=float)
        if (
            bounds.shape != (len(variables), 2)
            or not np.isfinite(bounds).all()
            or np.any(bounds[:, 0] >= bounds[:, 1])
            or np.any(abs(bounds) > 1e4)
            or type(claim["samples"]) is not int
            or not 16 <= claim["samples"] <= self.max_samples
        ):
            raise ValueError("challenge sampling budget/domain exceeded")
        SplitMix64(claim["seed"])
        if claim["kind"] == "oscillator_invariant" and variables != ["q", "p"]:
            raise ValueError("oscillator model requires q,p coordinates")
        key = hashlib.sha256(raw).hexdigest()
        if key not in self.receipts:
            self.pending[key] = (envelope, left, right)
        return {
            "challenge": key,
            "status": "queued" if key in self.pending else "already_evaluated",
            "truth_certified": False,
        }

    def process_once(self, limit=2):
        results = []
        for key in list(self.pending)[: min(limit, 8)]:
            envelope, left, right = self.pending.pop(key)
            claim = envelope["payload"]
            bounds = np.asarray(claim["bounds"])
            rng = SplitMix64(claim["seed"] ^ int(self.identity.peer_id[:16], 16))
            points = bounds[:, 0] + rng.uniform((claim["samples"], len(bounds))) * (
                bounds[:, 1] - bounds[:, 0]
            )
            # Explicit extremes plus independent per-peer random samples.
            points[0] = bounds[:, 0]
            points[1] = bounds[:, 1]
            status = "no_counterexample_within_budget"
            counterexample = None
            try:
                if time.time() > claim["deadline"]:
                    raise TimeoutError("challenge expired")
                if claim["kind"] == "identity":
                    a = left.evaluate(points, claim["variables"])
                    b = right.evaluate(points, claim["variables"])
                else:
                    a = (
                        left.derivative("q").evaluate(points, ["q", "p"]) * points[:, 1]
                        - left.derivative("p").evaluate(points, ["q", "p"])
                        * points[:, 0]
                    )
                    b = right.evaluate(points, ["q", "p"])
                scale = 1 + np.maximum(abs(a), abs(b))
                residual = np.abs(a / scale - b / scale)
                bad = np.flatnonzero(residual > 1e-8)
                if len(bad):
                    i = int(bad[0])
                    status = "counterexample_found"
                    counterexample = {
                        "point": points[i].tolist(),
                        "lhs": float(a[i]),
                        "rhs": float(b[i]),
                        "relative_residual": float(residual[i]),
                    }
            except TimeoutError:
                status = "expired"
            except ValueError:
                status = "domain_inconclusive"
            payload = {
                "schema": "NOVA-ATTESTATION-v1",
                "challenge": key,
                "status": status,
                "counterexample": counterexample,
                "samples": len(points),
                "effective_seed": claim["seed"] ^ int(self.identity.peer_id[:16], 16),
                "sampling": "SplitMix64 uniform plus two extremes",
                "scope": claim["scope"],
                "formal_proof": False,
                "finished": int(time.time()),
            }
            receipt = self.identity.sign(payload)
            self.receipts[key] = receipt
            self.completed += 1
            results.append(receipt)
            while len(self.receipts) > 1024:
                self.receipts.pop(next(iter(self.receipts)))
        return results


def aggregate_attestations(receipts, challenge):
    if len(receipts) > 256:
        raise ValueError("attestation aggregation budget exceeded")
    unique = {}
    for envelope in receipts:
        peer, payload = SigningIdentity.verify(envelope)
        if (
            payload.get("schema") != "NOVA-ATTESTATION-v1"
            or payload["challenge"] != challenge
        ):
            raise ValueError("attestation context mismatch")
        if payload["status"] not in (
            "counterexample_found",
            "no_counterexample_within_budget",
            "domain_inconclusive",
            "expired",
        ):
            raise ValueError("unknown evidence status")
        unique[peer] = payload
    refutations = [p for p in unique.values() if p["status"] == "counterexample_found"]
    return {
        "challenge": challenge,
        "independent_keys": len(unique),
        "status": "reported_counterexample"
        if refutations
        else "finite_unrefuted_evidence"
        if any(
            p["status"] == "no_counterexample_within_budget" for p in unique.values()
        )
        else "inconclusive",
        "counterexamples": [p["counterexample"] for p in refutations],
        "formal_proof": False,
        "scope": "signatures attest reports; independent keys do not establish independent people, honest execution or universal truth",
    }

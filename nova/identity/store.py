"""Local identity vault with AES-GCM, provenance, review and source-level erasure.

Consent is an explicit local authorization record, not proof of legal authority.
Keys belong in the caller's secret manager. This local API has no network listener.
"""

from __future__ import annotations
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
import base64
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any
import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from nova.continual import ProtectedLinear
from nova.values import OutputPolicy, SIMULATION_LABEL


class ConsentError(PermissionError):
    pass


def timestamp(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("timestamps require timezone")
    return result.astimezone(timezone.utc)


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".nova-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, 0o600)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


class ConsentRegistry:
    def __init__(self, path):
        self.path = Path(path)
        if self.path.name != "consent.json":
            raise ValueError("consent record must be named consent.json")

    def check(self, subject, actor, purpose="memory", allow_revoked=False):
        if not self.path.is_file():
            raise ConsentError("consent.json is required before processing data")
        data = json.loads(self.path.read_text())
        if data.get("subject_id") != subject or actor not in data.get(
            "authorized_principals", []
        ):
            raise ConsentError("principal or subject not authorized")
        if not data.get("granted") or not data.get("authority"):
            raise ConsentError("explicit consent and authority required")
        if not allow_revoked:
            if data.get("revoked") or purpose not in data.get("purposes", []):
                raise ConsentError("consent revoked or purpose not authorized")
            if timestamp(data["granted_at"]) > datetime.now(timezone.utc):
                raise ConsentError("consent is not yet valid")
            if data.get("expires_at") and timestamp(data["expires_at"]) <= datetime.now(
                timezone.utc
            ):
                raise ConsentError("consent expired")
        return data


def embedding(text, dimension=32):
    """Deterministic hashed bag of tokens; a retrieval baseline, not a language model."""
    result = np.zeros(dimension)
    for token in re.findall(r"\w+", text.casefold()):
        digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "little") % dimension
        result[index] += 1 if digest[4] & 1 else -1
    return result / max(np.linalg.norm(result), 1.0)


class IdentityStore:
    ALLOWED_KINDS = frozenset(
        {
            "message",
            "diary",
            "transcript",
            "photo_caption",
            "calendar",
            "document",
            "interview",
        }
    )

    def __init__(
        self,
        directory,
        consent_path,
        subject_id,
        actor,
        key: bytes | None = None,
        *,
        erasure_only: bool = False,
    ):
        self.directory = Path(directory)
        self.consent = ConsentRegistry(consent_path)
        self.subject_id = subject_id
        self.actor = actor
        self.erasure_only = erasure_only
        self.consent.check(subject_id, actor, allow_revoked=erasure_only)
        if key is None:
            value = os.environ.get("NOVA_IDENTITY_KEY")
            if not value:
                raise ValueError(
                    "NOVA_IDENTITY_KEY must contain a base64 encoded 32-byte key"
                )
            key = base64.b64decode(value, validate=True)
        if len(key) != 32:
            raise ValueError("AES-256 requires a 32-byte key")
        self._key = hmac.digest(key, ("nova-profile:" + subject_id).encode(), "sha256")
        self.token = hashlib.sha256(subject_id.encode()).hexdigest()
        self.directory.mkdir(parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)
        self.path = self.directory / (self.token + ".enc")
        self.lock_path = self.directory / (self.token + ".lock")

    def _check(self, purpose="memory", allow_revoked=False):
        if self.erasure_only and not allow_revoked:
            raise ConsentError("this handle permits erasure only")
        return self.consent.check(self.subject_id, self.actor, purpose, allow_revoked)

    @contextmanager
    def _locked(self):
        fd = os.open(self.lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        with os.fdopen(fd, "a+b") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)

    def _audit(self, action):
        # No names, content, fact values or keys in access logs.
        row = {
            "profile": self.token,
            "actor": hashlib.sha256(self.actor.encode()).hexdigest(),
            "action": action,
            "at": now(),
        }
        fd = os.open(
            self.directory / "access.jsonl",
            os.O_APPEND | os.O_CREAT | os.O_WRONLY,
            0o600,
        )
        with os.fdopen(fd, "a") as stream:
            stream.write(json.dumps(row) + "\n")

    def _read(self):
        if not self.path.exists():
            return {"version": 1, "records": [], "reviewed": False, "derived": {}}
        blob = self.path.read_bytes()
        data = AESGCM(self._key).decrypt(blob[:12], blob[12:], self.token.encode())
        result = json.loads(data)
        if result.get("version") != 1:
            raise ValueError("unsupported vault version")
        return result

    def _write(self, data):
        nonce = os.urandom(12)
        raw = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
        atomic_write(
            self.path,
            nonce + AESGCM(self._key).encrypt(nonce, raw, self.token.encode()),
        )

    def _minimize(self, text, participants):
        text = str(text)
        for name in sorted(set(participants), key=len, reverse=True):
            if name and name != self.subject_id:
                alias = hmac.new(self._key, name.encode(), hashlib.sha256).hexdigest()[
                    :10
                ]
                text = re.sub(
                    re.escape(name), f"[terceiro:{alias}]", text, flags=re.IGNORECASE
                )
        text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email removido]", text)
        text = re.sub(r"(?<!\w)\+?\d[\d ()-]{7,}\d(?!\w)", "[telefone removido]", text)
        return text

    def _derive(self, records):
        facts = []
        events = []
        words = Counter()
        sentence_lengths = []
        values = []
        model = ProtectedLinear(32, 32, seed=0)
        model.dW[:] = -model.W_base.astype(float)
        for record in sorted(records, key=lambda r: r["id"]):
            source = record["id"]
            content = record["content"]
            words.update(re.findall(r"\w+", content.casefold()))
            sentence_lengths.extend(
                len(s.split()) for s in re.split(r"[.!?]+", content) if s.strip()
            )
            for fact in record["facts"]:
                facts.append(
                    {
                        **fact,
                        "subject": self.subject_id,
                        "source": source,
                        "timestamp": record["timestamp"],
                    }
                )
            for event in record["events"]:
                events.append({**event, "source": source})
            for value in record["values"]:
                values.append({**value, "source": source})
            x = embedding(content)[None]
            y = embedding(" ".join(f["value"] for f in record["facts"]))[None]
            for _ in range(20):
                model.step(x, y, 0.1)
            model.consolidate(x)
        style_allowed = "style" in json.loads(self.consent.path.read_text()).get(
            "purposes", []
        )
        return {
            "facts": facts,
            "events": sorted(events, key=lambda e: timestamp(e["timestamp"])),
            "style": {
                "common_words": words.most_common(20),
                "mean_sentence_words": float(np.mean(sentence_lengths))
                if sentence_lengths
                else 0.0,
            }
            if style_allowed
            else {},
            "values": values,
            "semantic_residual": model.dW.tolist(),
            "semantic_basis": model.U.tolist(),
            "free_dims": model.free_dims,
        }

    def ingest(self, source: dict[str, Any]):
        consent = self._check()
        if source.get("subject_id") not in [
            self.subject_id,
            *consent.get("aliases", []),
        ]:
            raise ConsentError("source is outside this subject scope")
        if source.get("kind") not in self.ALLOWED_KINDS:
            raise ValueError("unsupported source kind")
        if (
            not source.get("rights")
            or not source.get("id")
            or not source.get("content")
        ):
            raise ValueError("source id, content and rights are required")
        when = timestamp(source["timestamp"]).isoformat()
        participants = source.get("participants", [])
        clean = lambda text: self._minimize(text, participants)
        facts = []
        for fact in source.get("facts", []):
            if fact.get("subject_id", self.subject_id) != self.subject_id:
                raise ConsentError("third-party facts cannot enter this identity")
            confidence = float(fact.get("confidence", 1.0))
            if not 0 <= confidence <= 1:
                raise ValueError("invalid confidence")
            facts.append(
                {
                    "predicate": clean(fact["predicate"]),
                    "value": clean(fact["value"]),
                    "confidence": confidence,
                    "inference": bool(fact.get("inference", False)),
                }
            )
        events = []
        for event in source.get("events", []):
            events.append(
                {
                    "timestamp": timestamp(event.get("timestamp", when)).isoformat(),
                    "content": clean(event["content"]),
                    "location": clean(event.get("location", "")),
                    "participants": [self.subject_id],
                    "valence": float(np.clip(event.get("valence", 0.0), -1, 1)),
                    "anchor": bool(event.get("anchor", False)),
                }
            )
        values = []
        for value in source.get("values", []):
            if not value.get("evidence"):
                raise ValueError("value profile requires evidence")
            values.append(
                {
                    "dimension": clean(value["dimension"]),
                    "weight": float(np.clip(value["weight"], -1, 1)),
                    "evidence": clean(value["evidence"]),
                }
            )
        record = {
            "id": str(source["id"]),
            "kind": source["kind"],
            "rights": clean(source["rights"]),
            "timestamp": when,
            "content": clean(source["content"]),
            "facts": facts,
            "events": events,
            "values": values,
        }
        with self._locked():
            self._check()
            data = self._read()
            if any(r["id"] == record["id"] for r in data["records"]):
                raise ValueError(
                    "source id already exists; use a distinct correction source"
                )
            data["records"].append(record)
            data["derived"] = self._derive(data["records"])
            data["reviewed"] = False
            self._write(data)
            self._audit("ingest")
        return {
            "label": SIMULATION_LABEL,
            "source": record["id"],
            "review_required": True,
        }

    def ingest_file(self, path):
        self._check()  # Authorize before opening the data file.
        return self.ingest(json.loads(Path(path).read_text()))

    def review(self):
        self._check()
        with self._locked():
            data = self._read()
            data["reviewed"] = True
            self._write(data)
            self._audit("review")
        return {"label": SIMULATION_LABEL, "reviewed": True}

    def inspect(self):
        self._check()
        with self._locked():
            data = self._read()
            self._audit("inspect")
            return {"label": SIMULATION_LABEL, **data}

    def answer(self, predicate):
        self._check()
        with self._locked():
            data = self._read()
            self._audit("answer")
            if not data.get("reviewed"):
                return SIMULATION_LABEL + "\nOs dados aguardam revisão humana."
            facts = [
                f
                for f in data.get("derived", {}).get("facts", [])
                if f["predicate"] == predicate
            ]
            claims = [
                {
                    "text": f"{f['timestamp'][:10]}: {f['value']}",
                    "source": f["source"],
                    "inference": f["inference"],
                }
                for f in facts
            ]
            return OutputPolicy.render_claims(
                claims, identity_mode=True, consented=True
            )

    def timeline(self):
        data = self.inspect()
        return {
            "label": SIMULATION_LABEL,
            "events": data.get("derived", {}).get("events", []),
        }

    def delete_source(self, source_id):
        self._check(allow_revoked=True)
        with self._locked():
            data = self._read()
            before = len(data["records"])
            data["records"] = [r for r in data["records"] if r["id"] != source_id]
            data["derived"] = self._derive(data["records"])
            data["reviewed"] = False
            self._write(data)
            self._audit("delete_source")
            verified = not any(r["id"] == source_id for r in self._read()["records"])
        return {
            "label": SIMULATION_LABEL,
            "removed": before - len(data["records"]),
            "verified": verified,
            "derived_rebuilt": True,
        }

    def erase(self, revoke=True):
        self._check(allow_revoked=True)
        with self._locked():
            self.path.unlink(missing_ok=True)
            if revoke:
                consent = json.loads(self.consent.path.read_text())
                consent["revoked"] = True
                consent["revoked_at"] = now()
                atomic_write(self.consent.path, json.dumps(consent).encode())
            self._audit("erase")
        return {
            "label": SIMULATION_LABEL,
            "verified": not self.path.exists(),
            "scope": "active vault and its derived state; external copies are outside this store",
        }

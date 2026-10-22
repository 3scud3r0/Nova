"""Content-addressed blobs, Ed25519 identities and a locally append-only ledger."""

from __future__ import annotations
from datetime import datetime, timezone
import base64
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives import serialization
from nova.bioma.determinism import canonical_json, strict_json


HEX = re.compile(r"^[0-9a-f]{64}$")


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".nova-artifact-")
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class SigningIdentity:
    def __init__(self, key):
        self.key = key

    @classmethod
    def load_or_create(cls, path):
        path = Path(path)
        if path.exists():
            return cls(Ed25519PrivateKey.from_private_bytes(path.read_bytes()))
        path.parent.mkdir(parents=True, exist_ok=True)
        key = Ed25519PrivateKey.generate()
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(
                key.private_bytes(
                    serialization.Encoding.Raw,
                    serialization.PrivateFormat.Raw,
                    serialization.NoEncryption(),
                )
            )
        return cls(key)

    @property
    def public_key(self):
        return self.key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )

    @property
    def peer_id(self):
        return hashlib.sha256(self.public_key).hexdigest()

    def sign(self, payload):
        raw = canonical_json(payload)
        return {
            "payload": payload,
            "public_key": base64.b64encode(self.public_key).decode(),
            "signature": base64.b64encode(self.key.sign(raw)).decode(),
        }

    @staticmethod
    def verify(envelope, expected_peer=None):
        key = base64.b64decode(envelope["public_key"], validate=True)
        signature = base64.b64decode(envelope["signature"], validate=True)
        peer = hashlib.sha256(key).hexdigest()
        if expected_peer is not None and peer != expected_peer:
            raise ValueError("signer identity mismatch")
        try:
            Ed25519PublicKey.from_public_bytes(key).verify(
                signature, canonical_json(envelope["payload"])
            )
        except InvalidSignature as error:
            raise ValueError("invalid envelope signature") from error
        return peer, envelope["payload"]


class ArtifactStore:
    def __init__(
        self, directory, max_bytes=8 * 1024 * 1024, max_total_bytes=256 * 1024 * 1024
    ):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.max_bytes = max_bytes
        self.max_total = max_total_bytes

    def put(self, data: bytes):
        if len(data) > self.max_bytes:
            raise ValueError("artifact exceeds size budget")
        digest = hashlib.sha256(data).hexdigest()
        path = self.directory / digest
        if not path.exists():
            total = sum(
                p.stat().st_size
                for p in self.directory.iterdir()
                if p.is_file() and HEX.fullmatch(p.name)
            )
            if total + len(data) > self.max_total:
                raise ValueError("artifact store quota exceeded")
            atomic(path, data)
        return digest

    def get(self, digest):
        if not HEX.fullmatch(digest):
            raise ValueError("invalid content address")
        path = self.directory / digest
        if path.stat().st_size > self.max_bytes:
            raise ValueError("stored artifact exceeds size budget")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("artifact integrity mismatch")
        return data

    def put_json(self, data):
        return self.put(canonical_json(data))

    def get_json(self, digest):
        return strict_json(self.get(digest), self.max_bytes)

    def inventory(self, limit=128):
        return sorted(
            p.name
            for p in self.directory.iterdir()
            if p.is_file() and HEX.fullmatch(p.name)
        )[:limit]


class ScientificLedger:
    """Signed local hash chain. A trusted external head is needed to detect rollback.

    This is not a global blockchain, Byzantine consensus, or immutable storage.
    Foreign discovery receipts are claims until locally reverified.
    """

    def __init__(self, path, identity: SigningIdentity):
        self.identity = identity
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=10)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS entries (sequence INTEGER PRIMARY KEY, digest TEXT UNIQUE, envelope BLOB NOT NULL)"
        )
        self.db.commit()

    def append(self, kind, body):
        if kind not in (
            "discovery",
            "lineage",
            "dataset",
            "peer_claim",
            "verification",
            "reproduction",
        ):
            raise ValueError("unknown ledger entry kind")
        if len(canonical_json(body)) > 262144:
            raise ValueError("ledger entry exceeds budget")
        try:
            self.db.execute("BEGIN IMMEDIATE")
            last = self.db.execute(
                "SELECT sequence,digest FROM entries ORDER BY sequence DESC LIMIT 1"
            ).fetchone()
            payload = {
                "protocol": "NOVA-LEDGER-v1",
                "sequence": 0 if last is None else last[0] + 1,
                "previous": "0" * 64 if last is None else last[1],
                "origin": self.identity.peer_id,
                "kind": kind,
                "body": body,
                "recorded_at": datetime.now(timezone.utc).isoformat(),
            }
            envelope = self.identity.sign(payload)
            raw = canonical_json(envelope)
            digest = hashlib.sha256(raw).hexdigest()
            self.db.execute(
                "INSERT INTO entries VALUES (?,?,?)", (payload["sequence"], digest, raw)
            )
            self.db.commit()
            return digest
        except BaseException:
            self.db.rollback()
            raise

    def verify(self, expected_head=None):
        previous = "0" * 64
        count = 0
        for sequence, digest, raw in self.db.execute(
            "SELECT sequence,digest,envelope FROM entries ORDER BY sequence"
        ):
            if len(raw) > 524288:
                raise ValueError("ledger entry size exceeded")
            _, payload = SigningIdentity.verify(
                strict_json(raw, 524288), self.identity.peer_id
            )
            if (
                sequence != count
                or payload["sequence"] != sequence
                or payload["previous"] != previous
                or hashlib.sha256(raw).hexdigest() != digest
            ):
                raise ValueError("ledger chain mismatch")
            previous = digest
            count += 1
        if expected_head is not None and expected_head != previous:
            raise ValueError("ledger rollback/head mismatch")
        return {"entries": count, "head": previous, "scope": "local signed chain only"}

    def close(self):
        self.db.close()

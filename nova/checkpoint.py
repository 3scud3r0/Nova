"""Versioned NPZ/JSON state codec, atomic replacement, bounded loads, SHA-256 integrity.

The digest detects accidental corruption. It is not an authentication signature;
only restore checkpoints from trusted owners. No pickle/object arrays are used.
"""

from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import tempfile
import zipfile
import numpy as np


class CheckpointFormatError(ValueError):
    pass


def _digest(payload, arrays):
    digest = hashlib.sha256(
        json.dumps(
            payload, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
    )
    for name, array in sorted(arrays.items()):
        digest.update(name.encode())
        digest.update(array.dtype.str.encode())
        digest.update(str(array.shape).encode())
        digest.update(array.tobytes(order="C"))
    return digest.hexdigest()


def save_state(path, state):
    arrays = {}

    def encode(value):
        if isinstance(value, np.ndarray):
            if value.dtype.hasobject:
                raise TypeError("object arrays are forbidden")
            key = f"a{len(arrays):06d}"
            arrays[key] = np.array(value, copy=True, order="C")
            return {"type": "array", "key": key}
        if isinstance(value, np.generic):
            value = value.item()
        if isinstance(value, dict):
            if not all(isinstance(k, str) for k in value):
                raise TypeError("state keys must be strings")
            return {"type": "dict", "items": [[k, encode(v)] for k, v in value.items()]}
        if isinstance(value, (list, tuple)):
            return {"type": "list", "items": [encode(v) for v in value]}
        if value is None or isinstance(value, (str, bool, int, float)):
            if isinstance(value, float) and not np.isfinite(value):
                raise ValueError("nonfinite state value")
            return {"type": "value", "value": value}
        raise TypeError(f"unsupported checkpoint type: {type(value).__name__}")

    payload = encode(state)
    manifest = {
        "format": "nova-state",
        "version": 2,
        "payload": payload,
        "sha256": _digest(payload, arrays),
    }
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(
        prefix=".nova-checkpoint-", suffix=".npz", dir=path.parent
    )
    try:
        with os.fdopen(fd, "wb") as stream:
            np.savez_compressed(
                stream,
                manifest=np.array(json.dumps(manifest, allow_nan=False)),
                **arrays,
            )
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def load_state(path, *, max_bytes=1024**3, max_arrays=10000):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if (
            len(entries) > max_arrays + 1
            or sum(e.file_size for e in entries) > max_bytes
        ):
            raise CheckpointFormatError("checkpoint exceeds load budget")
        if len({e.filename for e in entries}) != len(entries):
            raise CheckpointFormatError("duplicate archive entry")
    with np.load(path, allow_pickle=False) as archive:
        if "manifest" not in archive.files:
            raise CheckpointFormatError("not a v2 state archive")
        manifest = json.loads(str(archive["manifest"]))
        if manifest.get("format") != "nova-state" or manifest.get("version") != 2:
            raise CheckpointFormatError("unsupported state format")
        arrays = {k: archive[k].copy() for k in archive.files if k != "manifest"}
        if _digest(manifest["payload"], arrays) != manifest["sha256"]:
            raise CheckpointFormatError("checkpoint integrity mismatch")

    def decode(node):
        kind = node["type"]
        if kind == "array":
            return arrays[node["key"]].copy()
        if kind == "dict":
            return {k: decode(v) for k, v in node["items"]}
        if kind == "list":
            return [decode(v) for v in node["items"]]
        if kind == "value":
            return node["value"]
        raise CheckpointFormatError("unknown state node type")

    return decode(manifest["payload"])

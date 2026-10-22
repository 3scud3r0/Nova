"""Specified PRNG and strict JSON/array encodings for replayable artifacts."""

from __future__ import annotations
import hashlib
import json
import platform
import sys
import numpy as np

MASK = (1 << 64) - 1


class SplitMix64:
    """SplitMix64 with explicit unsigned 64-bit wrapping; no NumPy RNG dependency."""

    def __init__(self, seed: int):
        if not isinstance(seed, int) or not 0 <= seed <= MASK:
            raise ValueError("seed must be uint64")
        self.state = seed

    def next_u64(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & MASK
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK
        return (z ^ (z >> 31)) & MASK

    def uniform(self, shape, low=0.0, high=1.0):
        count = int(np.prod(shape))
        values = np.fromiter(
            ((self.next_u64() >> 11) * 2.0**-53 for _ in range(count)), float, count
        )
        return (low + (high - low) * values).reshape(shape)

    def integers(self, low: int, high: int, shape):
        if high <= low:
            raise ValueError("empty integer range")
        width = high - low
        limit = (1 << 64) - ((1 << 64) % width)
        result = []
        for _ in range(int(np.prod(shape))):
            value = self.next_u64()
            while value >= limit:
                value = self.next_u64()
            result.append(low + value % width)
        return np.asarray(result, dtype=np.int64).reshape(shape)


def canonical_json(value) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def strict_json(raw: bytes | str, max_bytes=262144):
    if len(raw) > max_bytes:
        raise ValueError("JSON exceeds byte budget")

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    def constant(value):
        raise ValueError("nonfinite JSON number")

    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except RecursionError as error:
        raise ValueError("JSON nesting exceeds parser budget") from error


def digest_arrays(arrays: dict[str, np.ndarray], metadata=None) -> str:
    digest = hashlib.sha256(canonical_json(metadata or {}))
    for name, value in sorted(arrays.items()):
        value = np.asarray(value)
        if value.dtype.hasobject:
            raise ValueError("object arrays not serializable")
        dtype = value.dtype.newbyteorder("<")
        data = np.asarray(value, dtype=dtype, order="C")
        digest.update(
            canonical_json(
                {"name": name, "shape": list(data.shape), "dtype": dtype.str}
            )
        )
        digest.update(data.tobytes(order="C"))
    return digest.hexdigest()


def environment_fingerprint():
    import scipy

    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "machine": platform.machine(),
        "byteorder": sys.byteorder,
        "float_format": "IEEE754-binary64",
        "note": "Fingerprint is diagnostic; float kernels still require replay comparison.",
    }


def digest_state(state):
    """Hash every nested scalar and array with unambiguous structural paths."""
    arrays = {}

    def visit(value, path):
        if isinstance(value, np.ndarray):
            name = canonical_json(path).decode()
            arrays[name] = value
            return {"array": name}
        if isinstance(value, np.generic):
            return value.item()
        if isinstance(value, dict):
            return {
                str(k): visit(v, path + [str(k)])
                for k, v in sorted(value.items(), key=lambda item: str(item[0]))
            }
        if isinstance(value, (list, tuple)):
            return [visit(v, path + [i]) for i, v in enumerate(value)]
        return value

    metadata = visit(state, [])
    return digest_arrays(arrays, metadata)

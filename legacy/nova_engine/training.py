"""Bounded transition readers. Arrow columns may share mmap buffers; compressed
Zarr must be decompressed. Torch/JAX conversions and ID alignment can copy.
No framework is imported until the caller requests it.
"""
from pathlib import Path
import json
import mmap
import os
import hashlib
import tempfile
import numpy as np


class ArrowBatches:
    """Owns the memory map; yielded immutable columns keep Arrow buffer ownership."""
    def __init__(self, filename):
        import pyarrow as pa
        import pyarrow.ipc as ipc
        self.mapping = pa.memory_map(str(filename), "r")
        self.reader = ipc.open_stream(self.mapping)

    def __iter__(self):
        yield from self.reader

    @staticmethod
    def columns(batch, names):
        return {name: batch.column(batch.schema.get_field_index(name)).to_numpy(
            zero_copy_only=True) for name in names}

    def close(self):
        self.reader.close()
        self.mapping.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class TrajectoryTransitions:
    """One Arrow batch per frame. Matches IDs explicitly across births/reordering.

    Input/output gathers are copies; the original primitive columns are mmap views.
    Iterators should be created inside each training worker process.
    """
    def __init__(self, directory, *, max_particles=1_000_000):
        self.path = Path(directory) / "trajectories.arrow"
        self.max_particles = max_particles
        if not 1 <= max_particles <= 10_000_000:
            raise ValueError("invalid particle budget")

    def __iter__(self):
        previous = None
        names = ["tick", "particle_id", "x", "y", "z", "vx", "vy", "vz"]
        with ArrowBatches(self.path) as source:
            for batch in source:
                if batch.num_rows > self.max_particles:
                    raise ValueError("frame particle budget exceeded")
                now = source.columns(batch, names)
                if len(now["tick"]) == 0:
                    continue
                if not np.all(now["tick"] == now["tick"][0]):
                    raise ValueError("expected one frame per Arrow batch")
                if len(np.unique(now["particle_id"])) != len(now["particle_id"]):
                    raise ValueError("duplicate particle IDs")
                if previous is not None:
                    if now["tick"][0] <= previous["tick"][0]:
                        raise ValueError("nonmonotonic trajectory ticks")
                    ids, before, after = np.intersect1d(previous["particle_id"], now["particle_id"],
                                                       assume_unique=True, return_indices=True)
                    x = np.stack([previous[n][before] for n in names[2:]], axis=-1)
                    y = np.stack([now[n][after] for n in names[2:]], axis=-1)
                    yield {"input": x, "target": y, "particle_ids": ids,
                           "ticks": (int(previous["tick"][0]), int(now["tick"][0])),
                           "copy_scope": "matched ID gathers allocate contiguous arrays"}
                previous = now


class FieldTransitions:
    """Reader for NOVA's single-frame Zarr v3 bytes+zstd chunks.

    Compressed bytes are memory mapped, decompressed with a size bound, and can
    be cached as immutable .npy files for mmap in future epochs. Existing native
    lakes use time/channel/x/y/z; substrate lakes use time/channel/z/y/x.
    The axis names are returned explicitly, without silently transposing.
    """
    def __init__(self, directory, *, cache=None, max_frame_bytes=128 * 1024 * 1024):
        self.root = Path(directory)
        manifest = json.loads((self.root / "manifest.json").read_text())
        if manifest.get("status") != "complete":
            raise ValueError("a complete lake is required")
        self.fields = self.root / "world.zarr" / "fields"
        self.metadata = json.loads((self.fields / "zarr.json").read_text())
        m = self.metadata
        if (m.get("zarr_format") != 3 or m.get("data_type") != "float32"
                or len(m.get("shape", [])) != 5):
            raise ValueError("expected NOVA 5D float32 Zarr v3")
        self.shape = tuple(m["shape"])
        if any(type(d) is not int or d < (0 if i == 0 else 1)
               for i, d in enumerate(self.shape)):
            raise ValueError("invalid dimensions")
        expected = (1,) + self.shape[1:]
        if tuple(m["chunk_grid"]["configuration"]["chunk_shape"]) != expected:
            raise ValueError("requires one complete frame per chunk")
        codecs = m.get("codecs", [])
        if (len(codecs) != 2 or codecs[0].get("name") != "bytes"
                or codecs[0].get("configuration", {}).get("endian") != "little"
                or codecs[1].get("name") != "zstd"):
            raise ValueError("unsupported codec chain")
        if m.get("chunk_key_encoding") != {"name": "default", "configuration": {"separator": "/"}}:
            raise ValueError("unsupported chunk keys")
        self.frame_bytes = int(np.prod(self.shape[1:], dtype=object)) * 4
        if not 1 <= self.frame_bytes <= max_frame_bytes <= 1024 * 1024 * 1024:
            raise ValueError("frame memory budget exceeded")
        self.cache = Path(cache) if cache is not None else None
        if self.cache:
            self.cache.mkdir(parents=True, exist_ok=True)
        self.axes = m.get("dimension_names", ["time", "channel", "x", "y", "z"])

    def frame(self, index):
        if not 0 <= index < self.shape[0]:
            raise IndexError(index)
        import zstandard
        path = self.fields / "c" / str(index) / "0" / "0" / "0" / "0"
        if path.stat().st_size > self.frame_bytes + 1024 * 1024:
            raise ValueError("compressed chunk exceeds budget")
        with path.open("rb") as handle, mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as mapped:
            digest = hashlib.sha256(mapped).hexdigest()
            target = self.cache / (digest + ".npy") if self.cache else None
            if target is not None and target.exists():
                values = np.load(target, mmap_mode="r", allow_pickle=False)
                if values.shape != self.shape[1:] or values.dtype != np.dtype("<f4"):
                    raise ValueError("cached frame shape/dtype mismatch")
                return values
            # A stream reader bounds output even if a frame advertises a huge size.
            with zstandard.ZstdDecompressor().stream_reader(mapped) as reader:
                raw = reader.read(self.frame_bytes + 1)
            if len(raw) != self.frame_bytes:
                raise ValueError("decoded chunk length mismatch")
        values = np.frombuffer(raw, dtype="<f4").reshape(self.shape[1:])
        if target is not None:
            fd, temporary = tempfile.mkstemp(dir=self.cache, suffix=".tmp")
            try:
                with os.fdopen(fd, "wb") as output:
                    np.save(output, values, allow_pickle=False)
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            return np.load(target, mmap_mode="r", allow_pickle=False)
        return values

    def __iter__(self):
        actions_path = self.root / "actions.jsonl"
        actions = actions_path.open() if actions_path.exists() else None
        try:
            for i in range(max(0, self.shape[0] - 1)):
                action = None
                tick = None
                if actions is not None:
                    line = actions.readline(65537)
                    if not line or len(line) > 65536:
                        raise ValueError("action index truncated or too large")
                    record = json.loads(line)
                    if record.get("frame") != i:
                        raise ValueError("action/frame index mismatch")
                    action, tick = record.get("action"), record.get("tick")
                yield {"input": self.frame(i), "target": self.frame(i + 1),
                       "frames": (i, i + 1), "axes": self.axes[1:],
                       "action": action, "tick": tick}
        finally:
            if actions is not None:
                actions.close()


def _torch_stream(transitions):
    import torch
    class Stream(torch.utils.data.IterableDataset):
        def __reduce__(self):
            return (_torch_stream, (transitions,))

        def __iter__(self):
            worker = torch.utils.data.get_worker_info()
            for index, item in enumerate(transitions):
                if worker is not None and index % worker.num_workers != worker.id:
                    continue
                yield {**item, "input": torch.from_numpy(np.array(item["input"], copy=True)),
                       "target": torch.from_numpy(np.array(item["target"], copy=True))}
    return Stream()


def torch_loader(transitions, *, workers=0):
    """Variable-size frames use batch_size=None; workers shard by transition index.

    Tensor conversion copies immutable mmap arrays to writable CPU memory.
    """
    import torch
    if not 0 <= workers <= 64:
        raise ValueError("invalid worker count")
    return torch.utils.data.DataLoader(_torch_stream(transitions), batch_size=None, num_workers=workers)


def jax_batches(transitions, *, device=None):
    import jax
    for item in transitions:
        yield {**item, "input": jax.device_put(item["input"], device),
               "target": jax.device_put(item["target"], device)}

"""Leased binary frame mapping for the native nova-ipc protocol.

The publisher copies a tensor into a slot. Readers can borrow a zero-copy NumPy
view while holding its lease; device transfer or Torch's writable copy allocates.
Never delete another process's lease without checking that its owner exited.
"""

import json
import mmap
import os
from pathlib import Path
import struct
import time
import zlib
import numpy as np


class _LeasedArray(np.ndarray):
    def __array_finalize__(self, parent):
        self._lease_owner = getattr(parent, "_lease_owner", None)


class Frame:
    def __init__(self, path, lease, manifest):
        self.manifest, self.lease = manifest, lease
        self.file = None
        self.mapping = None
        try:
            self.file = path.open("rb")
            self.mapping = mmap.mmap(self.file.fileno(), 0, access=mmap.ACCESS_READ)
            header = self.mapping[:64]
            if header[:8] != b"NOVAFR09":
                raise ValueError("frame magic differs")
            sequence, tick = struct.unpack_from("<QQ", header, 8)
            shape = struct.unpack_from("<4I", header, 24)
            (count,) = struct.unpack_from("<Q", header, 40)
            particle_count, particle_width, ids_present = struct.unpack_from(
                "<III", header, 48
            )
            expected = int(np.prod(shape, dtype=object))
            if (
                sequence != manifest["sequence"]
                or tick != manifest["tick"]
                or list(shape) != manifest["shape"]
                or count != expected
                or not 0 < count <= 8_388_608
                or shape[0] != 4
                or any(x < 1 for x in shape)
                or particle_count != manifest.get("particle_count")
                or not 0 <= particle_count <= 262144
                or particle_width != 8
                or manifest.get("particle_width") != 8
                or len(self.mapping) != 64 + count * 4 + particle_count * 40
                or len(self.mapping) != manifest["bytes"]
            ):
                raise ValueError("publication changed or frame contract differs")
            self.shape, self.sequence, self.tick = shape, sequence, tick
            if bool(ids_present) != manifest.get("particle_ids") or ids_present not in {
                0,
                1,
            }:
                raise ValueError("particle identity contract differs")
            if (
                not np.isfinite(manifest.get("time_step", 0))
                or manifest["time_step"] <= 0
            ):
                raise ValueError("invalid solver time step")
            self.particle_count, self.field_count = particle_count, count
        except BaseException:
            self.close()
            raise

    def array(self, *, copy=False):
        if self.mapping is None:
            raise RuntimeError("released frame")
        values = (
            np.frombuffer(
                self.mapping, dtype="<f4", count=int(np.prod(self.shape)), offset=64
            )
            .reshape(self.shape)
            .view(_LeasedArray)
        )
        values._lease_owner = self
        if copy:
            return np.array(values, dtype=np.float32, copy=True)
        values.setflags(write=False)
        return values

    def particles(self, *, copy=False):
        if self.mapping is None:
            raise RuntimeError("released frame")
        values = (
            np.frombuffer(
                self.mapping,
                dtype="<f4",
                count=self.particle_count * 8,
                offset=64 + self.field_count * 4,
            )
            .reshape(self.particle_count, 8)
            .view(_LeasedArray)
        )
        values._lease_owner = self
        if copy:
            return np.array(values, dtype=np.float32, copy=True)
        values.setflags(write=False)
        return values

    def particle_ids(self, *, copy=False):
        if self.mapping is None:
            raise RuntimeError("released frame")
        values = np.frombuffer(
            self.mapping,
            dtype="<u8",
            count=self.particle_count,
            offset=64 + self.field_count * 4 + self.particle_count * 32,
        ).view(_LeasedArray)
        values._lease_owner = self
        if copy:
            return np.array(values, dtype=np.uint64, copy=True)
        values.setflags(write=False)
        return values

    def close(self):
        if self.mapping is not None:
            # Fails while exported buffers exist; the lease then remains intact.
            self.mapping.close()
            self.mapping = None
        if self.file is not None:
            self.file.close()
            self.file = None
        if self.lease is not None:
            self.lease.unlink(missing_ok=True)
            self.lease = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def __del__(self):
        try:
            self.close()
        except (BufferError, OSError):
            pass


class IPCBridge:
    def __init__(self, directory, *, timeout=120):
        self.root = Path(directory)
        if not 0 < timeout <= 86400:
            raise ValueError("invalid IPC timeout")
        self.timeout = timeout
        self.last_sent = 0

    def read_latest_frame(self, *, after=0):
        start = time.monotonic()
        while time.monotonic() - start < self.timeout:
            publication = self.root / "ring.json"
            if not publication.exists():
                time.sleep(0.002)
                continue
            if publication.stat().st_size > 65536:
                raise ValueError("IPC metadata exceeds budget")
            manifest = json.loads(publication.read_text())
            slot, slots = manifest.get("slot"), manifest.get("slots")
            if (
                manifest.get("schema") != "NOVA-RING-v1"
                or type(slot) is not int
                or type(slots) is not int
                or not 2 <= slots <= 32
                or not 0 <= slot < slots
            ):
                raise ValueError("invalid ring metadata")
            if manifest["sequence"] <= after:
                if (self.root / "closed.json").exists():
                    raise EOFError("native session closed")
                time.sleep(0.002)
                continue
            lease = self.root / f"slot-{slot}.lock"
            try:
                descriptor = os.open(lease, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                time.sleep(0.002)
                continue
            try:
                os.write(descriptor, str(os.getpid()).encode())
            finally:
                os.close(descriptor)
            try:
                return Frame(self.root / f"slot-{slot}.bin", lease, manifest)
            except ValueError:
                lease.unlink(missing_ok=True)
                time.sleep(0.002)
        raise TimeoutError("no fresh unpinned native frame before deadline")

    def send_action(self, sequence, action=None, *, close=False):
        if sequence <= self.last_sent:
            raise ValueError("action sequence must advance")
        values = [0.0] * 8
        opcode = 3 if close else 0
        if action is not None and not close:
            opcode = 2 if action.get("type") == "impulse" else 1
            position, radius = action["position"], action["radius"]
            if (
                len(position) != 3
                or any(not np.isfinite(v) or not 0 <= v <= 1 for v in position)
                or not np.isfinite(radius)
                or not 0 < radius <= 1
            ):
                raise ValueError("invalid normalized action")
            values[:4] = [*position, radius]
            values[4] = float(action.get("strength", 0))
            vector = action.get("vector", [0, 0, 0])
            if len(vector) != 3:
                raise ValueError("invalid action vector")
            values[5:] = vector
            if not np.isfinite(values).all() or any(abs(v) > 10 for v in values[4:]):
                raise ValueError("action magnitude exceeds contract")
        prefix = struct.pack("<8sQI8f8x", b"NOVAAC09", int(sequence), opcode, *values)
        payload = prefix + struct.pack("<I", zlib.crc32(prefix))
        temporary = self.root / f"action-{os.getpid()}.tmp"
        try:
            with temporary.open("xb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.root / "action.bin")
        finally:
            temporary.unlink(missing_ok=True)
        self.last_sent = sequence

"""Native NOVA: pinned, read-only snapshots expose simulation memory without copies."""
from ._native import Universe, Snapshot, Conway

__version__ = "0.6.0"


def torch_positions(snapshot, *, copy=True):
    """Share CPU snapshot storage. Treat the tensor as read-only (PyTorch cannot enforce it).

    copy=False explicitly opts into a shared tensor which MUST NOT be mutated.
    Retain the snapshot/tensor until finished and release both before stepping.
    Use copy=True for a writable tensor, autograd mutations or device transfers.
    """
    import torch
    array = snapshot.positions
    tensor = torch.from_numpy(array)
    return tensor.clone() if copy else tensor


def arrow_snapshot(snapshot):
    """Zero-copy Arrow fixed-size lists over contiguous snapshot buffers.

    Column x/y/z extraction from interleaved float4 is not zero-copy. Preserve the
    fixed-size-list representation or explicitly accept a column conversion.
    """
    import pyarrow as pa
    positions = pa.array(snapshot.positions.reshape(-1), type=pa.float32())
    velocities = pa.array(snapshot.velocities.reshape(-1), type=pa.float32())
    genomes = pa.array(snapshot.genomes.reshape(-1), type=pa.uint8())
    return pa.table({"position_radius": pa.FixedSizeListArray.from_arrays(positions, 4),
                     "velocity_mass": pa.FixedSizeListArray.from_arrays(velocities, 4),
                     "genome": pa.FixedSizeListArray.from_arrays(genomes, 16)})

__all__ = ["Universe", "Snapshot", "Conway", "torch_positions", "arrow_snapshot"]

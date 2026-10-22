"""Coordinate-checked exchange of protection constraints, not instant skill transfer."""

import numpy as np
from nova.bioma.determinism import digest_arrays


def coordinate_fingerprint(encoder_state, feature_schema):
    arrays = {k: np.asarray(v) for k, v in encoder_state.items()}
    return digest_arrays(arrays, {"feature_schema": feature_schema})


def package_subspace(u, coordinate_id, *, max_rank=128):
    u = np.asarray(u, dtype=float)
    if (
        u.ndim != 2
        or not 1 <= u.shape[0] <= 512
        or u.shape[1] > min(max_rank, u.shape[0])
        or not np.isfinite(u).all()
    ):
        raise ValueError("subspace size/value budget exceeded")
    if not np.allclose(u.T @ u, np.eye(u.shape[1]), atol=1e-9):
        raise ValueError("basis is not orthonormal")
    return {
        "protocol": "NOVA-SUBSPACE-v1",
        "coordinate_id": coordinate_id,
        "dimension": u.shape[0],
        "basis": u.tolist(),
        "meaning": "input directions to protect; does not encode target functions or skills",
    }


def merge_subspaces(local_u, packet, coordinate_id, rank_budget):
    if (
        packet.get("protocol") != "NOVA-SUBSPACE-v1"
        or packet["coordinate_id"] != coordinate_id
    ):
        raise ValueError("encoder/coordinate schema mismatch")
    remote = np.asarray(packet["basis"], dtype=float)
    local = np.asarray(local_u, dtype=float)
    package_subspace(remote, coordinate_id)
    if (
        local.ndim != 2
        or local.shape[0] != remote.shape[0]
        or not np.allclose(local.T @ local, np.eye(local.shape[1]), atol=1e-9)
    ):
        raise ValueError("local coordinate/basis mismatch")
    u, s, _ = np.linalg.svd(
        np.concatenate((local, remote), axis=1), full_matrices=False
    )
    rank = int(np.count_nonzero(s > 1e-12 * s[0])) if len(s) and s[0] else 0
    if rank > rank_budget:
        return {
            "status": "capacity_rejected",
            "required_rank": rank,
            "rank_budget": rank_budget,
            "basis": None,
        }
    return {
        "status": "merged_constraints",
        "basis": u[:, :rank],
        "rank": rank,
        "transferred_skill": False,
    }

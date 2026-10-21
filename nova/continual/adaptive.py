"""Finite adaptive capacity with explicit forgetting, anchors and feature versions."""

from __future__ import annotations
from dataclasses import dataclass, asdict
from collections import deque
from math import ceil
import numpy as np
from numpy.typing import ArrayLike
from scipy.linalg import expm
from .protected import ProtectedLinear
from nova.synapse import DiffusiveCascade


@dataclass(frozen=True)
class AdaptiveConfig:
    policy: str = "hybrid"
    reserve_fraction: float = 0.2
    growth_step: int = 8
    max_features: int = 128
    max_state_bytes: int = 32 * 1024 * 1024
    trace_tau: float = 200.0
    evidence_tau: float = 1000.0
    release_threshold: float = 1e-5
    eigenvalue_floor: float = 1e-6
    slow_weight: float = 8.0
    reservoirs: int = 4

    def __post_init__(self):
        if self.policy not in ("strict", "relax", "expand", "hybrid"):
            raise ValueError("unknown capacity policy")
        numbers = (
            self.trace_tau,
            self.evidence_tau,
            self.slow_weight,
            self.release_threshold,
            self.eigenvalue_floor,
        )
        if (
            not all(np.isfinite(n) and n >= 0 for n in numbers)
            or min(self.trace_tau, self.evidence_tau) <= 0
        ):
            raise ValueError("invalid time constants or scores")
        if (
            not 0 <= self.reserve_fraction < 1
            or min(
                self.growth_step,
                self.max_features,
                self.max_state_bytes,
                self.reservoirs,
            )
            < 1
        ):
            raise ValueError("invalid capacity budget")


def basis(matrix: np.ndarray) -> np.ndarray:
    if not matrix.shape[1]:
        return np.empty((len(matrix), 0))
    u, s, _ = np.linalg.svd(matrix, full_matrices=False)
    rank = int(np.count_nonzero(s > 1e-12 * s[0])) if len(s) and s[0] > 0 else 0
    return u[:, :rank]


class AdaptiveSubspaceLinear(ProtectedLinear):
    """Project updates into the current nullspace; explicitly release or grow it.

    Decaying eigenvalues alone never changes U U.T. Capacity is recovered only
    by dropping directions (which permits forgetting), or by adding coordinates.
    A separate orthonormal anchor span is never released. Slow diffusion traces
    rank directions by usage; this is an engineering policy, not a retention law.
    Nonlinear feature blocks carry an immutable version. Old versioned inputs
    have zeros in newer blocks, so their coordinate mapping stays unchanged.
    No guarantee applies to re-encoding old data with a newer feature version.
    """

    def __init__(
        self,
        in_features: int,
        out_features: int,
        *,
        seed: int = 0,
        config: AdaptiveConfig | None = None,
    ):
        self.config = config or AdaptiveConfig(max_features=max(128, in_features))
        if in_features > self.config.max_features:
            raise ValueError("initial width exceeds max_features")
        self.base_features = in_features
        self.rng = np.random.default_rng(seed + 19)
        self.feature_blocks: list[dict] = []
        self.anchor_U = np.empty((in_features, 0))
        self.events = deque(maxlen=128)
        self.released_total = 0
        self.expansions = 0
        self.clock = 0.0
        super().__init__(in_features, out_features, seed=seed)
        self.traces = DiffusiveCascade(in_features, self.config.reservoirs)
        self._age_dt = None
        self._age_transition = None
        if self.estimated_state_bytes(in_features) > self.config.max_state_bytes:
            raise ValueError("initial state exceeds capacity budget")

    @property
    def feature_version(self) -> int:
        return len(self.feature_blocks)

    def estimated_state_bytes(self, width: int) -> int:
        # Conservative reservation for U and anchor_U at full rank, weights,
        # residual/update, cascade, random features, and singular values.
        return int(
            16 * width * width
            + width * self.out_features * 17
            + 8 * width * self.config.reservoirs
            + 8 * self.base_features * max(0, width - self.base_features)
            + 24 * width
        )

    def encode(
        self, x: ArrayLike, version: int | ArrayLike | None = None
    ) -> np.ndarray:
        x = np.asarray(x, dtype=np.float64)
        if x.ndim != 2 or x.shape[1] != self.base_features or not np.isfinite(x).all():
            raise ValueError("expected finite raw features [batch, base_features]")
        v = np.broadcast_to(
            self.feature_version if version is None else np.asarray(version), (len(x),)
        )
        if (
            np.any(v < 0)
            or np.any(v > self.feature_version)
            or np.any(v != np.floor(v))
        ):
            raise ValueError("unknown feature version")
        parts = [x]
        for index, block in enumerate(self.feature_blocks, 1):
            parts.append(
                np.tanh(x @ block["projection"] + block["bias"]) * (v >= index)[:, None]
            )
        return np.concatenate(parts, axis=1)

    def _replace_basis(self, new: np.ndarray, values: np.ndarray | None = None):
        old = self.U
        overlap = (old.T @ new) ** 2
        state = np.zeros_like(self.traces.state)
        state[: new.shape[1]] = overlap.T @ self.traces.state[: old.shape[1]]
        if values is None:
            values = np.sqrt(overlap.T @ (self.singular_values**2))
        self.U = new
        self.singular_values = np.asarray(values, dtype=float)
        self.traces.state = state

    def consolidate(self, x: ArrayLike, *, anchor: bool = False) -> None:
        x = self._inputs(x)
        if not len(x):
            raise ValueError("empty calibration batch")
        if anchor:
            anchors = basis(np.concatenate((self.anchor_U, x.T), axis=1))
            if anchors.shape[1] > self.rank_max:
                raise ValueError("anchor rank exceeds configured rank")
            self.anchor_U = anchors
        old = self.U.copy()
        old_values = self.singular_values.copy()
        u, s, _ = np.linalg.svd(
            np.concatenate((old * old_values, x.T), axis=1), full_matrices=False
        )
        rank = int(np.count_nonzero(s > 1e-12 * s[0])) if s[0] > 0 else 0
        new = u[:, :rank]
        values = s[:rank]
        if self.anchor_U.shape[1]:
            residual = new - self.anchor_U @ (self.anchor_U.T @ new)
            residual -= self.anchor_U @ (self.anchor_U.T @ residual)
            if residual.shape[1]:
                ru, rs, _ = np.linalg.svd(residual, full_matrices=False)
                residual = ru[:, rs > 1e-10]
            new = np.concatenate((self.anchor_U, residual), axis=1)
            # Diagonal evidence transported into the anchor-aligned frame. This
            # is a priority approximation, not the full rotated covariance.
            values = np.sqrt(((u.T @ new) ** 2).T @ (s * s))
            rank = new.shape[1]
        self._replace_basis(new, values)
        activation = np.mean((x @ self.U) ** 2, axis=0)
        self.traces.state[:rank, 0] += activation
        self.events.append(
            {
                "time": self.clock,
                "event": "consolidate",
                "rank": rank,
                "anchor_rank": self.anchor_U.shape[1],
            }
        )
        # Release/growth are separate explicit operations, never hidden in SVD.

    def observe(self, x: ArrayLike):
        x = self._inputs(x)
        if len(x) and self.U.shape[1]:
            self.traces.state[: self.U.shape[1], 0] += np.mean(
                (x @ self.U) ** 2, axis=0
            )

    def age(self, dt: float = 1.0, *, consolidation: float = 0.0):
        if (
            not np.isfinite(dt)
            or dt < 0
            or not np.isfinite(consolidation)
            or not 0 <= consolidation <= 1
        ):
            raise ValueError("invalid aging interval/consolidation")
        self.clock += dt
        # Exact homogeneous integration avoids an unstable large Euler step.
        if self._age_dt != dt:
            self._age_transition = expm(dt * self.traces.matrix).T
            self._age_dt = dt
        self.traces.state = self.traces.state @ self._age_transition
        self.traces.state *= np.exp(-dt / self.config.trace_tau)
        self.singular_values *= np.exp(-dt / (2 * self.config.evidence_tau))
        self.traces.consolidate(consolidation)
        if self.config.policy in ("relax", "hybrid") and self.U.shape[1]:
            score = self._priority(self.U)
            stale = (score < self.config.release_threshold) & (
                self.singular_values**2 < self.config.eigenvalue_floor
            )
            if stale.any():
                self.release(
                    int(stale.sum()), max_priority=self.config.release_threshold
                )

    def _priority(self, directions: np.ndarray) -> np.ndarray:
        overlap = (self.U.T @ directions) ** 2
        rank = self.U.shape[1]
        trace = self.traces.state[:rank]
        slow = (
            np.maximum(trace[:, 1:], 0) @ self.traces.capacity[1:]
            if trace.shape[1] > 1
            else np.zeros(rank)
        )
        evidence = self.singular_values**2
        score = (
            np.maximum(trace[:, 0], 0)
            + self.config.slow_weight * slow
            + evidence / (1 + evidence)
        )
        return overlap.T @ score

    def release(self, count: int, *, max_priority: float | None = None) -> int:
        if count < 0:
            raise ValueError("release count must be nonnegative")
        if self.config.policy not in ("relax", "hybrid") or count == 0:
            return 0
        rank = self.U.shape[1]
        residual = self.U - self.anchor_U @ (self.anchor_U.T @ self.U)
        unanchored = self.U.copy() if not self.anchor_U.shape[1] else basis(residual)
        # Reorthogonalize after numerical residual cancellation. Singular values
        # near machine precision relative to U are not new directions.
        if self.anchor_U.shape[1]:
            residual -= self.anchor_U @ (self.anchor_U.T @ residual)
            u, s, _ = np.linalg.svd(residual, full_matrices=False)
            unanchored = u[:, s > 1e-10]
        priority = self._priority(unanchored)
        eligible = np.argsort(priority, kind="stable")
        if max_priority is not None:
            eligible = eligible[priority[eligible] <= max_priority]
        removed = eligible[:count]
        keep = np.ones(unanchored.shape[1], dtype=bool)
        keep[removed] = False
        new = np.concatenate((self.anchor_U, unanchored[:, keep]), axis=1)
        self._replace_basis(new)
        actual = max(0, rank - new.shape[1])
        self.released_total += actual
        self.events.append(
            {
                "time": self.clock,
                "event": "release",
                "directions": actual,
                "retention": "released span is unprotected",
            }
        )
        return actual

    def expand(self, extra: int, *, seed: int | None = None) -> int:
        """Adaptive expansion always honors budgets, feature stamps and anchors."""
        return self.recruit(extra, seed=seed)

    def recruit(self, extra: int | None = None, *, seed: int | None = None) -> int:
        if self.config.policy not in ("expand", "hybrid"):
            return 0
        extra = min(
            self.config.growth_step if extra is None else extra,
            self.config.max_features - self.in_features,
        )
        while (
            extra > 0
            and self.estimated_state_bytes(self.in_features + extra)
            > self.config.max_state_bytes
        ):
            extra -= 1
        if extra <= 0:
            return 0
        if not isinstance(extra, (int, np.integer)):
            raise ValueError("extra must be an integer")
        old_width = self.in_features
        rng = self.rng if seed is None else np.random.default_rng(seed)
        projection = rng.normal(
            0, 1 / np.sqrt(self.base_features), (self.base_features, extra)
        )
        bias = rng.normal(0, 0.1, extra)
        super().expand(extra, seed=int(rng.integers(2**31)))
        # New coordinates initially contribute exactly zero, despite ternary base.
        self.dW[old_width:] = -self.W_base[old_width:].astype(float)
        self.anchor_U = np.pad(self.anchor_U, ((0, extra), (0, 0)))
        old_trace = self.traces.state
        self.traces = DiffusiveCascade(self.in_features, self.config.reservoirs)
        self.traces.state[:old_width] = old_trace
        self.feature_blocks.append({"projection": projection, "bias": bias})
        self.expansions += 1
        self.events.append(
            {
                "time": self.clock,
                "event": "recruit",
                "width": self.in_features,
                "version": self.feature_version,
            }
        )
        return extra

    def manage_capacity(self) -> dict:
        reserve = (
            max(1, ceil(self.config.reserve_fraction * self.in_features))
            if self.config.reserve_fraction
            else 0
        )
        if self.free_dims < reserve:
            self.recruit(max(self.config.growth_step, reserve - self.free_dims))
            reserve = ceil(self.config.reserve_fraction * self.in_features)
        if self.free_dims < reserve:
            self.release(reserve - self.free_dims)
        return self.capacity_metrics()

    def capacity_metrics(self) -> dict:
        return {
            "width": self.in_features,
            "rank": self.U.shape[1],
            "free_dims": self.free_dims,
            "anchor_rank": self.anchor_U.shape[1],
            "feature_version": self.feature_version,
            "released_total": self.released_total,
            "expansions": self.expansions,
            "state_budget_bytes": self.estimated_state_bytes(self.in_features),
            "capacity_exhausted": self.free_dims == 0,
        }

    def state_dict(self) -> dict:
        return {
            "config": asdict(self.config),
            "base_features": self.base_features,
            "in_features": self.in_features,
            "out_features": self.out_features,
            "W_base": self.W_base.copy(),
            "dW": self.dW.copy(),
            "U": self.U.copy(),
            "singular_values": self.singular_values.copy(),
            "last_update": self.last_update.copy(),
            "anchor_U": self.anchor_U.copy(),
            "trace_state": self.traces.state.copy(),
            "blocks": self.feature_blocks,
            "rng": self.rng.bit_generator.state,
            "clock": self.clock,
            "events": list(self.events),
            "released_total": self.released_total,
            "expansions": self.expansions,
        }

    @classmethod
    def from_state_dict(cls, state: dict) -> "AdaptiveSubspaceLinear":
        obj = cls(
            state["base_features"],
            state["out_features"],
            config=AdaptiveConfig(**state["config"]),
        )
        obj.in_features = state["in_features"]
        obj.rank_max = obj.in_features
        for name in ("W_base", "dW", "U", "singular_values", "last_update", "anchor_U"):
            setattr(obj, name, np.asarray(state[name]).copy())
        obj.W_base.flags.writeable = False
        obj.traces = DiffusiveCascade(obj.in_features, obj.config.reservoirs)
        obj.traces.state = np.asarray(state["trace_state"]).copy()
        obj.feature_blocks = [
            {k: np.asarray(v).copy() for k, v in block.items()}
            for block in state["blocks"]
        ]
        obj.rng.bit_generator.state = state["rng"]
        obj.clock = state["clock"]
        obj.events = deque(state["events"], maxlen=128)
        obj.released_total = state["released_total"]
        obj.expansions = state["expansions"]
        return obj

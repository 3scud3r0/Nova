"""Float64 updates in the orthogonal complement of calibrated input directions."""

from __future__ import annotations
import numpy as np
from numpy.typing import ArrayLike, NDArray


class ProtectedLinear:
    """f(X) = X(W_base + dW); only dW learns, via g - U(U.T g).

    Protection concerns changes since consolidation, not U.T @ total dW = 0.
    Exact retention requires stable input coordinates and an untruncated basis.
    The covariance square-root update is a thin, incremental left-SVD update:
    SVD([U*S, X.T]), retaining singular values for subsequent batches.
    """

    def __init__(
        self,
        in_features: int,
        out_features: int,
        *,
        seed: int = 0,
        rank_max: int | None = None,
        energy_threshold: float | None = None,
    ):
        if min(in_features, out_features) < 1:
            raise ValueError("feature dimensions must be positive")
        self.in_features, self.out_features = in_features, out_features
        self.rank_max = in_features if rank_max is None else rank_max
        if not 0 <= self.rank_max <= in_features:
            raise ValueError("rank_max must be in [0, in_features]")
        if energy_threshold is not None and not 0 < energy_threshold <= 1:
            raise ValueError("energy_threshold must be in (0, 1]")
        self.energy_threshold = energy_threshold
        self.W_base = np.random.default_rng(seed).integers(
            -1, 2, (in_features, out_features), dtype=np.int8
        )
        self.W_base.flags.writeable = False
        self.dW = np.zeros((in_features, out_features), dtype=np.float64)
        self.U = np.empty((in_features, 0), dtype=np.float64)
        self.singular_values = np.empty(0, dtype=np.float64)
        self.last_update = np.zeros_like(self.dW)

    def _inputs(self, x: ArrayLike) -> NDArray[np.float64]:
        x = np.asarray(x, dtype=np.float64)
        if x.ndim != 2 or x.shape[1] != self.in_features or not np.isfinite(x).all():
            raise ValueError("expected finite [batch, in_features] inputs")
        return x

    def forward(self, x: ArrayLike) -> NDArray[np.float64]:
        x = self._inputs(x)
        return x @ self.W_base + x @ self.dW

    __call__ = forward

    def forward_addition_only(self, x: ArrayLike) -> NDArray[np.float64]:
        """Base uses gather-add; the continuous residual still uses dense matmul."""
        x = self._inputs(x)
        base = np.stack(
            [
                x[:, self.W_base[:, j] == 1].sum(1)
                - x[:, self.W_base[:, j] == -1].sum(1)
                for j in range(self.out_features)
            ],
            axis=1,
        )
        return base + x @ self.dW

    def consolidate(self, x: ArrayLike) -> None:
        x = self._inputs(x)
        if not len(x):
            raise ValueError("empty calibration batch")
        u, s, _ = np.linalg.svd(
            np.concatenate((self.U * self.singular_values, x.T), axis=1),
            full_matrices=False,
        )
        rank = int(np.count_nonzero(s > 1e-12 * s[0])) if s[0] > 0 else 0
        if self.energy_threshold is not None and rank:
            rank = min(
                rank,
                int(
                    np.searchsorted(
                        np.cumsum(s * s) / np.sum(s * s), self.energy_threshold
                    )
                )
                + 1,
            )
        rank = min(rank, self.rank_max)
        self.U, self.singular_values = u[:, :rank], s[:rank]

    def step(self, x: ArrayLike, y: ArrayLike, lr: float = 0.01) -> float:
        x = self._inputs(x)
        y = np.asarray(y, dtype=np.float64)
        if (
            not len(x)
            or y.shape != (len(x), self.out_features)
            or not np.isfinite(y).all()
            or lr < 0
        ):
            raise ValueError("invalid targets, batch, or learning rate")
        error = self(x) - y
        grad = x.T @ error / len(x)
        grad -= self.U @ (self.U.T @ grad)
        self.last_update = -lr * grad
        self.dW += self.last_update
        return float(np.mean(error**2))

    @property
    def free_dims(self) -> int:
        return self.in_features - self.U.shape[1]

    @property
    def eps_ortho(self) -> float:
        """Requested total-residual diagnostic; can be nonzero after consolidation."""
        return float(np.linalg.norm(self.U.T @ self.dW))

    @property
    def eps_update(self) -> float:
        return float(np.linalg.norm(self.U.T @ self.last_update))

    def retention_error(self, x: ArrayLike, reference: ArrayLike) -> float:
        return float(np.max(np.abs(self(x) - reference)))

    def expand(self, extra: int, *, seed: int = 0) -> None:
        """Recruit input coordinates; old samples must be padded with zeros."""
        if extra < 1:
            raise ValueError("extra must be positive")
        rng = np.random.default_rng(seed)
        self.W_base = np.vstack(
            (
                self.W_base,
                rng.integers(-1, 2, (extra, self.out_features), dtype=np.int8),
            )
        )
        self.W_base.flags.writeable = False
        self.dW = np.pad(self.dW, ((0, extra), (0, 0)))
        self.last_update = np.zeros_like(self.dW)
        self.U = np.pad(self.U, ((0, extra), (0, 0)))
        self.in_features += extra
        self.rank_max += extra


def linear_cka(x: ArrayLike, y: ArrayLike) -> float:
    """Centered linear CKA = ||X.T Y||² / (||X.T X|| ||Y.T Y||)."""
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    x, y = x - x.mean(0), y - y.mean(0)
    denominator = np.linalg.norm(x.T @ x) * np.linalg.norm(y.T @ y)
    return float(np.linalg.norm(x.T @ y) ** 2 / denominator) if denominator else 0.0

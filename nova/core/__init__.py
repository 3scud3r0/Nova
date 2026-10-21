"""Native kernels with explicit availability; no silent performance substitution."""

import numpy as np

try:
    import _native
except ImportError:
    _native = None


def available():
    return _native is not None


def require_native():
    if _native is None:
        raise RuntimeError(
            "Build nova-core with maturin; see README native installation."
        )
    return _native


class TernaryLinear:
    def __init__(self, weights):
        weights = np.asarray(weights)
        if weights.ndim != 2 or not np.isin(weights, [-1, 0, 1]).all():
            raise ValueError("expected ternary matrix")
        self.shape = weights.shape
        self.block = require_native().TernaryBlock(
            weights.astype(np.int8).ravel().tolist(), *self.shape
        )

    @property
    def nbytes(self):
        return self.block.nbytes

    def __call__(self, x):
        return self.block.matmul(np.asarray(x, dtype=np.float64))


def fast_hadamard_transform(x, normalize=True):
    return np.asarray(
        require_native().fast_hadamard_transform(
            np.asarray(x, dtype=float).tolist(), normalize
        )
    )

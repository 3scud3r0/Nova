"""Online Welford statistics with explicit masks for unavailable telemetry."""

from dataclasses import dataclass
import numpy as np


@dataclass
class Proprioception:
    dimensions: int = 32

    def __post_init__(self):
        self.count = np.zeros(self.dimensions, dtype=np.int64)
        self.mean = np.zeros(self.dimensions, dtype=np.float64)
        self.m2 = np.zeros(self.dimensions, dtype=np.float64)

    def encode(self, values, available=None, *, update=True):
        x = np.asarray(values, dtype=np.float64)
        mask = (
            np.ones(self.dimensions, bool)
            if available is None
            else np.asarray(available, bool)
        )
        if (
            x.shape != (self.dimensions,)
            or mask.shape != x.shape
            or not np.isfinite(x[mask]).all()
        ):
            raise ValueError("invalid proprioception")
        if update:
            self.count[mask] += 1
            delta = x[mask] - self.mean[mask]
            self.mean[mask] += delta / self.count[mask]
            self.m2[mask] += delta * (x[mask] - self.mean[mask])
        variance = self.m2 / np.maximum(self.count - 1, 1)
        result = np.zeros(self.dimensions, np.float32)
        result[mask] = np.tanh(
            (x[mask] - self.mean[mask]) / np.sqrt(variance[mask] + 1e-4)
        )
        return result

    def state_dict(self):
        return dict(
            count=self.count.tolist(), mean=self.mean.tolist(), m2=self.m2.tolist()
        )

    def load_state_dict(self, state):
        count = np.asarray(state["count"], np.int64)
        mean, m2 = np.asarray(state["mean"], float), np.asarray(state["m2"], float)
        if (
            any(x.shape != (self.dimensions,) for x in (count, mean, m2))
            or (count < 0).any()
            or (m2 < 0).any()
            or not np.isfinite(mean).all()
            or not np.isfinite(m2).all()
        ):
            raise ValueError("invalid normalization checkpoint")
        self.count, self.mean, self.m2 = count, mean, m2

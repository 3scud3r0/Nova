"""Bounded functional control signals, independently ablatable."""

from dataclasses import dataclass, field
import numpy as np


@dataclass
class Neuromodulator:
    enabled: frozenset[str] = field(
        default_factory=lambda: frozenset({"NE", "DA", "ACh", "5HT"})
    )
    error_scale: float = 1.0
    surprise: float = 0.0
    reward_pe: float = 0.0
    uncertainty: float = 0.0
    patience: float = 0.5

    def update(self, error, reward=0.0, value=0.0, next_value=0.0, uncertainty=0.0):
        error = max(0.0, float(error))
        self.surprise = float(np.clip(error / max(self.error_scale, 1e-8), 0, 10))
        self.error_scale = 0.99 * self.error_scale + 0.01 * error
        self.reward_pe = float(np.clip(reward + 0.99 * next_value - value, -10, 10))
        self.uncertainty = float(np.clip(uncertainty, 0, 1))
        self.patience = float(
            np.clip(0.99 * self.patience + 0.01 * (1 - self.uncertainty), 0, 1)
        )
        return self

    def learning_rate(self, base):
        return base * (1 + min(self.surprise, 2)) if "NE" in self.enabled else base

    def write_threshold(self, base):
        return base / (1 + self.surprise) if "NE" in self.enabled else base

    def sensory_weight(self):
        return 0.5 + 0.5 * self.uncertainty if "ACh" in self.enabled else 0.5

    def consolidation(self):
        return float(1 / (1 + np.exp(-self.reward_pe))) if "DA" in self.enabled else 0.5

    def discount(self):
        return 0.9 + 0.099 * self.patience if "5HT" in self.enabled else 0.95

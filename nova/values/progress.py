"""Confidence-adjusted learning progress; raw surprise is not intrinsic reward."""

from collections import deque
import numpy as np


class LearningProgress:
    """Compare disjoint old/recent error windows, penalizing sampling uncertainty.

    A positive-part one-step error difference has positive expectation under IID
    noise. Windowing and a confidence margin reduce that bias, but do not prove
    zero reward for every stationary process. Inputs should be held-out errors.
    """

    def __init__(self, window=32, confidence=2.0, reward_cap=1.0):
        if window < 2 or confidence < 0 or reward_cap < 0:
            raise ValueError("invalid progress estimator")
        self.window, self.confidence, self.reward_cap = window, confidence, reward_cap
        self.errors = deque(maxlen=2 * window)
        self.reward = 0.0
        self.standard_error = 0.0

    def update(self, error):
        if not np.isfinite(error) or error < 0:
            raise ValueError("prediction error must be finite and nonnegative")
        self.errors.append(float(error))
        self.reward = 0.0
        if len(self.errors) == 2 * self.window:
            old, recent = (
                np.asarray(self.errors)[: self.window],
                np.asarray(self.errors)[self.window :],
            )
            self.standard_error = float(
                np.sqrt(
                    old.var(ddof=1) / self.window + recent.var(ddof=1) / self.window
                )
            )
            self.reward = float(
                np.clip(
                    old.mean() - recent.mean() - self.confidence * self.standard_error,
                    0,
                    self.reward_cap,
                )
            )
        return self.reward

    def state_dict(self):
        return {
            "window": self.window,
            "confidence": self.confidence,
            "reward_cap": self.reward_cap,
            "errors": list(self.errors),
            "reward": self.reward,
            "standard_error": self.standard_error,
        }

    @classmethod
    def from_state_dict(cls, state):
        obj = cls(state["window"], state["confidence"], state["reward_cap"])
        obj.errors.extend(state["errors"])
        obj.reward = state["reward"]
        obj.standard_error = state["standard_error"]
        return obj

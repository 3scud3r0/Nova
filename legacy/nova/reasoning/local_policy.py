"""Amortized control with a fixed random feature map and local output delta rule."""

import numpy as np


class LocalPolicy:
    """a=tanh(tanh(zR+b)W+c); only the readout W,c adapts to a teacher action.

    This is a local supervised readout, not a replacement for all policy-learning
    algorithms. Hidden random features are frozen; no hidden-layer backward pass.
    """

    def __init__(self, inputs, outputs, seed=0, hidden=64):
        rng = np.random.default_rng(seed)
        self.inputs, self.outputs = inputs, outputs
        self.projection = rng.normal(0, 1 / np.sqrt(inputs), (inputs, hidden))
        self.bias = rng.normal(0, 0.1, hidden)
        self.weights = np.zeros((hidden, outputs))
        self.output_bias = np.zeros(outputs)

    def features(self, x):
        return np.tanh(np.asarray(x) @ self.projection + self.bias)

    def predict(self, x):
        return np.tanh(self.features(x) @ self.weights + self.output_bias)

    def learn(self, x, target, lr=0.01):
        x = np.atleast_2d(x)
        target = np.atleast_2d(target)
        features = self.features(x)
        pred = np.tanh(features @ self.weights + self.output_bias)
        if target.shape != pred.shape or not np.isfinite(target).all() or lr < 0:
            raise ValueError("invalid policy target")
        delta = np.clip((pred - target) * (1 - pred * pred), -1, 1)
        self.weights -= lr * features.T @ delta / len(x)
        self.output_bias -= lr * delta.mean(0)
        return float(np.mean((pred - target) ** 2))

    def state_dict(self):
        return {
            "inputs": self.inputs,
            "outputs": self.outputs,
            **{
                key: getattr(self, key).copy()
                for key in ("projection", "bias", "weights", "output_bias")
            },
        }

    @classmethod
    def from_state_dict(cls, state):
        obj = cls(
            state["inputs"], state["outputs"], hidden=np.shape(state["weights"])[0]
        )
        for key in ("projection", "bias", "weights", "output_bias"):
            setattr(obj, key, np.asarray(state[key]).copy())
        return obj

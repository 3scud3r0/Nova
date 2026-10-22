"""Local sheaf discrepancy descent; no Byzantine agreement or truth oracle."""

from __future__ import annotations
import numpy as np


class SheafGossip:
    def __init__(
        self, dimension, model_id, initial=None, *, max_neighbors=32, huber_delta=1.0
    ):
        if (
            not 1 <= dimension <= 128
            or not 1 <= max_neighbors <= 256
            or huber_delta <= 0
        ):
            raise ValueError("gossip size/scale budget exceeded")
        self.dimension, self.model_id, self.max_neighbors = (
            dimension,
            model_id,
            max_neighbors,
        )
        self.value = (
            np.zeros(dimension)
            if initial is None
            else np.asarray(initial, dtype=float).copy()
        )
        if self.value.shape != (dimension,) or not np.isfinite(self.value).all():
            raise ValueError("invalid belief")
        self.neighbors = {}
        self.huber_delta = huber_delta
        self.sequence = 0

    def accept(self, peer, payload, left=None, right=None):
        if payload.get("model_id") != self.model_id:
            return False
        value = np.asarray(payload["value"], dtype=float)
        sequence = payload["sequence"]
        if (
            value.shape != self.value.shape
            or not np.isfinite(value).all()
            or not isinstance(sequence, int)
            or sequence < 0
        ):
            raise ValueError("invalid belief packet")
        if peer not in self.neighbors and len(self.neighbors) >= self.max_neighbors:
            return False
        old = self.neighbors.get(peer)
        if old and sequence <= old["sequence"]:
            return False
        left = np.eye(self.dimension) if left is None else np.asarray(left, dtype=float)
        right = (
            np.eye(self.dimension) if right is None else np.asarray(right, dtype=float)
        )
        if (
            left.shape != (self.dimension, self.dimension)
            or right.shape != left.shape
            or not np.isfinite(left).all()
            or not np.isfinite(right).all()
        ):
            raise ValueError("restriction mismatch")
        self.neighbors[peer] = {
            "sequence": sequence,
            "value": value.copy(),
            "left": left,
            "right": right,
        }
        return True

    def step(self, step_size=0.1):
        if not 0 < step_size <= 1:
            raise ValueError("invalid gossip step")
        gradient = np.zeros_like(self.value)
        energy = 0.0
        bound = 0.0
        for neighbor in self.neighbors.values():
            left, right = neighbor["left"], neighbor["right"]
            difference = left @ self.value - right @ neighbor["value"]
            norm = np.linalg.norm(difference)
            scale = min(1.0, self.huber_delta / max(norm, 1e-12))
            gradient += left.T @ (difference * scale)
            energy += (
                0.5 * norm * norm
                if norm <= self.huber_delta
                else self.huber_delta * (norm - 0.5 * self.huber_delta)
            )
            bound += np.linalg.norm(left, 2) ** 2
        self.value -= min(step_size, 0.45 / max(bound, 1.0)) * gradient
        self.sequence += 1
        return {
            "model_id": self.model_id,
            "sequence": self.sequence,
            "value": self.value.tolist(),
            "discrepancy_before": float(energy),
            "scope": "local numerical consistency only; agreement is not a proof of truth",
        }

    def packet(self):
        return {
            "model_id": self.model_id,
            "sequence": self.sequence,
            "value": self.value.tolist(),
        }

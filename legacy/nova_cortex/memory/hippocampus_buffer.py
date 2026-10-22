"""Bounded PER ring with a separate protected high-surprise partition."""

from dataclasses import dataclass, fields
import math
import numpy as np


@dataclass
class Transition:
    embedding: np.ndarray
    proprio: np.ndarray
    previous_h: np.ndarray
    previous_z: np.ndarray
    last_action: np.ndarray
    action: np.ndarray
    next_embedding: np.ndarray
    next_proprio: np.ndarray
    drive: np.ndarray
    next_drive: np.ndarray
    reward: float
    terminal: bool = False
    truncated: bool = False
    episode: int = 0

    def validate(self):
        for field in fields(self):
            value = getattr(self, field.name)
            if isinstance(value, np.ndarray) and (
                value.ndim != 1 or value.size > 4096 or not np.isfinite(value).all()
            ):
                raise ValueError("invalid replay vector")
        if not math.isfinite(self.reward):
            raise ValueError("nonfinite replay reward")
        return self


class HippocampusBuffer:
    def __init__(self, capacity, *, protected_fraction=0.1, alpha=0.6, seed=42):
        if not (
            8 <= capacity <= 65536
            and 0 <= protected_fraction <= 0.5
            and 0 <= alpha <= 1
        ):
            raise ValueError("invalid PER budgets")
        self.capacity, self.alpha = capacity, alpha
        self.protected_size = int(capacity * protected_fraction)
        self.entries = [None] * capacity
        self.priorities = np.zeros(capacity, np.float64)
        self.regular_cursor = self.protected_size
        self.rng = np.random.default_rng(seed)
        self.seen = 0

    def __len__(self):
        return sum(e is not None for e in self.entries)

    def add(self, transition, surprise):
        transition.validate()
        if not math.isfinite(surprise) or surprise < 0:
            raise ValueError("invalid surprise")
        # Copy embeddings to host RAM; never pin a simulation lease in replay.
        transition = Transition(
            **{
                f.name: np.array(
                    getattr(transition, f.name), dtype=np.float32, copy=True
                )
                if isinstance(getattr(transition, f.name), np.ndarray)
                else getattr(transition, f.name)
                for f in fields(transition)
            }
        )
        priority = min(surprise + 1e-6, 1e6)
        self.seen += 1
        index = self.regular_cursor
        if self.protected_size:
            weakest = int(np.argmin(self.priorities[: self.protected_size]))
            if priority > self.priorities[weakest]:
                # Demote displaced protected memories into the normal ring.
                old = self.entries[weakest]
                if old is not None:
                    self.entries[index], self.priorities[index] = (
                        old,
                        self.priorities[weakest],
                    )
                    self.regular_cursor = self.protected_size + (
                        index - self.protected_size + 1
                    ) % (self.capacity - self.protected_size)
                index = weakest
        if index >= self.protected_size:
            self.regular_cursor = self.protected_size + (
                index - self.protected_size + 1
            ) % (self.capacity - self.protected_size)
        self.entries[index], self.priorities[index] = transition, priority
        return index

    def sample(self, batch_size, *, beta=0.4):
        if len(self) == 0 or not 1 <= batch_size <= 256 or not 0 <= beta <= 1:
            raise ValueError("empty buffer or invalid sampling parameters")
        valid = np.array([i for i, e in enumerate(self.entries) if e is not None])
        weights = self.priorities[valid] ** self.alpha
        probabilities = weights / weights.sum()
        chosen = self.rng.choice(len(valid), batch_size, replace=True, p=probabilities)
        indices = valid[chosen]
        importance = (len(valid) * probabilities[chosen]) ** (-beta)
        importance /= importance.max()
        return (
            [self.entries[int(i)] for i in indices],
            indices,
            importance.astype(np.float32),
        )

    def update_priorities(self, indices, values):
        for i, value in zip(indices, values):
            if not math.isfinite(float(value)) or value < 0:
                raise ValueError("invalid updated priority")
            self.priorities[int(i)] = min(float(value) + 1e-6, 1e6)

    def most_surprising(self, limit=1000):
        order = np.argsort(-self.priorities, kind="stable")
        return [
            self.entries[int(i)]
            for i in order[:limit]
            if self.entries[int(i)] is not None
        ]

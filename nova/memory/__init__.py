"""Associative retrieval, bounded working state, and source-preserving episodes."""

from __future__ import annotations
from collections import deque
from dataclasses import dataclass, field
import numpy as np
from scipy.special import softmax, logsumexp


def kwta(x, k):
    """Keep k largest magnitudes per row; ties are deterministic."""
    x = np.asarray(x)
    n = x.shape[-1]
    k = max(1, round(k * n)) if isinstance(k, float) else k
    if not 1 <= k <= n:
        raise ValueError("k outside [1, dimensions]")
    indices = np.argsort(np.abs(x), axis=-1, kind="stable")[..., -k:]
    out = np.zeros_like(x)
    np.put_along_axis(out, indices, np.take_along_axis(x, indices, -1), -1)
    return out


class ModernHopfield:
    """Recall softmax(beta * q X.T) X; E(q)=||q||²/2-logsumexp(beta Xq)/beta."""

    def __init__(self, patterns, beta=10.0):
        self.patterns = np.asarray(patterns, dtype=float)
        if self.patterns.ndim != 2 or not len(self.patterns) or beta <= 0:
            raise ValueError("invalid patterns/beta")
        self.beta = beta

    def retrieve(self, query, iterations=1):
        q = np.asarray(query, dtype=float)
        for _ in range(iterations):
            q = softmax(self.beta * (q @ self.patterns.T), axis=-1) @ self.patterns
        return q

    def energy(self, query):
        q = np.asarray(query, dtype=float)
        return (
            np.sum(q * q, axis=-1) / 2
            - logsumexp(self.beta * (q @ self.patterns.T), axis=-1) / self.beta
        )


@dataclass
class Episode:
    id: str
    embedding: np.ndarray
    content: str
    source: str
    timestamp: str
    location: str = ""
    participants: tuple[str, ...] = ()
    valence: float = 0.0
    surprise: float = 0.0
    anchor: bool = False
    revisions: list[str] = field(default_factory=list)


class EpisodicMemory:
    def __init__(self, capacity=1024, threshold=0.5):
        self.capacity, self.threshold = capacity, threshold
        self.episodes: list[Episode] = []

    def write(self, episode: Episode, force=False):
        if not episode.source:
            raise ValueError("episode requires source")
        if any(e.id == episode.id for e in self.episodes):
            raise ValueError("duplicate episode id")
        if not force and episode.surprise < self.threshold:
            return False
        if len(self.episodes) >= self.capacity:
            candidates = [e for e in self.episodes if not e.anchor]
            if not candidates:
                return False
            victim = min(candidates, key=lambda e: e.surprise + abs(e.valence))
            self.episodes = [e for e in self.episodes if e.id != victim.id]
        self.episodes.append(episode)
        return True

    def retrieve(self, query, limit=3, *, participant=None, location=None, before=None):
        candidates = [
            e
            for e in self.episodes
            if (participant is None or participant in e.participants)
            and (location is None or location == e.location)
            and (before is None or e.timestamp < before)
        ]
        q = np.asarray(query)
        norm = max(np.linalg.norm(q), 1e-12)
        return sorted(
            candidates,
            key=lambda e: float(
                q @ e.embedding / (norm * max(np.linalg.norm(e.embedding), 1e-12))
            ),
            reverse=True,
        )[:limit]

    def reconsolidate(self, episode_id, content):
        e = next(e for e in self.episodes if e.id == episode_id)
        e.revisions.append(e.content)
        e.content = content

    def sleep(self, learn, limit=32):
        chosen = sorted(
            self.episodes, key=lambda e: e.surprise + abs(e.valence), reverse=True
        )[:limit]
        for e in chosen:
            learn(e)
        # Exact duplicates only: conflicting or similar episodes must not be merged.
        seen = set()
        kept = []
        for e in self.episodes:
            key = (e.content, e.source, e.timestamp)
            if e.anchor or key not in seen:
                kept.append(e)
            seen.add(key)
        self.episodes = kept
        return len(chosen)


class WorkingMemory:
    def __init__(self, slots=7, dimensions=8, decay=0.95):
        if not 1 <= slots <= 10 or not 0 <= decay <= 1:
            raise ValueError("invalid working-memory configuration")
        self.state = np.zeros((slots, dimensions))
        self.decay = decay
        self.cursor = 0

    def update(self, value=None, gate=1.0):
        if not 0 <= gate <= 1:
            raise ValueError("gate must be in [0,1]")
        self.state *= self.decay
        if value is not None:
            self.state[self.cursor] = (1 - gate) * self.state[
                self.cursor
            ] + gate * np.asarray(value)
            self.cursor = (self.cursor + 1) % len(self.state)
        return self.state.copy()


class SensoryBuffer(deque):
    def __init__(self, capacity=32):
        super().__init__(maxlen=capacity)


class SemanticGraph:
    """Retain contradictory facts with distinct sources; never silently merge."""

    def __init__(self):
        self.facts = []

    def add(self, subject, predicate, value, source, confidence=1.0, timestamp=""):
        if not source or not 0 <= confidence <= 1:
            raise ValueError("source/confidence required")
        fact = dict(
            subject=subject,
            predicate=predicate,
            value=value,
            source=source,
            confidence=confidence,
            timestamp=timestamp,
        )
        if fact not in self.facts:
            self.facts.append(fact)

    def query(self, subject, predicate):
        return [
            f.copy()
            for f in self.facts
            if f["subject"] == subject and f["predicate"] == predicate
        ]

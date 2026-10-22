"""Reward-trained Lewis signaling and a held-out empirical context decoder."""

import numpy as np
from .determinism import SplitMix64


class LewisAgent:
    def __init__(self, seed, vocabulary=8, contexts=4):
        self.seed = seed
        self.vocabulary = vocabulary
        self.contexts = contexts
        self.speaker = SplitMix64(seed).uniform((contexts, vocabulary), -0.01, 0.01)
        self.listener = np.zeros((vocabulary, contexts))
        self.games = 0

    def signal(self, context, tick):
        # Sparse deterministic exploration is included in the simulation clock.
        if tick % 17 == 0:
            return int((self.seed + tick) % self.vocabulary)
        return int(np.argmax(self.speaker[context]))

    def interpret(self, token):
        return int(np.argmax(self.listener[token]))

    def reinforce(self, context, token, guess, reward, lr=0.05):
        self.speaker[context, token] += lr * (reward - self.speaker[context, token])
        self.listener[token, context] += lr * (1 - self.listener[token, context])
        self.listener[token, guess] -= lr * (1 - reward) * 0.5
        self.games += 1

    def state_dict(self):
        return {
            "seed": self.seed,
            "vocabulary": self.vocabulary,
            "contexts": self.contexts,
            "speaker": self.speaker.copy(),
            "listener": self.listener.copy(),
            "games": self.games,
        }

    @classmethod
    def restore(cls, state):
        obj = cls(state["seed"], state["vocabulary"], state["contexts"])
        for key in ("speaker", "listener"):
            setattr(obj, key, np.asarray(state[key]).copy())
        obj.games = state["games"]
        return obj


class SignalInterpreter:
    """Associations are measured labels of contexts, never literal mind reading.

    Labels name instrumented local resource/temperature bins; no claim of syntax,
    natural language, spatial semantics, or calibrated external translation.
    """

    labels = (
        "recurso baixo / temperatura baixa",
        "recurso alto / temperatura baixa",
        "recurso baixo / temperatura alta",
        "recurso alto / temperatura alta",
    )

    def __init__(self, vocabulary=8):
        self.train = np.zeros((vocabulary, 4), dtype=np.int64)
        self.heldout = np.zeros_like(self.train)
        self.events = 0

    @staticmethod
    def context(resource, temperature):
        return int(resource > 0.25) + 2 * int(temperature > 0.1)

    def observe(self, token, context):
        matrix = self.heldout if self.events % 5 == 0 else self.train
        matrix[token, context] += 1
        self.events += 1

    def report(self):
        total = int(self.train.sum())
        joint = self.train / max(1, total)
        rows = joint.sum(1, keepdims=True)
        cols = joint.sum(0, keepdims=True)
        ratio = np.divide(
            joint, rows * cols, out=np.ones_like(joint), where=(rows * cols) > 0
        )
        mi = float(
            np.sum(np.where(joint > 0, joint * np.log2(np.maximum(ratio, 1e-30)), 0))
        )
        entries = []
        for token, counts in enumerate(self.train):
            count = int(counts.sum())
            label = int(np.argmax(counts))
            n = int(self.heldout[token].sum())
            correct = int(self.heldout[token, label])
            confidence = correct / n if n else None
            entries.append(
                {
                    "pattern": f"{token:02X}",
                    "samples": count,
                    "heldout_samples": n,
                    "heldout_accuracy": confidence,
                    "association": self.labels[label]
                    if count >= 8 and n >= 3 and confidence >= 0.6
                    else "associação insuficiente",
                }
            )
        return {
            "events": self.events,
            "mutual_information_bits": mi,
            "patterns": entries,
            "scope": "empirical instrumented context association; no demonstrated syntax or causal semantics",
        }

    def state_dict(self):
        return {
            "train": self.train.copy(),
            "heldout": self.heldout.copy(),
            "events": self.events,
        }

    @classmethod
    def restore(cls, state):
        obj = cls(len(state["train"]))
        obj.train = np.asarray(state["train"]).copy()
        obj.heldout = np.asarray(state["heldout"]).copy()
        obj.events = state["events"]
        return obj

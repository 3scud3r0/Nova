"""Functional resource/affect state and hard output constraints outside learning."""

from dataclasses import dataclass
import numpy as np


SIMULATION_LABEL = "Simulação baseada em dados — não é a pessoa real."


@dataclass
class InternalState:
    energy: float = 1.0
    memory_load: float = 0.0
    curiosity: float = 0.0
    coherence: float = 1.0
    engagement: float = 0.0
    valence: float = 0.0
    arousal: float = 0.0
    control: float = 1.0
    previous_error: float = 1.0

    def update(
        self, error, compute_fraction, memory_load, value_delta=0.0, engagement=0.0
    ):
        self.energy = float(np.clip(self.energy + 0.01 - 0.02 * compute_fraction, 0, 1))
        self.memory_load = float(np.clip(memory_load, 0, 1))
        # Legacy one-step heuristic. Runtime overrides it with windowed LearningProgress.
        self.curiosity = float(np.clip(self.previous_error - error, 0, 1))
        self.previous_error = float(error)
        self.valence = float(np.tanh(value_delta - error))
        self.arousal = float(np.clip(error, 0, 1))
        self.control = float(np.clip(1 - error, 0, 1))
        self.engagement = float(np.clip(engagement, 0, 1))
        return self

    def sleep(self):
        self.energy = min(1.0, self.energy + 0.2)


class OutputPolicy:
    """A deterministic gate, not a trainable reward or a mutable network weight."""

    @staticmethod
    def render_claims(claims, *, identity_mode=False, consented=False):
        if identity_mode and not consented:
            raise PermissionError("identity consent required")
        lines = []
        for claim in claims:
            if claim.get("third_party_private"):
                raise PermissionError("third-party data is not releasable")
            if not claim.get("source"):
                raise ValueError("factual claim requires source")
            prefix = "Inferência: " if claim.get("inference") else ""
            lines.append(f"{prefix}{claim['text']} (fonte: {claim['source']})")
        answer = (
            "\n".join(lines)
            if lines
            else "Não sei; preciso de uma fonte para responder."
        )
        return f"{SIMULATION_LABEL}\n{answer}" if identity_mode else answer

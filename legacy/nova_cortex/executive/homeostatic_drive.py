"""Typed observable preferences; missing physical variables are never fabricated."""

from dataclasses import dataclass
import numpy as np


@dataclass(frozen=True)
class HomeostaticSignals:
    occupancy: float
    diversity: float
    energy: float | None = None
    uncertainty: float = 0.0


class HomeostaticDrive:
    def __init__(self, config):
        self.config = config

    def targets(self, signals):
        energy_or_occupancy = (
            signals.occupancy if signals.energy is None else signals.energy
        )
        return np.array(
            [energy_or_occupancy, signals.diversity], dtype=np.float32
        ).clip(0, 1)

    def reward(self, signals):
        target = self.targets(signals)
        preference = np.array(
            [self.config.preference_energy, self.config.preference_diversity]
        )
        return -float(
            np.sum((target - preference) ** 2) + 0.1 * max(0, signals.uncertainty)
        )

    @staticmethod
    def from_field(field, *, energy_available=False):
        values = np.asarray(field)
        density = values[0]
        occupancy = float(np.mean(density > 0.001))
        counts, _ = np.histogram(np.clip(density, 0, 1), bins=16, range=(0, 1))
        p = counts[counts > 0] / density.size
        entropy = float(-np.sum(p * np.log(p)) / np.log(16))
        energy = float(np.clip(values[3].mean(), 0, 1)) if energy_available else None
        return HomeostaticSignals(occupancy=occupancy, diversity=entropy, energy=energy)

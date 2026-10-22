"""Weighted reservoir / RIS primitive; not a complete ReSTIR DI/GI renderer."""

from dataclasses import dataclass

import numpy as np

from nova.bioma.determinism import SplitMix64


@dataclass
class Reservoir:
    seed: int = 0

    def __post_init__(self):
        self.rng = SplitMix64(self.seed)
        self.sample = None
        self.target = 0.0
        self.weight_sum = 0.0
        self.candidates = 0

    def update(self, sample, target, proposal_pdf):
        if (
            not np.isfinite([target, proposal_pdf]).all()
            or target < 0
            or proposal_pdf <= 0
        ):
            raise ValueError("finite target and positive proposal density required")
        weight = target / proposal_pdf
        if not np.isfinite(weight) or not np.isfinite(self.weight_sum + weight):
            raise ValueError("reservoir weights overflow")
        self.candidates += 1
        self.weight_sum += weight
        if weight and self.rng.uniform((1,))[0] < weight / self.weight_sum:
            self.sample = sample
            self.target = target

    def estimate(self, integrand_at_sample):
        if self.sample is None:
            return 0.0
        return (
            np.asarray(integrand_at_sample)
            * self.weight_sum
            / (self.candidates * self.target)
        )

    def merge_reweighted(self, other, target_at_new_receiver):
        if other.sample is None:
            return
        if not np.isfinite(target_at_new_receiver) or target_at_new_receiver < 0:
            raise ValueError("invalid receiver target")
        weight = target_at_new_receiver * other.weight_sum / max(other.target, 1e-30)
        total = self.weight_sum + weight
        if not np.isfinite(total):
            raise ValueError("reused reservoir overflow")
        self.candidates += other.candidates
        if weight and self.rng.uniform((1,))[0] < weight / max(total, 1e-30):
            self.sample = other.sample
            self.target = target_at_new_receiver
        self.weight_sum = total

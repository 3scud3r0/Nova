"""Declared expected-free-energy surrogate, not exact Bayesian information gain."""

import torch
from torch import nn


class ActiveInference(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.config = config
        self.register_buffer(
            "preferences",
            torch.tensor([config.preference_energy, config.preference_diversity]),
        )

    def evaluate(self, model, belief):
        predicted = model.drive_head(belief.vector())
        risk = (predicted - self.preferences).square().sum(-1)
        _, disagreement, noise = model.prior_statistics(belief.h)
        information_proxy = 0.5 * torch.log1p(
            disagreement / noise.clamp_min(1e-6)
        ).mean(-1)
        expected_free_energy = (
            self.config.risk_weight * risk
            - self.config.epistemic_weight * information_proxy
        )
        return expected_free_energy, dict(
            risk=risk, information_proxy=information_proxy
        )

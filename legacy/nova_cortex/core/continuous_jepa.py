"""EMA target representations with action prediction and VICReg penalties."""

import copy
import torch
from torch import nn


class ContinuousJEPA(nn.Module):
    def __init__(self, embedding, action_dim, *, decay=0.99):
        super().__init__()
        self.online = nn.Sequential(
            nn.Linear(embedding, embedding), nn.LayerNorm(embedding), nn.SiLU()
        )
        self.target = copy.deepcopy(self.online).requires_grad_(False)
        self.predictor = nn.Sequential(
            nn.Linear(embedding + action_dim, embedding),
            nn.SiLU(),
            nn.Linear(embedding, embedding),
        )
        self.decay = decay

    @staticmethod
    def vicreg(z):
        if z.shape[0] < 2:
            return z.new_zeros(())
        centered = z - z.mean(0)
        variance = torch.relu(1 - torch.sqrt(centered.square().mean(0) + 1e-4)).mean()
        covariance = centered.T @ centered / (z.shape[0] - 1)
        off_diagonal = covariance - torch.diag_embed(covariance.diagonal())
        return variance + off_diagonal.square().sum() / z.shape[1]

    def loss(self, current, action, following):
        online = self.online(current)
        with torch.no_grad():
            target = self.target(following)
        prediction = self.predictor(torch.cat([online, action], -1))
        return torch.nn.functional.l1_loss(prediction, target) + 0.1 * self.vicreg(
            online
        )

    @torch.no_grad()
    def update_target(self):
        for target, online in zip(self.target.parameters(), self.online.parameters()):
            target.lerp_(online, 1 - self.decay)

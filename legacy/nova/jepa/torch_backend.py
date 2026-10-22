"""Latent prediction with a stopped, exponential-moving-average target."""

from copy import deepcopy
import torch
from torch import nn
from torch.nn import functional as F


class ContextEncoder(nn.Sequential):
    def __init__(self, observation_dim: int, latent_dim: int, hidden: int = 64):
        super().__init__(
            nn.Linear(observation_dim, hidden), nn.SiLU(), nn.Linear(hidden, latent_dim)
        )


class TargetEncoder(nn.Module):
    def __init__(self, encoder: nn.Module):
        super().__init__()
        self.encoder = deepcopy(encoder).requires_grad_(False)

    def forward(self, x):
        with torch.no_grad():
            return self.encoder(x)

    @torch.no_grad()
    def update(self, encoder: nn.Module, decay: float = 0.99):
        for target, source in zip(
            self.encoder.parameters(), encoder.parameters(), strict=True
        ):
            target.lerp_(source, 1 - decay)
        for target, source in zip(
            self.encoder.buffers(), encoder.buffers(), strict=True
        ):
            target.copy_(source)


class LatentPredictor(nn.Module):
    def __init__(self, latent_dim: int, action_dim: int, hidden: int = 64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(latent_dim + action_dim, hidden),
            nn.SiLU(),
            nn.Linear(hidden, latent_dim),
        )

    def forward(self, z, action):
        return self.net(torch.cat((z, action), dim=-1))


class JEPA(nn.Module):
    def __init__(
        self,
        observation_dim: int,
        latent_dim: int,
        action_dim: int,
        *,
        variance_weight: float = 1.0,
        covariance_weight: float = 0.01,
    ):
        super().__init__()
        self.context = ContextEncoder(observation_dim, latent_dim)
        self.target = TargetEncoder(self.context)
        self.predictor = LatentPredictor(latent_dim, action_dim)
        self.variance_weight, self.covariance_weight = (
            variance_weight,
            covariance_weight,
        )

    def loss(self, x, action, future):
        z = self.context(x)
        target = self.target(future)
        pred = self.predictor(z, action)
        prediction = F.smooth_l1_loss(pred, target)
        std = torch.sqrt(z.var(0, unbiased=False) + 1e-4)
        variance = F.relu(0.5 - std).mean()
        centered = z - z.mean(0)
        covariance = centered.T @ centered / max(len(z) - 1, 1)
        off_diagonal = covariance - torch.diag(torch.diag(covariance))
        loss = (
            prediction
            + self.variance_weight * variance
            + self.covariance_weight * off_diagonal.square().mean()
        )
        return loss, {
            "prediction": prediction.detach().item(),
            "latent_std": z.std(0).mean().detach().item(),
        }

    @torch.no_grad()
    def assert_noncollapsed(self, x, threshold=0.05):
        std = self.context(x).std(0).mean().item()
        if std < threshold:
            raise AssertionError(f"latent collapse: mean std {std:.6g} < {threshold}")
        return std

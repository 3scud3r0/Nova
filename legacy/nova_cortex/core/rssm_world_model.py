"""Gaussian RSSM with deterministic GRU state and bootstrap prior ensemble."""

from dataclasses import dataclass
import torch
from torch import nn
from torch.distributions import Normal, kl_divergence


@dataclass
class Belief:
    h: torch.Tensor
    z: torch.Tensor

    def vector(self):
        return torch.cat([self.h, self.z], -1)

    def detach(self):
        return Belief(self.h.detach(), self.z.detach())


@dataclass
class PosteriorStep:
    belief: Belief
    prior: Normal
    posterior: Normal
    reconstruction: torch.Tensor
    epistemic_proxy: torch.Tensor
    aleatoric_variance: torch.Tensor


class RSSMWorldModel(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.config = config.validate()
        self.gru = nn.GRUCell(config.stochastic + config.action_dim, config.hidden)
        self.priors = nn.ModuleList(
            [
                nn.Sequential(
                    nn.Linear(config.hidden, 256),
                    nn.SiLU(),
                    nn.Linear(256, 2 * config.stochastic),
                )
                for _ in range(config.ensemble)
            ]
        )
        self.posterior = nn.Sequential(
            nn.Linear(config.hidden + config.embedding + config.proprio_dim, 256),
            nn.SiLU(),
            nn.Linear(256, 2 * config.stochastic),
        )
        self.decoder = nn.Sequential(
            nn.Linear(config.latent, 256), nn.SiLU(), nn.Linear(256, config.embedding)
        )
        self.drive_head = nn.Sequential(
            nn.Linear(config.latent, 64), nn.SiLU(), nn.Linear(64, 2), nn.Sigmoid()
        )

    def initial(self, batch=1, *, device=None):
        parameter = next(self.parameters())
        kwargs = dict(device=device or parameter.device, dtype=parameter.dtype)
        return Belief(
            torch.zeros(batch, self.config.hidden, **kwargs),
            torch.zeros(batch, self.config.stochastic, **kwargs),
        )

    @staticmethod
    def distribution(parameters):
        mean, scale = parameters.chunk(2, -1)
        return Normal(mean, torch.nn.functional.softplus(scale.clamp(-8, 5)) + 0.05)

    def transition(self, belief, action):
        if action.shape != (belief.h.shape[0], self.config.action_dim):
            raise ValueError("action shape differs from belief batch")
        return self.gru(torch.cat([belief.z, action], -1), belief.h)

    def prior_statistics(self, h):
        priors = [self.distribution(head(h)) for head in self.priors]
        means = torch.stack([p.loc for p in priors])
        variance = torch.stack([p.variance for p in priors]).mean(0)
        disagreement = means.var(0, unbiased=False)
        # Ensemble disagreement is a proxy, not calibrated epistemic uncertainty.
        return priors, disagreement, variance

    def observe(self, embedding, proprio, last_action, previous, *, sample=True):
        h = self.transition(previous, last_action)
        priors, disagreement, variance = self.prior_statistics(h)
        posterior = self.distribution(
            self.posterior(torch.cat([h, embedding, proprio], -1))
        )
        z = posterior.rsample() if sample else posterior.loc
        belief = Belief(h, z)
        return PosteriorStep(
            belief,
            priors[0],
            posterior,
            self.decoder(belief.vector()),
            disagreement.mean(-1),
            variance.mean(-1),
        )

    def loss(self, step, embedding, drive_target=None, importance=None):
        priors, _, _ = self.prior_statistics(step.belief.h)
        q = step.posterior
        detached_q = Normal(q.loc.detach(), q.scale.detach())
        weights = (
            torch.ones(q.loc.shape[0], device=q.loc.device)
            if importance is None
            else importance
        )
        weights = weights / weights.sum().clamp_min(1e-8)
        average = lambda values: (values * weights).sum()
        dynamic, representation = [], []
        for prior in priors:
            # Independent bootstrap masks provide different member training data.
            mask = (torch.rand(q.loc.shape[0], device=q.loc.device) > 0.2).float()
            if not mask.any():
                mask[0] = 1
            member_weights = weights * mask
            member_weights = member_weights / member_weights.sum().clamp_min(1e-8)
            dynamic.append(
                (
                    member_weights
                    * kl_divergence(detached_q, prior)
                    .sum(-1)
                    .clamp_min(self.config.free_nats)
                ).sum()
            )
            detached_prior = Normal(prior.loc.detach(), prior.scale.detach())
            representation.append(
                (
                    member_weights
                    * kl_divergence(q, detached_prior)
                    .sum(-1)
                    .clamp_min(self.config.free_nats)
                ).sum()
            )
        kl = (
            self.config.kl_balance * torch.stack(dynamic).mean()
            + (1 - self.config.kl_balance) * torch.stack(representation).mean()
        )
        reconstruction = average(
            (step.reconstruction - embedding.detach()).square().mean(-1)
        )
        drive = (
            reconstruction.new_zeros(())
            if drive_target is None
            else average(
                (self.drive_head(step.belief.vector()) - drive_target).square().mean(-1)
            )
        )
        loss = reconstruction + self.config.kl_weight * kl + drive
        return loss, dict(
            reconstruction=reconstruction.detach(), kl=kl.detach(), drive=drive.detach()
        )

    def imagine(self, belief, action, *, member=0, sample=False):
        h = self.transition(belief, action)
        prior = self.distribution(self.priors[member](h))
        return Belief(h, prior.rsample() if sample else prior.loc)

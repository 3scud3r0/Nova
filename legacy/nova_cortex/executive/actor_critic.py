"""Fast bounded actor with bootstrapped critic and CEM behavior distillation."""

import torch
from torch import nn


class ActorCritic(nn.Module):
    def __init__(self, latent, action_dim=8, hidden=128, discount=0.99):
        super().__init__()
        self.discount = discount
        self.actor = nn.Sequential(
            nn.Linear(latent, hidden),
            nn.SiLU(),
            nn.Linear(hidden, hidden),
            nn.SiLU(),
            nn.Linear(hidden, action_dim),
            nn.Tanh(),
        )
        self.critic = nn.Sequential(
            nn.Linear(latent, hidden), nn.SiLU(), nn.Linear(hidden, 1)
        )

    def act(self, latent):
        return self.actor(latent)

    def loss(self, state, action, reward, following, terminal, *, teacher=None):
        state, following = state.detach(), following.detach()
        value = self.critic(state).squeeze(-1)
        with torch.no_grad():
            target = reward + self.discount * (1 - terminal) * self.critic(
                following
            ).squeeze(-1)
            advantage = (target - value).clamp(-10, 10)
        # Fixed-variance Gaussian policy-gradient surrogate over the bounded mean.
        log_probability = -0.5 * (
            (self.actor(state) - action.detach()) / 0.2
        ).square().sum(-1)
        policy = -(log_probability * advantage).mean()
        critic = torch.nn.functional.mse_loss(value, target)
        imitation = (
            value.new_zeros(())
            if teacher is None
            else torch.nn.functional.mse_loss(self.actor(state), teacher.detach())
        )
        return policy + 0.5 * critic + imitation

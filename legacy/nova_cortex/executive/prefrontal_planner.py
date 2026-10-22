"""Cross-entropy planning over bounded action sequences in the RSSM."""

import torch
from ..core.rssm_world_model import Belief


class PrefrontalPlanner:
    def __init__(self, model, objective, config):
        self.model, self.objective, self.config = model, objective, config

    @torch.no_grad()
    def plan(self, belief, actor=None):
        if belief.h.shape[0] != 1:
            raise ValueError("CEM plans one environment at a time")
        c = self.config
        mean = belief.h.new_zeros(c.horizon, c.action_dim)
        if actor is not None:
            mean[:] = actor.act(belief.vector())[0]
        std = torch.ones_like(mean) * 0.5
        best_cost = None
        for _ in range(c.cem_iterations):
            candidates = (
                mean
                + std
                * torch.randn(
                    c.cem_population, c.horizon, c.action_dim, device=mean.device
                )
            ).clamp(-1, 1)
            costs = mean.new_zeros(c.cem_population)
            imagined = Belief(
                belief.h.expand(c.cem_population, -1),
                belief.z.expand(c.cem_population, -1),
            )
            for horizon in range(c.horizon):
                imagined = self.model.imagine(imagined, candidates[:, horizon])
                free_energy, _ = self.objective.evaluate(self.model, imagined)
                costs += 0.99**horizon * free_energy + 0.001 * candidates[
                    :, horizon
                ].square().mean(-1)
            indices = costs.topk(c.cem_elites, largest=False).indices
            elites = candidates[indices]
            mean = elites.mean(0)
            std = elites.std(0, unbiased=False).clamp(0.05, 1)
            best_cost = costs[indices[0]]
        # Optional differentiation through discrete imagined transitions; this is
        # truncated backpropagation, not a continuous-time adjoint ODE solver.
        if c.cem_gradient_steps:
            with torch.enable_grad():
                sequence = mean.detach().clone().requires_grad_(True)
                for _ in range(c.cem_gradient_steps):
                    state = belief.detach()
                    objective = sequence.new_zeros(())
                    for horizon in range(c.horizon):
                        state = self.model.imagine(
                            state, sequence[horizon].unsqueeze(0)
                        )
                        free_energy, _ = self.objective.evaluate(self.model, state)
                        objective = objective + free_energy.sum()
                    (gradient,) = torch.autograd.grad(objective, sequence)
                    sequence = (
                        (sequence - 0.05 * gradient.clamp(-1, 1))
                        .clamp(-1, 1)
                        .detach()
                        .requires_grad_(True)
                    )
                mean = sequence.detach()
        return mean[0].unsqueeze(0), dict(
            expected_free_energy=float(best_cost),
            horizon=c.horizon,
            gradient_refinement_steps=c.cem_gradient_steps,
        )


def action_to_wire(action):
    """Eight bounded controls -> one normalized impulse/paint command."""
    values = action.detach().cpu().reshape(-1).tolist()
    if len(values) != 8:
        raise ValueError("action vector must have eight components")
    # Last component chooses modality; grids always use the paint conversion.
    return dict(
        position=[(values[k] + 1) * 0.5 for k in range(3)],
        radius=0.005 + 0.095 * (values[3] + 1) * 0.5,
        strength=values[4],
        vector=values[5:8],
    )

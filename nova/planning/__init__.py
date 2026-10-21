"""Receding-horizon cross-entropy search and evidence accumulation."""

from dataclasses import dataclass
from time import perf_counter
import numpy as np


@dataclass
class Plan:
    action: np.ndarray
    cost: float
    iterations: int
    rollouts: int


class LatentPlanner:
    """CEM minimizes sum gamma**t * cost(z_t), subject to box action bounds."""

    def __init__(
        self,
        predictor,
        cost,
        action_dim=1,
        horizon=12,
        rollouts=128,
        iterations=4,
        elite_fraction=0.1,
        seed=0,
        discount=0.99,
    ):
        if (
            min(action_dim, horizon, rollouts, iterations) < 1
            or not 0 < elite_fraction <= 1
        ):
            raise ValueError("invalid search configuration")
        self.predictor, self.cost = predictor, cost
        self.action_dim, self.horizon, self.rollouts, self.iterations = (
            action_dim,
            horizon,
            rollouts,
            iterations,
        )
        self.elite_fraction, self.discount = elite_fraction, discount
        self.rng = np.random.default_rng(seed)

    def plan(self, z, budget_ms=None):
        start = perf_counter()
        mean = np.zeros((self.horizon, self.action_dim))
        std = np.ones_like(mean)
        best_cost = float("inf")
        best = np.zeros_like(mean)
        completed = 0
        for i in range(self.iterations):
            if (
                i
                and budget_ms is not None
                and (perf_counter() - start) * 1000 >= budget_ms
            ):
                break
            actions = np.clip(
                self.rng.normal(mean, std, (self.rollouts, *mean.shape)), -1, 1
            )
            actions[0] = best
            states = np.broadcast_to(z, (self.rollouts, len(z))).copy()
            costs = np.zeros(self.rollouts)
            for t in range(self.horizon):
                states = np.asarray(self.predictor(states, actions[:, t]))
                costs += self.discount**t * np.asarray(self.cost(states))
            elite = np.argsort(costs)[
                : max(1, int(self.rollouts * self.elite_fraction))
            ]
            if costs[elite[0]] < best_cost:
                best_cost = float(costs[elite[0]])
                best = actions[elite[0]].copy()
            mean = actions[elite].mean(0)
            std = np.maximum(actions[elite].std(0), 0.05)
            completed += 1
        return Plan(best[0].copy(), best_cost, completed, completed * self.rollouts)


def drift_diffusion(
    evidence, *, threshold=1.0, noise=0.1, dt=0.01, max_steps=1000, seed=0, urgency=0.0
):
    rng = np.random.default_rng(seed)
    evidence = np.asarray(evidence, dtype=float)
    state = np.zeros_like(evidence)
    for step in range(max_steps):
        state += evidence * dt + noise * np.sqrt(dt) * rng.normal(size=state.shape)
        if state.max() >= max(0.1, threshold - urgency * step * dt):
            return int(state.argmax()), (step + 1) * dt
    return int(state.argmax()), max_steps * dt

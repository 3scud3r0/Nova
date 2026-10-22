"""Receding-horizon CEM baseline, explicit feasibility and warm-start state."""

from dataclasses import dataclass, field
from time import perf_counter
import numpy as np


@dataclass
class Plan:
    action: np.ndarray
    cost: float | None
    iterations: int
    rollouts: int
    diagnostics: dict = field(default_factory=dict)


class LatentPlanner:
    """CEM searches H*action_dim variables; latent_dim affects rollout cost.

    Reuses the shifted previous plan, retains a feasible incumbent, and rejects
    invalid trajectories. The time budget is soft and checked between model
    calls. A zero stop command is not certified safe when every candidate fails.
    """

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
        constraint=None,
    ):
        if (
            min(action_dim, horizon, rollouts, iterations) < 1
            or not 0 < elite_fraction <= 1
            or not 0 < discount <= 1
        ):
            raise ValueError("invalid search configuration")
        self.predictor, self.cost = predictor, cost
        self.action_dim, self.horizon, self.rollouts, self.iterations = (
            action_dim,
            horizon,
            rollouts,
            iterations,
        )
        self.elite_fraction, self.discount, self.constraint = (
            elite_fraction,
            discount,
            constraint,
        )
        self.rng = np.random.default_rng(seed)
        self.warm_actions = np.zeros((horizon, action_dim))
        self.last_diagnostics = {}

    def plan(self, z, budget_ms=None):
        if budget_ms is not None and (not np.isfinite(budget_ms) or budget_ms <= 0):
            raise ValueError("positive time budget required")
        z = np.asarray(z, dtype=float)
        if z.ndim != 1 or not np.isfinite(z).all():
            raise ValueError("finite latent vector required")
        start = perf_counter()
        mean = self.warm_actions.copy()
        std = np.ones_like(mean)
        best_cost = float("inf")
        best = None
        completed = 0
        calls = 0
        reason = "iterations"
        for iteration in range(self.iterations):
            if budget_ms is not None and (perf_counter() - start) * 1000 >= budget_ms:
                reason = "deadline"
                break
            actions = np.clip(
                self.rng.normal(mean, std, (self.rollouts, *mean.shape)), -1, 1
            )
            actions[0] = self.warm_actions if best is None else best
            states = np.broadcast_to(z, (self.rollouts, len(z))).copy()
            costs = np.zeros(self.rollouts)
            valid = np.ones(self.rollouts, dtype=bool)
            aborted = False
            for t in range(self.horizon):
                if (
                    budget_ms is not None
                    and (perf_counter() - start) * 1000 >= budget_ms
                ):
                    reason = "deadline"
                    aborted = True
                    break
                states = np.asarray(self.predictor(states, actions[:, t]))
                calls += self.rollouts
                if states.shape != (self.rollouts, len(z)):
                    raise ValueError("invalid model shape")
                valid &= np.isfinite(states).all(1)
                safe_states = np.where(np.isfinite(states), states, 0.0)
                step_cost = np.asarray(self.cost(safe_states), dtype=float)
                if step_cost.shape != (self.rollouts,):
                    raise ValueError("invalid cost shape")
                valid &= np.isfinite(step_cost)
                costs += self.discount**t * np.where(
                    np.isfinite(step_cost), step_cost, 0
                )
                if self.constraint is not None:
                    valid &= np.all(
                        safe_states
                        >= self.constraint.lower - self.constraint.tolerance,
                        axis=1,
                    )
                    valid &= np.all(
                        safe_states
                        <= self.constraint.upper + self.constraint.tolerance,
                        axis=1,
                    )
                states = safe_states
            if aborted:
                break
            eligible = np.flatnonzero(valid)
            if not len(eligible):
                reason = "no_feasible_rollout"
                completed = iteration + 1
                continue
            elite = eligible[
                np.argsort(costs[eligible])[
                    : max(1, int(self.rollouts * self.elite_fraction))
                ]
            ]
            if costs[elite[0]] < best_cost:
                best_cost = float(costs[elite[0]])
                best = actions[elite[0]].copy()
            mean = actions[elite].mean(0)
            std = np.maximum(actions[elite].std(0), 0.05)
            completed = iteration + 1
        if best is None:
            action = np.zeros(self.action_dim)
            self.warm_actions.fill(0)
        else:
            action = best[0].copy()
            self.warm_actions = np.vstack((best[1:], best[-1]))
        self.last_diagnostics = {
            "solver": "cem",
            "reason": reason,
            "feasible": best is not None,
            "model_calls": calls,
            "search_variables": self.horizon * self.action_dim,
            "iterations": completed,
            "latency_ms": (perf_counter() - start) * 1000,
            "fallback": None if best is not None else "no_verified_feasible_trajectory",
        }
        return Plan(
            action,
            None if best is None else best_cost,
            completed,
            completed * self.rollouts,
            self.last_diagnostics.copy(),
        )

    def state_dict(self):
        return {
            "warm_actions": self.warm_actions.copy(),
            "rng": self.rng.bit_generator.state,
        }

    def load_state_dict(self, state):
        if "warm_actions" in state:
            actions = np.asarray(state["warm_actions"], dtype=float)
            if actions.shape != self.warm_actions.shape:
                raise ValueError("invalid CEM checkpoint shape")
            self.warm_actions = actions.copy()
        self.rng.bit_generator.state = state["rng"]


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

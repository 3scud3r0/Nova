"""Action-space energy optimization with exact dynamics derivatives and budgets."""

from __future__ import annotations
from dataclasses import dataclass
from time import perf_counter
import numpy as np
from . import Plan


class TemporalSheaf:
    """Matrix-free temporal coboundary: D_e z = R_left z_e - R_right z_(e+1).

    E=weight/2 ||Dz||², gradient=weight D.T Dz. Default restrictions are the
    identity; nontrivial restrictions must be supplied explicitly. A consistency
    penalty is not a replacement for learned dynamics or a safety certificate.
    """

    def __init__(self, dimension: int, weight: float = 0.0, left=None, right=None):
        if dimension < 1 or not np.isfinite(weight) or weight < 0:
            raise ValueError("invalid sheaf regularizer")
        self.dimension, self.weight = dimension, weight
        self.identity = left is None and right is None
        self.left = np.eye(dimension) if left is None else np.asarray(left, dtype=float)
        self.right = (
            np.eye(dimension) if right is None else np.asarray(right, dtype=float)
        )
        if self.left.shape != (dimension, dimension) or self.right.shape != (
            dimension,
            dimension,
        ):
            raise ValueError("restriction shape mismatch")

    def energy_gradient(self, states: np.ndarray) -> tuple[float, np.ndarray]:
        states = np.asarray(states, dtype=float)
        if states.ndim != 2 or states.shape[1] != self.dimension:
            raise ValueError("invalid trajectory shape")
        gradient = np.zeros_like(states)
        if len(states) < 2 or not self.weight:
            return 0.0, gradient
        if self.identity:
            error = states[:-1] - states[1:]
            gradient[:-1] += self.weight * error
            gradient[1:] -= self.weight * error
            return float(0.5 * self.weight * np.sum(error * error)), gradient
        error = states[:-1] @ self.left.T - states[1:] @ self.right.T
        gradient[:-1] += self.weight * error @ self.left
        gradient[1:] -= self.weight * error @ self.right
        return float(0.5 * self.weight * np.sum(error * error)), gradient


class BoxStateConstraint:
    """Soft squared violation plus an explicit hard feasibility predicate."""

    def __init__(self, lower, upper, penalty=100.0, tolerance=1e-8):
        self.lower = np.asarray(lower, dtype=float)
        self.upper = np.asarray(upper, dtype=float)
        if (
            not np.isfinite(self.lower).all()
            or not np.isfinite(self.upper).all()
            or self.lower.shape != self.upper.shape
            or np.any(self.lower > self.upper)
            or penalty < 0
            or tolerance < 0
        ):
            raise ValueError("invalid state bounds")
        self.penalty, self.tolerance = penalty, tolerance

    def energy_gradient(self, states):
        low = np.minimum(states - self.lower, 0)
        high = np.maximum(states - self.upper, 0)
        return float(
            self.penalty * np.sum(low * low + high * high)
        ), 2 * self.penalty * (low + high)

    def feasible(self, states):
        return bool(
            np.all(states >= self.lower - self.tolerance)
            and np.all(states <= self.upper + self.tolerance)
        )


@dataclass(frozen=True)
class EnergyPlannerConfig:
    horizon: int = 12
    iterations: int = 20
    learning_rate: float = 0.3
    discount: float = 0.99
    action_penalty: float = 0.001
    slew_penalty: float = 0.01
    sheaf_weight: float = 0.0
    max_model_calls: int = 4096
    line_search_steps: int = 8
    gradient_tolerance: float = 1e-5

    def __post_init__(self):
        if (
            min(self.horizon, self.iterations, self.line_search_steps) < 1
            or self.max_model_calls < self.horizon
        ):
            raise ValueError("insufficient solver budget")
        if (
            not 0 < self.discount <= 1
            or self.learning_rate <= 0
            or self.gradient_tolerance <= 0
        ):
            raise ValueError("invalid solver scales")
        if any(
            not np.isfinite(x) or x < 0
            for x in (self.action_penalty, self.slew_penalty, self.sheaf_weight)
        ):
            raise ValueError("invalid energy weights")


class SolverBudgetExceeded(RuntimeError):
    pass


class EnergyPlanner:
    """Projected action descent through differentiable dynamics, with Armijo search.

    The search variables are H*action_dim, also for CEM. Increasing latent_dim
    increases model/Jacobian cost; it does not change that search dimension.
    Gradients use an explicit backward costate recursion, never torch.autograd.
    A model must supply predict(z,a) and linearize(z,a)->(next,F_z,F_a).
    Nonconvex trajectory optimization can stop at a local optimum.
    """

    def __init__(
        self,
        model,
        cost_gradient,
        action_dim: int,
        latent_dim: int,
        *,
        config: EnergyPlannerConfig | None = None,
        constraint=None,
    ):
        if min(action_dim, latent_dim) < 1:
            raise ValueError("invalid model dimensions")
        self.model, self.cost_gradient, self.action_dim = (
            model,
            cost_gradient,
            action_dim,
        )
        self.config = config or EnergyPlannerConfig()
        self.constraint = constraint
        self.sheaf = TemporalSheaf(latent_dim, self.config.sheaf_weight)
        self.rng = np.random.default_rng(
            0
        )  # common checkpoint interface; solver itself is deterministic
        self.warm_actions = np.zeros((self.config.horizon, action_dim))
        self.previous_action = np.zeros(action_dim)
        self.model_calls = 0
        self._deadline = None
        self.last_diagnostics = {}

    def _consume(self):
        if self.model_calls >= self.config.max_model_calls:
            raise SolverBudgetExceeded("model_call_budget")
        if self._deadline is not None and perf_counter() >= self._deadline:
            raise SolverBudgetExceeded("deadline")
        self.model_calls += 1

    def _rollout(self, z, actions, derivatives=False):
        states = []
        fz = []
        fa = []
        current = np.asarray(z, dtype=float)[None]
        for action in actions:
            self._consume()
            if derivatives:
                current, jz, ja = self.model.linearize(current, action[None])
                fz.append(jz[0])
                fa.append(ja[0])
            else:
                current = self.model.predict(current, action[None])
            current = np.asarray(current, dtype=float)
            if (
                current.shape != (1, self.sheaf.dimension)
                or not np.isfinite(current).all()
            ):
                raise ValueError("nonfinite/invalid model rollout")
            states.append(current[0].copy())
        return np.stack(states), fz, fa

    def _objective(self, states, actions):
        c = self.config
        cost, gradient = self.cost_gradient(states)
        cost = np.asarray(cost, dtype=float)
        gradient = np.asarray(gradient, dtype=float)
        if (
            cost.shape != (len(states),)
            or gradient.shape != states.shape
            or not np.isfinite(cost).all()
            or not np.isfinite(gradient).all()
        ):
            raise ValueError("cost_gradient returned invalid values")
        discount = c.discount ** np.arange(len(states))
        value = float(discount @ cost)
        gz = discount[:, None] * gradient
        sheaf_value, sheaf_gradient = self.sheaf.energy_gradient(states)
        value += sheaf_value
        gz += sheaf_gradient
        if self.constraint is not None:
            extra, grad = self.constraint.energy_gradient(states)
            value += extra
            gz += grad
        value += c.action_penalty * float(np.sum(actions * actions))
        ga = 2 * c.action_penalty * actions
        difference = actions - np.vstack((self.previous_action, actions[:-1]))
        value += c.slew_penalty * float(np.sum(difference * difference))
        ga += 2 * c.slew_penalty * difference
        ga[:-1] -= 2 * c.slew_penalty * difference[1:]
        return value, gz, ga

    def plan(self, z, budget_ms=None, initial_actions=None):
        z = np.asarray(z, dtype=float)
        if z.shape != (self.sheaf.dimension,) or not np.isfinite(z).all():
            raise ValueError("invalid initial state")
        if budget_ms is not None and (not np.isfinite(budget_ms) or budget_ms <= 0):
            raise ValueError("budget_ms must be positive")
        self.model_calls = 0
        start = perf_counter()
        self._deadline = None if budget_ms is None else start + budget_ms / 1000
        actions = (
            self.warm_actions.copy()
            if initial_actions is None
            else np.asarray(initial_actions, dtype=float).copy()
        )
        if actions.shape != self.warm_actions.shape or not np.isfinite(actions).all():
            raise ValueError("invalid initial action sequence")
        actions = np.clip(actions, -1, 1)
        best = None
        best_value = float("inf")
        completed = 0
        reason = "iterations"
        gradient_norm = None
        try:
            states, _, _ = self._rollout(z, actions)
            value, _, _ = self._objective(states, actions)
            if self.constraint is None or self.constraint.feasible(states):
                best = actions.copy()
                best_value = value
            for iteration in range(self.config.iterations):
                states, fz, fa = self._rollout(z, actions, derivatives=True)
                value, gz, grad = self._objective(states, actions)
                costate = np.zeros(len(z))
                for t in range(self.config.horizon - 1, -1, -1):
                    costate += gz[t]
                    grad[t] += fa[t].T @ costate
                    costate = fz[t].T @ costate
                # Projected stationarity, not raw gradient, handles active box constraints.
                projected = actions - np.clip(actions - grad, -1, 1)
                gradient_norm = float(np.linalg.norm(projected))
                if gradient_norm <= self.config.gradient_tolerance:
                    reason = "projected_stationary"
                    break
                accepted = False
                step = self.config.learning_rate
                for _ in range(self.config.line_search_steps):
                    candidate = np.clip(actions - step * grad, -1, 1)
                    trajectory, _, _ = self._rollout(z, candidate)
                    candidate_value, _, _ = self._objective(trajectory, candidate)
                    feasible = self.constraint is None or self.constraint.feasible(
                        trajectory
                    )
                    if feasible and candidate_value < best_value:
                        best = candidate.copy()
                        best_value = candidate_value
                    if candidate_value <= value + 1e-4 * float(
                        np.sum(grad * (candidate - actions))
                    ):
                        actions = candidate
                        accepted = True
                        break
                    step *= 0.5
                completed = iteration + 1
                if not accepted:
                    reason = "line_search_stalled"
                    break
        except SolverBudgetExceeded as error:
            reason = str(error)
        feasible = best is not None
        if feasible:
            action = best[0].copy()
            self.warm_actions = np.vstack((best[1:], best[-1]))
        else:
            # This is a stop command, NOT a claim that zero is safe in every world.
            action = np.zeros(self.action_dim)
            self.warm_actions.fill(0)
        self.previous_action = action.copy()
        self.last_diagnostics = {
            "solver": "energy",
            "reason": reason,
            "feasible": feasible,
            "model_calls": self.model_calls,
            "search_variables": self.config.horizon * self.action_dim,
            "iterations": completed,
            "projected_gradient_norm": gradient_norm,
            "latency_ms": (perf_counter() - start) * 1000,
            "fallback": None if feasible else "no_verified_feasible_trajectory",
        }
        return Plan(
            action,
            float(best_value) if feasible else None,
            completed,
            0,
            self.last_diagnostics.copy(),
        )

    def state_dict(self):
        return {
            "warm_actions": self.warm_actions.copy(),
            "previous_action": self.previous_action.copy(),
            "rng": self.rng.bit_generator.state,
        }

    def load_state_dict(self, state):
        warm = np.asarray(state["warm_actions"], dtype=float)
        previous = np.asarray(state["previous_action"], dtype=float)
        if (
            warm.shape != self.warm_actions.shape
            or previous.shape != self.previous_action.shape
        ):
            raise ValueError("planner checkpoint dimension mismatch")
        self.warm_actions = warm.copy()
        self.previous_action = previous.copy()
        self.rng.bit_generator.state = state["rng"]

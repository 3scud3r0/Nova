"""Unrun action optimization, sheaf and failure-budget regression specifications."""

import numpy as np
from nova.planning.energy import (
    EnergyPlanner,
    EnergyPlannerConfig,
    TemporalSheaf,
    BoxStateConstraint,
)


class Point:
    def predict(self, z, a):
        return z + 0.2 * a

    def linearize(self, z, a):
        return (
            self.predict(z, a),
            np.broadcast_to(np.eye(1), (len(z), 1, 1)),
            np.broadcast_to(np.eye(1) * 0.2, (len(z), 1, 1)),
        )


def test_action_descent_and_budget():
    config = EnergyPlannerConfig(
        horizon=6, iterations=20, max_model_calls=300, action_penalty=0, slew_penalty=0
    )
    planner = EnergyPlanner(
        Point(), lambda z: ((z * z).sum(1), 2 * z), 1, 1, config=config
    )
    result = planner.plan(np.array([1.0]))
    assert result.action[0] < 0 and result.diagnostics["feasible"]
    assert result.cost < 6 and result.diagnostics["model_calls"] <= 300


def test_sheaf_gradient_and_explicit_infeasibility():
    sheaf = TemporalSheaf(2, 0.3)
    x = np.arange(6, dtype=float).reshape(3, 2) / 10
    value, grad = sheaf.energy_gradient(x)
    eps = 1e-6
    for i in range(3):
        for j in range(2):
            delta = np.zeros_like(x)
            delta[i, j] = eps
            reference = (
                sheaf.energy_gradient(x + delta)[0]
                - sheaf.energy_gradient(x - delta)[0]
            ) / (2 * eps)
            assert abs(grad[i, j] - reference) < 1e-7
    planner = EnergyPlanner(
        Point(),
        lambda z: ((z * z).sum(1), 2 * z),
        1,
        1,
        constraint=BoxStateConstraint([10.0], [11.0]),
    )
    plan = planner.plan(np.array([0.0]))
    assert plan.cost is None and not plan.diagnostics["feasible"]

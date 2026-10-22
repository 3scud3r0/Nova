"""Latent dimension vs. action-space search: CEM and adjoint energy planning."""

from time import perf_counter
import numpy as np
from nova.planning import LatentPlanner
from nova.planning.energy import EnergyPlanner, EnergyPlannerConfig
from experiments.common import write_report


class LinearDynamics:
    def __init__(self, dimension, seed):
        rng = np.random.default_rng(seed)
        self.dimension = dimension
        self.decay = np.linspace(0.85, 0.95, dimension)
        self.B = rng.normal(0, 0.2 / np.sqrt(dimension), (dimension, 2))

    def predict(self, z, a):
        return z * self.decay + a @ self.B.T

    def linearize(self, z, a):
        return (
            self.predict(z, a),
            np.broadcast_to(
                np.diag(self.decay), (len(z), self.dimension, self.dimension)
            ),
            np.broadcast_to(self.B, (len(z), self.dimension, 2)),
        )


def main():
    rows = []
    for seed in range(5):
        for dimension in (8, 32, 64, 128):
            model = LinearDynamics(dimension, seed)
            z = np.array([1.0, -1.0]) @ model.B.T
            for horizon in (6, 12):
                for solver in ("cem", "energy", "energy_sheaf"):
                    cost = lambda state: np.sum(state * state, axis=-1)
                    if solver == "cem":
                        planner = LatentPlanner(
                            model.predict, cost, 2, horizon, 128, 4, seed=seed
                        )
                    else:
                        config = EnergyPlannerConfig(
                            horizon=horizon,
                            iterations=20,
                            max_model_calls=horizon * 128 * 4,
                            action_penalty=0.0,
                            slew_penalty=0.0,
                            sheaf_weight=0.01 if solver == "energy_sheaf" else 0.0,
                        )
                        planner = EnergyPlanner(
                            model,
                            lambda state: (cost(state), 2 * state),
                            2,
                            dimension,
                            config=config,
                        )
                    start = perf_counter()
                    plan = planner.plan(z)
                    elapsed = (perf_counter() - start) * 1000
                    actions = np.vstack((plan.action, planner.warm_actions[:-1]))
                    state = z.copy()
                    environment_cost = 0.0
                    for action in actions:
                        state = model.predict(state, action)
                        environment_cost += float(cost(state))
                    rows.append(
                        dict(
                            seed=seed,
                            solver=solver,
                            latent_dim=dimension,
                            horizon=horizon,
                            search_variables=2 * horizon,
                            environment_cost=environment_cost,
                            solver_objective=plan.cost,
                            transition_evaluations=plan.diagnostics["model_calls"],
                            feasible=plan.diagnostics["feasible"],
                            latency_ms=elapsed,
                            iterations=plan.iterations,
                        )
                    )
    write_report(
        12,
        rows,
        "Cinco sementes; D=8/32/64/128, horizontes 6/12, ação bidimensional, CEM vs energia e ablação de feixe temporal.",
        "O custo de ambiente é recomputado sem o regularizador de feixe. Modelos lineares conhecidos isolam o escalonamento do solver; não demonstram generalização em cenas multimodais. Espaço de busca=H×action_dim em todos os métodos; contagens são avaliações de transição, não equivalência de FLOPs.",
    )


if __name__ == "__main__":
    main()

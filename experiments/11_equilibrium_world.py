"""Held-out EqProp world prediction and implicit-gradient audit, unrun by default."""

import argparse
import numpy as np
from nova.jepa.equilibrium import EquilibriumWorldModel, EquilibriumNetwork
from nova.environments import point_transitions
from experiments.common import write_report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=400)
    parser.add_argument("--train-encoder", action="store_true")
    args = parser.parse_args()
    if args.steps < 1:
        parser.error("steps must be positive")
    rows = []
    for seed in range(5):
        rng = np.random.default_rng(seed)
        x, a, y, _ = point_transitions(seed=seed)
        tx, ta, ty, _ = point_transitions(512, seed + 500)
        model = EquilibriumWorldModel(12, 8, 2, seed=seed)
        model.fit_normalizer(x)
        updates = 0
        for _ in range(args.steps):
            idx = rng.integers(len(x), size=32)
            result = model.learn_transition(
                x[idx], a[idx], y[idx], lr=0.01, train_encoder=args.train_encoder
            )
            updates += result["updated"]
        model.freeze_encoder()
        z = model.encode(tx)
        target = model.target.predict(model._normalize(ty))
        prediction = model.predict(z, ta)
        train_target = model.target.predict(model._normalize(y))
        std = float(z.std(0).mean())
        mse = float(np.mean((prediction - target) ** 2))
        baseline = float(np.mean((target - train_target.mean(0)) ** 2))
        # Analytic implicit reference, not autograd and not a finite-difference target.
        network = EquilibriumNetwork(3, 2, seed=seed)
        u = rng.normal(size=(8, 3))
        desired = rng.normal(0, 0.2, (8, 2))
        free = network.relax(u)
        reference = []
        for state, target_value in zip(free.state, desired):
            force = np.zeros(len(state))
            force[-2:] = state[-2:] - target_value
            hessian = np.diag(1 / (1 - state * state)) - network.W
            reference.append(np.linalg.solve(hessian, force) @ network.B.T)
        result = network.learn(u, desired, lr=0.0)
        reference = np.asarray(reference)
        estimate = result["input_gradient"]
        cosine = float(
            np.sum(reference * estimate)
            / max(np.linalg.norm(reference) * np.linalg.norm(estimate), 1e-12)
        )
        rows.append(
            dict(
                seed=seed,
                steps=args.steps,
                encoder_trained=args.train_encoder,
                updates=updates,
                latent_mse=mse,
                mean_baseline_mse=baseline,
                latent_std=std,
                eqprop_input_gradient_cosine=cosine,
                noncollapsed=std >= 0.05,
                prediction_better_than_mean=mse < baseline,
            )
        )
    write_report(
        11,
        rows,
        "EqProp não linear com alvo EMA, erro held-out sob distratores e referência implícita de gradiente; cinco sementes.",
        "Falhas em previsão, convergência ou anti-colapso devem permanecer no relatório. Evitar autograd não prova menor custo/energia nem valida o circuito AdEx. O modo --train-encoder é exclusivamente offline, antes de proteger coordenadas.",
    )


if __name__ == "__main__":
    main()

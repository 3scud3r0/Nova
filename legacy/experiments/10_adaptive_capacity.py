"""Predeclared saturation/revisit experiment. Not executed during this revision."""

import argparse
import numpy as np
from nova.continual import ProtectedLinear, AdaptiveSubspaceLinear, AdaptiveConfig
from experiments.common import write_report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tasks", type=int, default=12)
    parser.add_argument("--steps", type=int, default=200)
    args = parser.parse_args()
    if args.tasks < 1 or args.steps < 1:
        parser.error("tasks and steps must be positive")
    rows = []
    for seed in range(5):
        rng = np.random.default_rng(seed)
        tasks = []
        for _ in range(args.tasks):
            q = np.linalg.qr(rng.normal(size=(16, 16)))[0]
            x = rng.normal(size=(64, 8)) @ q[:, :8].T
            tasks.append((x, x @ rng.normal(size=(16, 4))))
        for policy in ("baseline", "strict", "relax", "expand", "hybrid"):
            model = (
                ProtectedLinear(16, 4, seed=seed)
                if policy == "baseline"
                else AdaptiveSubspaceLinear(
                    16,
                    4,
                    seed=seed,
                    config=AdaptiveConfig(
                        policy=policy, max_features=64, growth_step=8
                    ),
                )
            )
            historical = []
            for task, (x, y) in enumerate(tasks):
                version = 0 if policy == "baseline" else model.feature_version
                encode = lambda values, v: (
                    values if policy == "baseline" else model.encode(values, v)
                )
                features = encode(x, version)
                for _ in range(args.steps):
                    model.step(features, y, 0.05)
                reference = model(features).copy()
                historical.append((x, y, version, reference))
                if policy == "baseline":
                    model.consolidate(features)
                else:
                    # First task is an explicit anchor; later capacity must respect it.
                    model.consolidate(features, anchor=task == 0)
                    model.age(20.0, consolidation=0.1)
                    model.manage_capacity()
                stored_errors = [
                    float(np.mean((model(encode(px, pv)) - py) ** 2))
                    for px, py, pv, _ in historical
                ]
                retention = [
                    model.retention_error(encode(px, pv), ref)
                    for px, _, pv, ref in historical
                ]
                # This separate evaluation deliberately does NOT promise old-version mapping.
                current_errors = [
                    float(
                        np.mean(
                            (
                                model(
                                    encode(
                                        px,
                                        model.feature_version
                                        if policy != "baseline"
                                        else 0,
                                    )
                                )
                                - py
                            )
                            ** 2
                        )
                    )
                    for px, py, _, _ in historical
                ]
                metrics = {} if policy == "baseline" else model.capacity_metrics()
                rows.append(
                    dict(
                        seed=seed,
                        policy=policy,
                        task=task,
                        new_task_mse=stored_errors[-1],
                        mean_revisit_mse=float(np.mean(stored_errors)),
                        reencoded_mse=float(np.mean(current_errors)),
                        anchor_retention=retention[0],
                        max_retention_change=max(retention),
                        free_dims=model.free_dims,
                        width=model.in_features,
                        feature_version=version,
                        released_total=metrics.get("released_total", 0),
                    )
                )
    write_report(
        10,
        rows,
        "Cinco sementes; tarefas lineares conflitantes, primeira tarefa ancorada; baseline exato e quatro políticas adaptativas.",
        "Versões armazenadas e re-encoding atual são avaliados separadamente. Liberação pode esquecer; expansão tem teto de largura/bytes. Não existe capacidade infinita. Este script gera dados somente quando executado explicitamente.",
    )


if __name__ == "__main__":
    main()

from time import perf_counter
import numpy as np
from scipy.special import softmax
from nova.reasoning import (
    grid_search,
    TemperatureCalibrator,
    expected_calibration_error,
)
from nova.runtime import CognitiveRuntime, RuntimeConfig
from experiments.common import write_report


def main():
    rows = []
    for seed in range(5):
        rng = np.random.default_rng(seed)
        grids = []
        for _ in range(20):
            grid = rng.uniform(size=(12, 12)) < 0.2
            grid[0, :] = False
            grid[:, -1] = False
            grids.append(grid)
        for budget in (1, 32, 128, 256):
            start = perf_counter()
            solved = sum(
                grid_search(g, (0, 0), (11, 11), budget).verified for g in grids
            )
            rows.append(
                dict(
                    seed=seed,
                    condition="search",
                    budget=budget,
                    success=solved / len(grids),
                    seconds=perf_counter() - start,
                )
            )
        true_logits = rng.normal(size=(4000, 3))
        prob = softmax(true_logits, axis=1)
        labels = np.array([rng.choice(3, p=p) for p in prob])
        logits = true_logits * 3
        cal = TemperatureCalibrator().fit(logits[:2000], labels[:2000])
        before = expected_calibration_error(
            softmax(logits[2000:], axis=1), labels[2000:]
        )
        after = expected_calibration_error(cal.predict(logits[2000:]), labels[2000:])
        runtime = CognitiveRuntime(RuntimeConfig(seed=seed))
        for _ in range(100):
            runtime.tick()
        latencies = [m["latency_ms"] for m in runtime.metrics]
        rows.append(
            dict(
                seed=seed,
                condition="calibration_idle",
                ece_before=before,
                ece_after=after,
                temperature=cal.temperature,
                idle_latent_norm=float(np.linalg.norm(runtime.z)),
                tick_p95_ms=float(np.quantile(latencies, 0.95)),
            )
        )
    write_report(
        8,
        rows,
        "Busca BFS com verificador exato em 20 grids/seed; quatro orçamentos. Calibração por temperatura em partição separada e avaliação held-out. Ciclo ocioso e checkpoint determinístico testados.",
        "Mais expansões melhoram sucesso neste domínio finito, não provam raciocínio geral. O runtime integrado é um demonstrador com encoder inicial aleatório, a substituir por pesos treinados. Busca/neuromodulação opt-in. Latência é medida, não uma garantia de tempo real. Curiosidade ignora erro estacionário; ablações comportamentais amplas permanecem abertas.",
    )


if __name__ == "__main__":
    main()

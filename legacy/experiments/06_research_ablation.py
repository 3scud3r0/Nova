import numpy as np
import torch
from nova.research import (
    PhaseOscillatorLayer,
    QuadraticEquilibriumPropagation,
    SheafCoherence,
)
from experiments.common import write_report


def main():
    rows = []
    for seed in range(5):
        on = PhaseOscillatorLayer(seed=seed)
        off = PhaseOscillatorLayer(seed=seed, coupling=0)
        for _ in range(1000):
            on.step()
            off.step()
        rng = np.random.default_rng(seed)
        eq = QuadraticEquilibriumPropagation(seed=seed)
        x = rng.normal(size=3)
        y = rng.normal(size=2)
        estimate = eq.gradient(x, y)
        b = torch.tensor(eq.B, requires_grad=True)
        state = torch.linalg.solve(torch.tensor(eq.A), b @ torch.tensor(x))
        loss = 0.5 * (torch.tensor(eq.P) @ state - torch.tensor(y)).square().sum()
        loss.backward()
        grad = b.grad.numpy()
        cosine = float(
            np.sum(grad * estimate) / np.linalg.norm(grad) / np.linalg.norm(estimate)
        )
        sheaf = SheafCoherence(4, 2, [(0, 1), (1, 2), (2, 3)])
        v = rng.normal(size=(4, 2))
        rows.append(
            dict(
                seed=seed,
                order_coupled=on.order,
                order_uncoupled=off.order,
                eqprop_gradient_cosine=cosine,
                coherence_before=sheaf.energy(v),
                coherence_after=sheaf.energy(sheaf.diffuse(v)),
            )
        )
    write_report(
        6,
        rows,
        "Kuramoto acoplado vs não acoplado; EqProp quadrático vs gradiente implícito PyTorch; difusão de feixe vs ausência de difusão.",
        "Verificações matemáticas passaram, mas não demonstram vantagem em tarefa cognitiva. Os três módulos são opt-in experimentais; não promovidos ao runtime padrão. EqProp quadrático não equivale a validação de uma rede não linear profunda.",
    )
    assert all(r["eqprop_gradient_cosine"] > 0.9 for r in rows)


if __name__ == "__main__":
    main()

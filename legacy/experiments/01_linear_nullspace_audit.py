"""Run: python -m experiments.01_linear_nullspace_audit."""

import numpy as np
from copy import deepcopy
from nova.continual import ProtectedLinear
from experiments.common import write_report


def main():
    rows = []
    for seed in range(5):
        rng = np.random.default_rng(seed)
        for rank in (4, 8, 16, 32):
            for alpha in (0, 0.25, 0.5, 0.75, 1):
                q, _ = np.linalg.qr(rng.normal(size=(32, 32)))
                xa = rng.normal(size=(64, rank)) @ q[:, :rank].T
                shared = round(alpha * rank)
                fresh = min(rank - shared, 32 - rank)
                basis = np.concatenate(
                    (q[:, :shared], q[:, rank : rank + fresh]), axis=1
                )
                xb = rng.normal(size=(64, basis.shape[1])) @ basis.T
                ya, yb = xa @ rng.normal(size=(32, 3)), xb @ rng.normal(size=(32, 3))
                model = ProtectedLinear(32, 3, seed=seed)
                for _ in range(150):
                    model.step(xa, ya, 0.08)
                naive = deepcopy(model)
                isolated = ProtectedLinear(32, 3, seed=seed)
                model.consolidate(xa)
                before, loss_before = model(xa), np.mean((model(xb) - yb) ** 2)
                for _ in range(150):
                    model.step(xb, yb, 0.08)
                    naive.step(xb, yb, 0.08)
                    isolated.step(xb, yb, 0.08)
                eps = model.retention_error(xa, before)
                assert eps < 1e-10
                rows.append(
                    dict(
                        seed=seed,
                        rank=rank,
                        alpha=alpha,
                        actual_new_dims=fresh,
                        eps_ret=eps,
                        eps_ortho=model.eps_ortho,
                        eps_update=model.eps_update,
                        free_dims=model.free_dims,
                        naive_ret=naive.retention_error(xa, before),
                        isolated_mse=np.mean((isolated(xb) - yb) ** 2),
                        mse_before=loss_before,
                        mse_after=np.mean((model(xb) - yb) ** 2),
                    )
                )
    write_report(
        1,
        rows,
        "Auditoria float64: 5 sementes × 4 ranks × 5 sobreposições. Retenção < 1e-10 em todas as condições.",
        "Saturação: rank=32 não deixa direções livres. Para rank alto, a geometria limita novas direções; actual_new_dims registra esse limite. eps_ortho do resíduo total não é necessariamente zero; a garantia vale para a atualização após consolidação. Testes demonstram falhas por quantização, truncamento e drift.",
    )


if __name__ == "__main__":
    main()

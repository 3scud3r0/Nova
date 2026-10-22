"""JEPA vs. future-mean and pixel autoencoder under independent distractors."""

import torch
from torch import nn
from nova.jepa import JEPA, ContextEncoder
from nova.environments import point_transitions
from experiments.common import write_report


def main():
    torch.set_num_threads(2)
    rows = []
    for seed in range(5):
        torch.manual_seed(seed)
        x, a, y, state = map(torch.from_numpy, point_transitions(seed=seed))
        tx, ta, ty, ts = map(torch.from_numpy, point_transitions(1024, 100 + seed))
        model = JEPA(12, 8, 2)
        optimizer = torch.optim.Adam(model.parameters(), lr=0.002)
        ae = nn.Sequential(
            ContextEncoder(12, 8), nn.Linear(8, 64), nn.SiLU(), nn.Linear(64, 12)
        )
        ae_opt = torch.optim.Adam(ae.parameters(), lr=0.002)
        for _ in range(900):
            idx = torch.randint(len(x), (128,))
            loss, _ = model.loss(x[idx], a[idx], y[idx])
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            model.target.update(model.context)
            loss_ae = (ae(x[idx]) - x[idx]).square().mean()
            ae_opt.zero_grad()
            loss_ae.backward()
            ae_opt.step()
        with torch.no_grad():
            z = model.context(tx)
            target = model.target(ty)
            mse = (model.predictor(z, ta) - target).square().mean().item()
            mean_mse = (target - model.target(y).mean(0)).square().mean().item()
            altered = tx.clone()
            altered[:, 4:] = torch.randn_like(altered[:, 4:])
            sensitivity = (model.context(altered) - z).square().mean().item()
            ae_sensitivity = (ae[0](altered) - ae[0](tx)).square().mean().item()
            train_z = torch.cat((model.context(x), torch.ones(len(x), 1)), 1)
            probe = torch.linalg.lstsq(train_z, state).solution
            state_mse = (
                (torch.cat((z, torch.ones(len(z), 1)), 1) @ probe - ts)
                .square()
                .mean()
                .item()
            )
            std = model.assert_noncollapsed(tx)
        rows.append(
            dict(
                seed=seed,
                latent_mse=mse,
                mean_baseline_mse=mean_mse,
                latent_std=std,
                distractor_sensitivity=sensitivity,
                autoencoder_sensitivity=ae_sensitivity,
                position_probe_mse=state_mse,
            )
        )
    write_report(
        2,
        rows,
        "Predição linear com oito distratores independentes; 900 passos, 5 sementes, teste independente.",
        "Aceite de bancada: std ≥ 0.05 e erro menor que média. Autoencoder usa reconstrução, portanto a sensibilidade é uma comparação de representações, não igualdade de objetivos. Pêndulo e grid têm testes funcionais; extrapolação JEPA nesses ambientes exige ensaios próprios.",
    )
    assert all(
        r["latent_mse"] < r["mean_baseline_mse"] and r["latent_std"] >= 0.05
        for r in rows
    )


if __name__ == "__main__":
    main()

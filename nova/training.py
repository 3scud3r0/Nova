"""Small offline world-model training; freeze coordinates before online protection."""

from pathlib import Path
import numpy as np
import torch
from nova.jepa import JEPA
from nova.environments import point_transitions


def train_world(output, steps=900, seed=0):
    if steps < 1:
        raise ValueError("steps must be positive")
    torch.manual_seed(seed)
    torch.set_num_threads(2)
    x, a, y, _ = map(torch.from_numpy, point_transitions(seed=seed))
    model = JEPA(12, 8, 2)
    opt = torch.optim.Adam(model.parameters(), lr=0.002)
    for _ in range(steps):
        idx = torch.randint(len(x), (128,))
        loss, metrics = model.loss(x[idx], a[idx], y[idx])
        opt.zero_grad()
        loss.backward()
        opt.step()
        model.target.update(model.context)
    tx, ta, ty, _ = map(torch.from_numpy, point_transitions(1024, seed + 1000))
    with torch.no_grad():
        target = model.target(ty)
        mse = (model.predictor(model.context(tx), ta) - target).square().mean().item()
        baseline = (target - model.target(y).mean(0)).square().mean().item()
        std = model.assert_noncollapsed(tx)
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as stream:
        np.savez_compressed(
            stream, **{k: v.detach().numpy() for k, v in model.state_dict().items()}
        )
    return {
        "latent_mse": mse,
        "mean_baseline_mse": baseline,
        "latent_std": std,
        "steps": steps,
        "seed": seed,
        "accepted": mse < baseline,
    }


def load_world(runtime, path):
    if runtime.tick_index or runtime.continual.U.shape[1]:
        raise ValueError(
            "load encoder before online learning; changing coordinates invalidates protection"
        )
    with np.load(path, allow_pickle=False) as arrays:
        runtime.world.load_state_dict(
            {k: torch.from_numpy(arrays[k].copy()) for k in runtime.world.state_dict()}
        )
    runtime.world.context.requires_grad_(False)
    runtime.world.target.requires_grad_(False)

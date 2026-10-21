"""Offline world training with explicit PyTorch or NumPy/local-equilibrium backends."""

from pathlib import Path
import numpy as np
from nova.environments import point_transitions
from nova.checkpoint import save_state, load_state


def train_world(output, steps=900, seed=0, *, backend="torch", train_encoder=False):
    if steps < 1:
        raise ValueError("steps must be positive")
    if backend == "torch":
        return _train_torch(output, steps, seed)
    from nova.jepa.equilibrium import EquilibriumWorldModel
    from nova.brain.latent import SpikingWorldModel

    if backend not in ("equilibrium", "adex"):
        raise ValueError("unknown training backend")
    if backend == "adex" and train_encoder:
        raise ValueError(
            "AdEx encoder uses explicit STDP rather than rate-network EqProp"
        )
    rng = np.random.default_rng(seed)
    x, a, y, _ = point_transitions(seed=seed)
    model_class = SpikingWorldModel if backend == "adex" else EquilibriumWorldModel
    model = model_class(12, 8, 2, seed=seed)
    model.fit_normalizer(x)
    successful = 0
    last = {}
    for _ in range(steps):
        idx = rng.integers(len(x), size=32)
        last = model.learn_transition(
            x[idx], a[idx], y[idx], lr=0.01, train_encoder=train_encoder
        )
        successful += int(last["updated"])
    model.freeze_encoder()
    save_state(
        output, {"kind": "nova-world", "backend": backend, "state": model.state_dict()}
    )
    # Training summary only; scientific acceptance belongs to the explicit held-out runner.
    return {
        "backend": backend,
        "steps": steps,
        "updates": successful,
        "last_training_loss": last.get("loss"),
        "seed": seed,
        "checkpoint": str(output),
        "accepted": None,
        "evaluation": "not performed by training command",
    }


def _train_torch(output, steps, seed):
    import torch
    from nova.jepa import JEPA

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
    # Preserve the established training command's report protocol for this baseline.
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
        "backend": "torch",
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
    if runtime.config.world_backend == "torch":
        import torch

        with np.load(path, allow_pickle=False) as arrays:
            runtime.world.load_state_dict(
                {
                    k: torch.from_numpy(arrays[k].copy())
                    for k in runtime.world.state_dict()
                }
            )
        runtime.world.context.requires_grad_(False)
        runtime.world.target.requires_grad_(False)
    else:
        state = load_state(path)
        if (
            state.get("kind") != "nova-world"
            or state["backend"] != runtime.config.world_backend
        ):
            raise ValueError("world checkpoint/backend mismatch")
        from nova.jepa.equilibrium import EquilibriumWorldModel
        from nova.brain.latent import SpikingWorldModel

        cls = SpikingWorldModel if state["backend"] == "adex" else EquilibriumWorldModel
        model = cls.from_state_dict(state["state"])
        if (model.observation_dim, model.latent_dim, model.action_dim) != (
            runtime.config.observation_dim,
            runtime.config.latent_dim,
            runtime.config.action_dim,
        ):
            raise ValueError("world checkpoint dimensions do not match runtime")
        model.freeze_encoder()
        runtime.world = model

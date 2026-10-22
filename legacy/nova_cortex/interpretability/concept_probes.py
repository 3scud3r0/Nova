"""Held-out linear probes, CAVs and TCAV directional sensitivities."""

from dataclasses import dataclass
import numpy as np


@dataclass
class LinearProbe:
    weights: np.ndarray
    bias: float
    mean: np.ndarray
    scale: np.ndarray
    task: str = "regression"

    def predict(self, x):
        score = ((np.asarray(x) - self.mean) / self.scale) @ self.weights + self.bias
        return (score >= 0).astype(int) if self.task == "classification" else score

    def direction(self):
        value = self.weights / self.scale
        return value / max(np.linalg.norm(value), 1e-12)


def fit_probe(
    x_train, y_train, x_heldout, y_heldout, *, ridge=1e-3, classification=False
):
    x, y = np.asarray(x_train, float), np.asarray(y_train, float)
    held, labels = np.asarray(x_heldout, float), np.asarray(y_heldout, float)
    if (
        x.ndim != 2
        or held.ndim != 2
        or held.shape[1] != x.shape[1]
        or y.shape != (len(x),)
        or labels.shape != (len(held),)
        or len(x) < 8
        or len(held) < 8
        or x.shape[1] > 32768
        or x.size + held.size > 20_000_000
        or ridge <= 0
        or not all(np.isfinite(a).all() for a in (x, y, held, labels))
    ):
        raise ValueError("invalid separated probe samples")
    mean, scale = x.mean(0), x.std(0).clip(1e-6)
    centered = (x - mean) / scale
    bias = float(y.mean())
    target = y - bias
    # Dual ridge avoids a dictionary-width squared matrix for 16k SAE features.
    if len(x) <= x.shape[1]:
        if len(x) > 4096:
            raise ValueError("dual probe solver sample budget exceeded")
        weights = centered.T @ np.linalg.solve(
            centered @ centered.T + ridge * np.eye(len(x)), target
        )
    else:
        if x.shape[1] > 4096:
            raise ValueError("primal probe solver feature budget exceeded")
        weights = np.linalg.solve(
            centered.T @ centered + ridge * np.eye(x.shape[1]), centered.T @ target
        )
    probe = LinearProbe(weights, bias, mean, scale)
    prediction = probe.predict(held)
    residual = float(np.sum((prediction - labels) ** 2))
    total = float(np.sum((labels - labels.mean()) ** 2))
    evidence = dict(
        heldout_samples=len(held),
        heldout_r2=1 - residual / total if total > 0 else None,
        heldout_rmse=float(np.sqrt(residual / len(held))),
        scope="held-out association, not proof of a concept or causality",
    )
    if classification:
        if not set(np.unique(y)).issubset({0, 1}) or not set(
            np.unique(labels)
        ).issubset({0, 1}):
            raise ValueError("CAV classification requires binary labels")
        # Ridge least-squares classifier; threshold the continuous score at .5.
        probe.task = "classification"
        probe.bias -= 0.5
        evidence["heldout_accuracy"] = float(np.mean(probe.predict(held) == labels))
    return probe, evidence


def tcav(target, latent, cav):
    """target maps latent -> scalar per sample; measures sensitivity of this model."""
    import torch

    direction = torch.as_tensor(cav, dtype=latent.dtype, device=latent.device)
    if direction.shape != (latent.shape[-1],) or not torch.isfinite(direction).all():
        raise ValueError("invalid CAV")
    direction = direction / direction.norm().clamp_min(1e-8)
    with torch.enable_grad():
        values = latent.detach().requires_grad_(True)
        scores = target(values)
        gradient = torch.autograd.grad(scores.sum(), values)[0]
        derivative = gradient @ direction
    return dict(
        positive_fraction=float((derivative > 0).float().mean()),
        mean_directional_derivative=float(derivative.mean()),
        samples=len(latent),
        scope="directional model sensitivity; significance requires controls",
    )


def controlled_tcav(target, latent, cav, *, controls=32, seed=42):
    if not 8 <= controls <= 256:
        raise ValueError("invalid TCAV control count")
    rng = np.random.default_rng(seed)
    observed = tcav(target, latent, cav)
    scores = [
        tcav(target, latent, rng.normal(size=latent.shape[-1]))["positive_fraction"]
        for _ in range(controls)
    ]
    observed["random_direction_scores"] = scores
    observed["empirical_upper_tail"] = (
        1 + sum(x >= observed["positive_fraction"] for x in scores)
    ) / (controls + 1)
    return observed

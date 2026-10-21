"""Continual-learning baselines and explicit representation-drift measurement."""

from __future__ import annotations
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from .protected import ProtectedLinear


class MLP(nn.Module):
    def __init__(self, inputs=784, hidden=128, outputs=10):
        super().__init__()
        self.first = nn.Linear(inputs, hidden)
        self.last = nn.Linear(hidden, outputs)

    def features(self, x):
        return F.relu(self.first(x))

    def forward(self, x):
        return self.last(self.features(x))


class OnlineEWC:
    """Diagonal empirical Fisher from per-example gradients, accumulated per task."""

    def __init__(self, model, strength=20.0):
        self.strength = strength
        self.anchor = {n: p.detach().clone() for n, p in model.named_parameters()}
        self.fisher = {n: torch.zeros_like(p) for n, p in model.named_parameters()}

    def penalty(self, model):
        return (
            self.strength
            * 0.5
            * sum(
                (self.fisher[n] * (p - self.anchor[n]).square()).sum()
                for n, p in model.named_parameters()
            )
        )

    def consolidate(self, model, x, y):
        estimate = {n: torch.zeros_like(p) for n, p in model.named_parameters()}
        for xi, yi in zip(x, y):
            model.zero_grad()
            F.cross_entropy(model(xi[None]), yi[None]).backward()
            for n, p in model.named_parameters():
                estimate[n] += p.grad.detach().square() / len(x)
        for n, p in model.named_parameters():
            self.fisher[n] += estimate[n]
            self.anchor[n] = p.detach().clone()
        model.zero_grad()


class LayerwiseGPM:
    """Gradient projection on actual affine-layer inputs (bias coordinate included).

    Uses 95% activation energy by default; this is approximate retention and
    explicitly differs from the full-span float64 ProtectedLinear guarantee.
    """

    def __init__(self, model, energy=0.95):
        self.bases = [None, None]
        self.energy = energy

    @torch.no_grad()
    def consolidate(self, model, x):
        for i, activation in enumerate((x, model.features(x))):
            a = torch.cat((activation, torch.ones(len(x), 1)), 1).double().T
            old = self.bases[i]
            if old is not None:
                a -= old @ (old.T @ a)
            u, s, _ = torch.linalg.svd(a, full_matrices=False)
            if float(s.sum()) == 0:
                continue
            rank = (
                int(
                    torch.searchsorted(
                        s.square().cumsum(0) / s.square().sum(), self.energy
                    )
                )
                + 1
            )
            new = u[:, :rank]
            basis = new if old is None else torch.cat((old, new), 1)
            self.bases[i] = torch.linalg.qr(basis, mode="reduced")[0][:, : a.shape[0]]

    @torch.no_grad()
    def project(self, model):
        for layer, basis in zip((model.first, model.last), self.bases):
            if basis is None:
                continue
            grad = torch.cat((layer.weight.grad, layer.bias.grad[:, None]), 1).double()
            grad -= (grad @ basis) @ basis.T
            layer.weight.grad.copy_(grad[:, :-1])
            layer.bias.grad.copy_(grad[:, -1])


class FrozenProtectedClassifier:
    """Freeze the learned lower layer, transfer its head into continuous dW."""

    def __init__(self, model: MLP):
        self.encoder = model.first.requires_grad_(False)
        self.head = ProtectedLinear(model.last.in_features + 1, model.last.out_features)
        weights = (
            torch.cat((model.last.weight.T, model.last.bias[None]), 0).detach().numpy()
        )
        self.head.dW[:] = weights - self.head.W_base

    def features(self, x):
        with torch.no_grad():
            z = F.relu(self.encoder(x)).numpy().astype("float64")
        return np.c_[z, np.ones(len(z))]

    def logits(self, x):
        return self.head(self.features(x))

    def train_batch(self, x, y, lr=0.08):
        z = self.features(x)
        logits = self.head(z)
        exp = np.exp(logits - logits.max(1, keepdims=True))
        prob = exp / exp.sum(1, keepdims=True)
        prob[np.arange(len(y)), y.numpy()] -= 1
        grad = z.T @ prob / len(z)
        grad -= self.head.U @ (self.head.U.T @ grad)
        self.head.last_update = -lr * grad
        self.head.dW += self.head.last_update


def continual_metrics(accuracy, initial, isolated):
    """Rows = after task, columns = evaluation task; no task oracle at inference."""
    a = np.asarray(accuracy)
    n = len(a)
    return dict(
        acc=float(a[-1].mean()),
        fm=float(np.mean([a[j:-1, j].max() - a[-1, j] for j in range(n - 1)])),
        fwt=float(np.mean([a[j - 1, j] - initial[j] for j in range(1, n)])),
        plasticity=float(np.mean(np.diag(a) - isolated)),
    )

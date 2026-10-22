import numpy as np
import torch
from nova.research import (
    PhaseOscillatorLayer,
    QuadraticEquilibriumPropagation,
    SheafCoherence,
)
from nova.core import available


def test_oscillator_coupling_and_native_parity():
    coupled = PhaseOscillatorLayer(seed=1)
    off = PhaseOscillatorLayer(coupling=0, seed=1)
    if available():
        native = PhaseOscillatorLayer(seed=1, backend="rust")
        np.testing.assert_allclose(coupled.step(), native.step(), atol=1e-12)
    for _ in range(1000):
        coupled.step()
        off.step()
    assert coupled.order > 0.95 and coupled.order > off.order


def test_equilibrium_gradient():
    model = QuadraticEquilibriumPropagation()
    x = np.array([0.5, -1.0, 0.2])
    y = np.array([0.2, 0.7])
    estimate = model.gradient(x, y)
    b = torch.tensor(model.B, requires_grad=True)
    state = torch.linalg.solve(torch.tensor(model.A), b @ torch.tensor(x))
    loss = 0.5 * (torch.tensor(model.P) @ state - torch.tensor(y)).square().sum()
    loss.backward()
    cosine = np.dot(estimate.ravel(), b.grad.numpy().ravel()) / (
        np.linalg.norm(estimate) * np.linalg.norm(b.grad.numpy())
    )
    assert cosine > 0.999
    assert min(model.last_iterations) > 0


def test_sheaf_diffusion():
    model = SheafCoherence(3, 2, [(0, 1), (1, 2)])
    x = np.arange(6).reshape(3, 2)
    assert model.energy(model.diffuse(x)) < model.energy(x)
    assert np.linalg.eigvalsh(model.L).min() > -1e-12

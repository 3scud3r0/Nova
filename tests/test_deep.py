import numpy as np
import torch
from nova.continual.deep import (
    MLP,
    FrozenProtectedClassifier,
    OnlineEWC,
    LayerwiseGPM,
)


def test_frozen_head_retention():
    torch.manual_seed(0)
    m = MLP(8, 12, 3)
    x = torch.randn(6, 8)
    y = torch.arange(6) % 3
    model = FrozenProtectedClassifier(m)
    np.testing.assert_allclose(model.logits(x), m(x).detach().numpy(), atol=1e-6)
    model.head.consolidate(model.features(x))
    before = model.logits(x)
    for _ in range(10):
        model.train_batch(torch.randn(6, 8), y)
    np.testing.assert_allclose(model.logits(x), before, atol=1e-10)


def test_ewc_fisher_and_gpm():
    m = MLP(8, 12, 3)
    x = torch.randn(10, 8)
    y = torch.arange(10) % 3
    e = OnlineEWC(m)
    e.consolidate(m, x, y)
    assert sum(v.sum() for v in e.fisher.values()) > 0
    with torch.no_grad():
        m.last.weight.add_(0.1)
    assert e.penalty(m) > 0
    g = LayerwiseGPM(m)
    g.consolidate(m, x)
    m(x).square().sum().backward()
    g.project(m)
    for layer, b in zip((m.first, m.last), g.bases):
        grad = torch.cat((layer.weight.grad, layer.bias.grad[:, None]), 1).double()
        assert torch.linalg.norm(grad @ b) < 1e-5


def test_forgetting_excludes_prelearning_accuracy():
    from nova.continual.deep import continual_metrics

    accuracy = np.array([[0.9, 0.9, 0.1], [0.8, 0.5, 0.1], [0.7, 0.4, 0.8]])
    result = continual_metrics(accuracy, [0.1, 0.1, 0.1], [0.9, 0.5, 0.8])
    assert np.isclose(result["fm"], 0.15)
    assert result["plasticity"] == 0

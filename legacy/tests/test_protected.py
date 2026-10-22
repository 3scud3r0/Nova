import numpy as np
import pytest
from nova.continual import ProtectedLinear


def fixture(seed=4):
    rng = np.random.default_rng(seed)
    q, _ = np.linalg.qr(rng.normal(size=(16, 16)))
    x = rng.normal(size=(40, 6)) @ q[:, :6].T
    layer = ProtectedLinear(16, 3, seed=seed)
    for _ in range(30):
        layer.step(x, np.ones((40, 3)), 0.03)
    return rng, layer, x


def test_retention_and_incremental_span():
    rng, layer, x = fixture()
    layer.consolidate(x[:20])
    layer.consolidate(x[20:])
    assert layer.free_dims == 10
    assert np.linalg.norm(layer.U.T @ layer.U - np.eye(6)) < 1e-12
    before = layer(x)
    for _ in range(100):
        layer.step(rng.normal(size=(40, 16)), rng.normal(size=(40, 3)), 0.1)
    assert layer.retention_error(x, before) < 1e-10
    assert layer.eps_update < 1e-12
    np.testing.assert_allclose(layer.forward_addition_only(x), layer(x), atol=1e-12)


@pytest.mark.parametrize("violation", ["quantization", "rank", "drift"])
def test_hypothesis_violations(violation):
    rng, layer, x = fixture()
    if violation == "rank":
        layer.rank_max = 2
    layer.consolidate(x)
    before = layer(x)
    for _ in range(30):
        layer.step(rng.normal(size=(40, 16)), rng.normal(size=(40, 3)), 0.1)
    if violation == "quantization":
        layer.dW[:] = np.round(layer.dW)
    if violation == "drift":
        x = x @ np.linalg.qr(rng.normal(size=(16, 16)))[0]
    assert layer.retention_error(x, before) > 1e-4


def test_saturation_and_expansion():
    layer = ProtectedLinear(8, 2)
    layer.consolidate(np.eye(8))
    before = layer.dW.copy()
    layer.step(np.eye(8), np.ones((8, 2)))
    np.testing.assert_allclose(before, layer.dW, atol=1e-14)
    assert layer.free_dims == 0
    reference = layer(np.eye(8))
    layer.expand(3)
    np.testing.assert_allclose(reference, layer(np.pad(np.eye(8), ((0, 0), (0, 3)))))
    assert layer.free_dims == 3


def test_invalid_and_immutable():
    layer = ProtectedLinear(3, 2)
    with pytest.raises(ValueError):
        layer.W_base[0, 0] = 0
    with pytest.raises(ValueError):
        layer.consolidate(np.empty((0, 3)))
    with pytest.raises(ValueError):
        layer.step(np.ones((2, 3)), np.ones((2, 1)))

import numpy as np
import pytest
from nova.reasoning import (
    Calculator,
    grid_search,
    hierarchical_route,
)
from nova.runtime import CognitiveRuntime, RuntimeConfig
from nova.values import InternalState, OutputPolicy, SIMULATION_LABEL


def test_calculator_verification_and_rejection():
    c = Calculator()
    assert c("(3+7)*2**3/5") == 16
    for bad in ["__import__('os').system('true')", "2**100000", "[1][0]", "1/0"]:
        with pytest.raises((ValueError, ZeroDivisionError)):
            c(bad)


def test_search_budget_and_hierarchy():
    grid = np.zeros((8, 8), dtype=bool)
    grid[3, :7] = True
    assert not grid_search(grid, (0, 0), (7, 7), 1).verified
    result = hierarchical_route(grid, (0, 0), [(0, 7), (7, 7)], 200)
    assert result.verified
    for a, b in zip(result.path[:-1], result.path[1:]):
        assert np.abs(np.subtract(a, b)).sum() == 1


def test_checkpoint_continuation_and_idle(tmp_path):
    config = RuntimeConfig(seed=2, planning=True, neuromodulation=True, sleep_every=4)
    model = CognitiveRuntime(config)
    rng = np.random.default_rng(1)
    for _ in range(8):
        model.tick(rng.normal(size=12))
    model.save(tmp_path / "state.npz")
    restored = CognitiveRuntime.load(tmp_path / "state.npz")
    for _ in range(8):
        x = rng.normal(size=12)
        a = model.tick(x)
        b = restored.tick(x)
        np.testing.assert_array_equal(a["action"], b["action"])
        np.testing.assert_array_equal(model.continual.dW, restored.continual.dW)
        np.testing.assert_array_equal(model.cascade.state, restored.cascade.state)
    for _ in range(200):
        restored.tick()
    assert np.isfinite(restored.z).all() and np.linalg.norm(restored.z) > 0
    assert np.linalg.norm(restored.z) < 5


def test_noise_curiosity_and_output_gate():
    state = InternalState()
    for _ in range(100):
        state.update(1.0, 0.1, 0.5)
    assert state.curiosity == 0
    with pytest.raises(ValueError):
        OutputPolicy.render_claims([{"text": "invented"}])
    with pytest.raises(PermissionError):
        OutputPolicy.render_claims([], identity_mode=True)
    assert SIMULATION_LABEL in OutputPolicy.render_claims(
        [], identity_mode=True, consented=True
    )

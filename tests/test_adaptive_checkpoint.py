"""Unrun deterministic restoration and archive-integrity specifications."""

import numpy as np
from nova.runtime import CognitiveRuntime, RuntimeConfig
from nova.checkpoint import save_state, load_state


def test_numpy_runtime_checkpoint(tmp_path):
    config = RuntimeConfig(
        world_backend="equilibrium",
        adaptive_memory=True,
        sleep_every=2,
        world_online_learning=True,
    )
    a = CognitiveRuntime(config)
    rng = np.random.default_rng(2)
    for _ in range(4):
        a.tick(rng.normal(size=12))
    a.save(tmp_path / "state.npz")
    b = CognitiveRuntime.load(tmp_path / "state.npz")
    observation = rng.normal(size=12)
    x, y = a.tick(observation), b.tick(observation)
    np.testing.assert_array_equal(x["action"], y["action"])
    np.testing.assert_array_equal(a.continual.dW, b.continual.dW)


def test_codec_roundtrip_without_pickle(tmp_path):
    state = {"array": np.arange(6).reshape(2, 3), "nested": [None, True, {"x": 1.0}]}
    save_state(tmp_path / "data.npz", state)
    restored = load_state(tmp_path / "data.npz")
    np.testing.assert_array_equal(state["array"], restored["array"])
    assert state["nested"] == restored["nested"]

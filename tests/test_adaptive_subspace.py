"""Regression specifications, authored but not executed in this revision."""

import numpy as np
from nova.continual import AdaptiveSubspaceLinear, AdaptiveConfig


def test_growth_keeps_old_version_coordinates_and_anchor():
    rng = np.random.default_rng(3)
    m = AdaptiveSubspaceLinear(
        6, 2, config=AdaptiveConfig(policy="hybrid", max_features=12, growth_step=3)
    )
    x = rng.normal(size=(20, 6))
    y = rng.normal(size=(20, 2))
    for _ in range(20):
        m.step(m.encode(x, 0), y, 0.01)
    m.consolidate(m.encode(x, 0), anchor=True)
    reference = m(m.encode(x, 0))
    assert m.recruit() == 3
    assert np.count_nonzero(m.encode(x, 0)[:, 6:]) == 0
    assert np.count_nonzero(m.encode(x, 1)[:, 6:]) > 0
    for _ in range(50):
        m.step(m.encode(rng.normal(size=(20, 6)), 1), y, 0.01)
    np.testing.assert_allclose(m(m.encode(x, 0)), reference, atol=1e-10)
    assert m.release(20) == 0


def test_relaxation_frees_space_without_infinite_capacity_claim():
    m = AdaptiveSubspaceLinear(
        4, 1, config=AdaptiveConfig(policy="relax", max_features=4)
    )
    m.consolidate(np.eye(4))
    assert m.free_dims == 0
    assert m.release(2) == 2 and m.free_dims == 2
    assert m.recruit() == 0
    restored = AdaptiveSubspaceLinear.from_state_dict(m.state_dict())
    np.testing.assert_array_equal(m.U, restored.U)


def test_strict_policy_does_not_release_and_growth_is_bounded():
    strict = AdaptiveSubspaceLinear(
        3, 1, config=AdaptiveConfig(policy="strict", max_features=6)
    )
    strict.consolidate(np.eye(3))
    strict.manage_capacity()
    assert strict.free_dims == 0
    grow = AdaptiveSubspaceLinear(
        3, 1, config=AdaptiveConfig(policy="expand", max_features=5, growth_step=8)
    )
    assert grow.recruit() == 2 and grow.recruit() == 0

"""Unrun nonlinear equilibrium/implicit-gradient specifications."""

import numpy as np
from nova.jepa.equilibrium import EquilibriumNetwork, EquilibriumWorldModel


def test_contraction_and_implicit_derivative():
    m = EquilibriumNetwork(3, 2, seed=1)
    x = np.array([[0.2, -0.3, 0.4]])
    result, j = m.linearize(x)
    eps = 1e-5
    for i in range(3):
        delta = np.eye(3)[i][None] * eps
        numerical = (m.predict(x + delta) - m.predict(x - delta)) / (2 * eps)
        np.testing.assert_allclose(j[:, :, i], numerical, atol=1e-5, rtol=1e-3)
    assert m.last_diagnostics["converged"]


def test_local_nudging_preserves_symmetric_bound():
    m = EquilibriumNetwork(3, 2, seed=2)
    x = np.ones((8, 3)) * 0.2
    update = m.learn(x, np.ones((8, 2)) * 0.1)
    assert update["updated"]
    np.testing.assert_allclose(m.W, m.W.T, atol=1e-12)
    assert np.linalg.norm(m.W, 2) <= m.config.recurrent_radius + 1e-12
    world = EquilibriumWorldModel(6, 4, 2)
    world.freeze_encoder()
    before = world.context.B.copy()
    world.learn_latent(np.zeros((8, 4)), np.zeros((8, 2)), np.ones((8, 4)) * 0.2)
    np.testing.assert_array_equal(before, world.context.B)

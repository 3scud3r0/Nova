import numpy as np
from nova.memory import ModernHopfield, kwta, WorkingMemory, SemanticGraph
from nova.synapse import DiffusiveCascade, ThreeFactorRule
from nova.planning import LatentPlanner
from nova.neuromod import Neuromodulator


def test_retrieval_and_energy():
    rng = np.random.default_rng(1)
    patterns = kwta(rng.normal(size=(16, 128)), 0.05)
    patterns /= np.linalg.norm(patterns, axis=1, keepdims=True)
    h = ModernHopfield(patterns, beta=40)
    for pattern in patterns:
        q = pattern + rng.normal(0, 0.03, 128)
        result = h.retrieve(q)
        assert np.argmax(patterns @ result) == np.argmax(patterns @ pattern)
        assert h.energy(result) <= h.energy(q) + 1e-10


def test_cascade_against_analytic_and_mass():
    c = DiffusiveCascade(reservoirs=2, leak=0)
    c.state[0, 0] = 1
    expected = c.analytic(2.0)
    for _ in range(200):
        c.step(dt=0.01)
    np.testing.assert_allclose(c.state, expected, atol=1e-9)
    mass = c.state @ c.capacity
    c.consolidate(0.5)
    np.testing.assert_allclose(c.state @ c.capacity, mass)


def test_stdp_timing_and_modulation():
    rule = ThreeFactorRule(1, 1)
    rule.step([1], [0], 1)
    assert rule.step([0], [1], 1)[0, 0] > 0
    rule = ThreeFactorRule(1, 1)
    rule.step([0], [1], 1)
    assert rule.step([1], [0], 1)[0, 0] < 0
    assert np.all(rule.step([1], [1], 0) == 0)


def test_cem_and_ablation_signals():
    planner = LatentPlanner(lambda z, a: z + 0.2 * a, lambda z: (z * z).sum(1), seed=1)
    result = planner.plan(np.array([1.0]))
    assert result.action[0] < -0.5
    assert result.iterations == 4
    mod = Neuromodulator().update(2.0, reward=1.0, uncertainty=0.8)
    ablated = Neuromodulator(frozenset()).update(2.0, reward=1.0, uncertainty=0.8)
    assert mod.learning_rate(0.1) > ablated.learning_rate(0.1)
    assert mod.sensory_weight() > ablated.sensory_weight()


def test_bounded_working_memory_and_conflicts():
    memory = WorkingMemory()
    for _ in range(100):
        memory.update(np.ones(8))
    assert np.max(memory.state) <= 1
    graph = SemanticGraph()
    graph.add("a", "job", "x", "source1")
    graph.add("a", "job", "y", "source2")
    assert len(graph.query("a", "job")) == 2

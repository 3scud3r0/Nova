import numpy as np
import pytest
import torch
from nova.neuron import RateNeuron, AdExPopulation, HodgkinHuxleyCompartments
from nova.brain import Microcircuit
from nova.perception import (
    StreamingAudioEncoder,
    VisionEncoder,
    TextEncoder,
    SlotAttention,
    PredictiveHierarchy,
    MultimodalFusion,
)
from nova.core import available
from nova.synapse import DiffusiveCascade, NativeDiffusiveCascade


def test_adex_spikes_and_native_parity():
    py = AdExPopulation(20, seed=3)
    native = AdExPopulation(20, seed=3, backend="rust") if available() else None
    count = 0
    for _ in range(1000):
        spikes, state = py.step((500.0, 10.0))
        count += spikes.sum()
        if native:
            other, ns = native.step((500.0, 10.0))
            np.testing.assert_array_equal(spikes, other)
            for key in state:
                np.testing.assert_allclose(state[key], ns[key], atol=1e-10)
    assert count > 0 and np.isfinite(py.v).all()
    with pytest.raises(ValueError):
        py.step((0, 0), dt=2)


def test_dale_and_n2():
    circuit = Microcircuit(100)
    assert circuit.check_dale()
    model = HodgkinHuxleyCompartments()
    spikes = 0
    for _ in range(1000):
        output, state = model.step((10.0, 0.0))
        spikes += output.sum()
    assert spikes > 0 and np.isfinite(state["v"]).all()


def test_n0_sparse_apical():
    model = RateNeuron(4, 20, k=0.1)
    out, state = model.step((np.ones(4), np.zeros(4)))
    assert np.count_nonzero(out) <= 2
    assert np.isfinite(out).all()


def test_streaming_chunk_equivalence():
    torch.manual_seed(4)
    model = StreamingAudioEncoder()
    signal = torch.randn(2048)
    expected = model(signal).detach()
    model.reset()
    result = torch.cat([model(signal[i : i + 117]) for i in range(0, len(signal), 117)])
    torch.testing.assert_close(expected, result, atol=1e-6, rtol=1e-5)


def test_perception_and_precision_relaxation():
    assert VisionEncoder()(torch.randn(2, 3, 32, 32)).shape == (2, 16)
    text = TextEncoder()
    assert text(["Olá", ""]).shape == (2, 16)
    tokens = torch.randn(2, 8, 16)
    slots = SlotAttention()(tokens)
    assert slots.shape == (2, 4, 16)
    model = PredictiveHierarchy()
    states, energy = model.infer(np.arange(8) / 8)
    assert energy[-1] < energy[0]
    fusion = MultimodalFusion()
    x = torch.zeros(2, 16)
    y = torch.ones(2, 16)
    torch.testing.assert_close(
        fusion([x, y], torch.tensor([[1.0, 3.0], [1.0, 3.0]])), torch.full_like(x, 0.75)
    )


def test_native_cascade_parity():
    if not available():
        pytest.skip("native extension unavailable")
    a = DiffusiveCascade(4)
    b = NativeDiffusiveCascade(4)
    for _ in range(40):
        a.step(0.2)
        b.step(0.2)
    np.testing.assert_allclose(a.state, b.state, atol=1e-12)

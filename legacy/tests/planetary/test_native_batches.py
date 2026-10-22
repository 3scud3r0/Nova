import numpy as np
import pytest
from nova.core import available, require_native
from nova.bioma.genetics import MorphogeneticCPPN
from nova.core.resident import cppn_native, independent_hh_native
from nova.neuron import HodgkinHuxleyCompartments

pytestmark = (
    pytest.mark.skipif(
        not available() or not hasattr(require_native(), "NativeField"),
        reason="rebuild optional native extension for v0.4",
    )
    if available()
    else pytest.mark.skip(reason="native extension unavailable")
)


def test_native_reaction_stoichiometry():
    raw = np.ones((8**3, 2), dtype=np.float32) * 0.5
    field = require_native().NativeField(8, raw.ravel().tolist())
    field.step(steps=1, feed=0.0, kill=0.0, du=0.0, dv=0.0)
    chemistry = np.asarray(field.snapshot()[0]).reshape(-1, 2)
    np.testing.assert_allclose(chemistry.sum(1), raw.sum(1), atol=1e-6)


def test_cppn_native_matches_declared_functions():
    genome = MorphogeneticCPPN(41)
    features = np.arange(40).reshape(5, 8) * 0.01
    np.testing.assert_allclose(
        cppn_native(genome, features), genome._evaluate(features), atol=1e-12
    )


def test_independent_hh_matches_one_compartment_reference():
    reference = HodgkinHuxleyCompartments(1)
    state = np.r_[reference.v, reference.gates[:, 0]][None]
    actual = independent_hh_native(state, [10.0], dt=0.01)
    reference.step((10.0, 0.0), dt=0.01)
    np.testing.assert_allclose(
        actual[0], np.r_[reference.v, reference.gates[:, 0]], atol=1e-10
    )

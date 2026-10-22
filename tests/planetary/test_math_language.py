"""Validation cases for future execution; not run during this delivery."""

import numpy as np
import pytest
from nova.scientific.non_polynomial import (
    Expression,
    grunwald_letnikov,
    NonPolynomialRegressor,
)
from nova.scientific.hamiltonian_search import HamiltonianSearch
from nova.bioma.acoustics import AcousticChannel, image_source_echoes
from nova.bioma.linguistics import SignalInterpreter
from nova.bioma.genetics import MorphogeneticCPPN
from nova.bioma.macro_evolution import crossover


def test_transcendental_chain_rule_and_domains():
    x = np.linspace(0.1, 1, 24)[:, None]
    expression = Expression.parse("sin(x)+x*x", ["x"])
    np.testing.assert_allclose(
        expression.derivative("x").evaluate(x, ["x"]),
        np.cos(x[:, 0]) + 2 * x[:, 0],
        atol=1e-12,
    )
    with pytest.raises(ValueError):
        Expression.parse("log(x)", ["x"]).evaluate(np.array([[-1.0]]), ["x"])
    with pytest.raises(ValueError):
        Expression.parse('__import__("os")', ["x"])


def test_fractional_operator_integer_order_and_boundary():
    derivative = grunwald_letnikov(np.arange(16, dtype=float), 1.0, 1.0, memory=8)
    np.testing.assert_allclose(derivative[1:], 1.0)
    assert derivative[0] == 0.0


def test_harmonic_hamiltonian_from_vector_field():
    t = np.linspace(0, 6, 80)
    states = np.c_[np.cos(t), -np.sin(t)]
    velocity = np.c_[states[:, 1], -states[:, 0]]
    result = HamiltonianSearch(["q", "p"], ["q*q", "p*p"]).fit(states, velocity)
    np.testing.assert_allclose(result["coefficients"], [0.5, 0.5], atol=1e-10)
    assert result["heldout_vector_mse"] < 1e-15
    assert result["status"] == "empirical_hamiltonian_candidate"


def test_nonpolynomial_holdout_fits_sine_without_proof_claim():
    x = np.linspace(-1, 2, 100)[:, None]
    result = NonPolynomialRegressor().fit(x, np.sin(x[:, 0]), ["x"])
    assert result["heldout_mse"] < 1e-10
    assert not result["formal_proof"]


def test_channel_delay_and_bandwidth():
    channel = AcousticChannel([16, 16, 16])
    recipients = [("b", [4, 0, 0])]
    assert channel.emit("a", np.zeros(3), 1, recipients, 0) > 0
    assert channel.emit("a", np.zeros(3), 2, recipients, 1) == 0
    assert channel.receive(0, {"a", "b"}) == []
    assert channel.receive(1, {"a", "b"})[0]["token"] == 1


def test_first_order_reflective_paths_include_direct_delay():
    paths = image_source_echoes([1, 1, 1], [2, 1, 1], [10, 10, 10], speed=1.0)
    assert len(paths) == 7 and paths[0]["delay_seconds"] == 1.0


def test_translation_is_association_with_holdout():
    interpreter = SignalInterpreter()
    for i in range(100):
        interpreter.observe(i % 2, i % 2)
    report = interpreter.report()
    assert report["mutual_information_bits"] > 0.9
    assert report["patterns"][0]["heldout_accuracy"] == 1.0
    assert "syntax" in report["scope"]


def test_homologous_crossover_records_two_parents_and_dale():
    a, b = MorphogeneticCPPN(1), MorphogeneticCPPN(2)
    child = crossover(a, b, 3)
    assert child.parents == [a.hash(), b.hash()]
    topology = child.develop_brain()
    assert np.all(topology["weights"][topology["types"] != 0] <= 0)

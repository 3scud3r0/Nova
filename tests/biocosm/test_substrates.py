"""Future validation cases; authored but not executed for the v0.3 delivery."""

import numpy as np
import pytest
from nova.bioma.determinism import SplitMix64, digest_state
from nova.bioma.physics_engine import PhysicsConfig, PhysicsEngine
from nova.bioma.ecosystem import Ecosystem, EcosystemConfig
from nova.bioma.genetics import MorphogeneticCPPN
from nova.swarm.holoseed import HoloSeed


def test_specified_splitmix_vector():
    assert SplitMix64(0).next_u64() == 0xE220A8397B1DCDAF


def test_periodic_laplacian_has_zero_integral():
    world = PhysicsEngine(PhysicsConfig(shape=(8, 8, 8)))
    assert abs(world.laplacian(world.v).sum()) < 1e-12


def test_chemical_stoichiometry_simultaneous_update():
    world = PhysicsEngine(
        PhysicsConfig(shape=(8, 8), feed=0, kill=0, diffusion_u=0, diffusion_v=0)
    )
    before = (world.u + world.v).copy()
    world.step()
    np.testing.assert_allclose(world.u + world.v, before, atol=1e-15)


@pytest.mark.parametrize("mode", ["conway", "fixed_gray_scott"])
def test_integer_replay_binds_exact_clock_and_state(mode):
    eco = Ecosystem(
        PhysicsConfig(mode=mode, shape=(8, 8)), EcosystemConfig(initial_population=0)
    )
    eco.step(3)
    packet = HoloSeed.pack(eco, tier="strict_integer")
    _, receipt = HoloSeed.reproduce(packet)
    assert receipt["status"] == "matched"
    packet["payload"]["expected_state_sha256"] = "0" * 64
    assert HoloSeed.reproduce(packet)[1]["status"] == "mismatch"


def test_hash_covers_nested_learning_state():
    state = {"organism": {"weights": np.eye(3), "adaptation": np.zeros(3)}}
    original = digest_state(state)
    state["organism"]["adaptation"][0] = 1
    assert digest_state(state) != original


def test_checkpoint_restores_full_ecosystem_hash():
    eco = Ecosystem(PhysicsConfig(shape=(8, 8)), EcosystemConfig(initial_population=1))
    eco.step(2)
    restored = Ecosystem.from_state_dict(eco.state_dict())
    assert restored.state_hash() == eco.state_hash()
    eco.step()
    restored.step()
    assert restored.state_hash() == eco.state_hash()


def test_cppn_development_is_repeatable_and_dale_compliant():
    genome = MorphogeneticCPPN(42)
    a = genome.develop_brain()
    b = genome.develop_brain()
    np.testing.assert_array_equal(a["weights"], b["weights"])
    assert np.all(a["weights"][a["types"] == 0] >= 0)
    assert np.all(a["weights"][a["types"] != 0] <= 0)
    assert np.count_nonzero(a["families"] == 2) <= genome.config.max_n2


def test_pair_queries_distinguish_equal_midpoints():
    genome = MorphogeneticCPPN(42)
    assert not np.array_equal(
        genome.query_pair([1, 0, 0], [-1, 0, 0]),
        genome.query_pair([0, 1, 0], [0, -1, 0]),
    )


def test_custom_genesis_replays_its_actual_genome():
    genome = MorphogeneticCPPN(19).mutate(29, 0.5)
    eco = Ecosystem(
        PhysicsConfig(shape=(8, 8)),
        EcosystemConfig(initial_population=1),
        genesis_genomes=[genome.state_dict()],
    )
    eco.step(2)
    restored, receipt = HoloSeed.reproduce(HoloSeed.pack(eco))
    assert receipt["status"] == "matched"
    assert restored.organisms[0].genome.hash() == genome.hash()


@pytest.mark.parametrize("signaling", [False, True])
def test_checkpoint_restore_is_independent_and_replays(signaling):
    """In-memory snapshots must not alias the original ecosystem or its acoustic queues."""
    eco = Ecosystem(
        PhysicsConfig(shape=(8, 8), seed=42),
        EcosystemConfig(initial_population=2, signaling=signaling),
    )
    eco.step(8)
    state = eco.state_dict()
    restored = Ecosystem.from_state_dict(state)
    baseline = eco.state_hash()
    assert restored.state_hash() == baseline

    # Advancing the live ecosystem must not mutate a previously returned snapshot.
    frozen_hash = digest_state(state)
    eco.step()
    assert digest_state(state) == frozen_hash
    assert restored.state_hash() == baseline
    restored.step()
    assert restored.state_hash() == eco.state_hash()

    for _ in range(3):
        eco.step()
        restored.step()
        assert restored.state_hash() == eco.state_hash()

    assert restored.history is not eco.history
    assert restored.organisms[0].body is not eco.organisms[0].body
    assert restored.acoustics.pending is not eco.acoustics.pending
    assert restored.acoustics.log is not eco.acoustics.log
    assert restored.acoustics.last_emit is not eco.acoustics.last_emit


def test_acoustic_restore_does_not_share_nested_packets():
    from nova.bioma.acoustics import AcousticChannel

    original = AcousticChannel((8, 8))
    original.pending.append({"arrival": 10, "metadata": {"label": "keep"}})
    exported = original.state_dict()
    restored = AcousticChannel.restore(exported)
    restored.pending[0]["metadata"]["label"] = "changed"
    assert original.pending[0]["metadata"]["label"] == "keep"
    assert exported["pending"][0]["metadata"]["label"] == "keep"
    original.pending[0]["metadata"]["label"] = "other"
    assert exported["pending"][0]["metadata"]["label"] == "keep"

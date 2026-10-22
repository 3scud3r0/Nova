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

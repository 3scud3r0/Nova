import time
import pytest
from nova.bioma.genetics import MorphogeneticCPPN
from nova.bioma.ecosystem import Ecosystem, EcosystemConfig
from nova.bioma.physics_engine import PhysicsConfig
from nova.swarm.holoseed import HoloSeed
from nova.swarm.artifacts import SigningIdentity
from nova.swarm.dht_discovery import descriptor, DiscoveryTable
from nova.swarm.spore_migration import SporeMigration, make_spore
from nova.swarm.cross_validation import (
    make_challenge,
    CrossValidationWorker,
    aggregate_attestations,
)
from nova.scientific.auto_lean import ProofDaemon


def test_migration_is_recorded_and_reproducible(tmp_path):
    identity = SigningIdentity.load_or_create(tmp_path / "key")
    genome = MorphogeneticCPPN(77)
    migration = SporeMigration(identity, enabled=True)
    packet = make_spore(identity, genome, {"fixture": "synthetic"})
    migration.receive(packet, identity.peer_id)
    eco = Ecosystem(PhysicsConfig(shape=(8, 8)), EcosystemConfig(initial_population=0))
    assert migration.admit(eco)["status"] == "admitted"
    assert eco.migration_energy == eco.config.initial_energy
    replay, receipt = HoloSeed.reproduce(HoloSeed.pack(eco))
    assert receipt["status"] == "matched" and len(replay.organisms) == 1
    with pytest.raises(ValueError):
        migration.receive(packet, identity.peer_id)


def test_discovery_rejects_expired_authentic_descriptor(tmp_path):
    identity = SigningIdentity.load_or_create(tmp_path / "key")
    own = descriptor(identity, "tcp://127.0.0.1:8766")
    table = DiscoveryTable(identity, own)
    payload = own["payload"].copy()
    payload["expires"] = int(time.time()) - 1
    with pytest.raises(ValueError):
        table.verify(identity.sign(payload))


def test_signed_counterexample_search_is_not_a_proof(tmp_path):
    identity = SigningIdentity.load_or_create(tmp_path / "key")
    worker = CrossValidationWorker(identity)
    challenge = make_challenge(identity, "x*x", "x", ["x"], [[-1, 1]], samples=32)
    key = worker.enqueue(challenge, identity.peer_id)["challenge"]
    receipts = worker.process_once()
    report = aggregate_attestations(receipts + receipts, key)
    assert (
        report["status"] == "reported_counterexample"
        and report["independent_keys"] == 1
    )
    assert not report["formal_proof"]
    assert aggregate_attestations([], key)["status"] == "inconclusive"


def test_no_counterexample_remains_finite_evidence(tmp_path):
    identity = SigningIdentity.load_or_create(tmp_path / "key")
    worker = CrossValidationWorker(identity)
    challenge = make_challenge(identity, "x*x", "x**2", ["x"], [[-1, 1]], samples=32)
    key = worker.enqueue(challenge, identity.peer_id)["challenge"]
    report = aggregate_attestations(worker.process_once(), key)
    assert (
        report["status"] == "finite_unrefuted_evidence" and not report["formal_proof"]
    )


def test_exact_worker_never_emits_uncompiled_lean_theorem(tmp_path):
    worker = ProofDaemon(tmp_path)
    worker.submit("(x+1)**2", "x*x+2*x+1", ["x"])
    result = worker.process_once()[0]
    assert (
        result["exact"]["status"] == "proved"
        and result["lean"]["status"] == "unavailable"
    )
    assert list((tmp_path / "theorems").glob("*.lean")) == []

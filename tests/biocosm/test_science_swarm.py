"""Evidence boundaries, transport admission and compatibility checks."""

import asyncio
import numpy as np
import pytest
from nova.bioma.determinism import canonical_json
from nova.scientific.polynomial import Polynomial
from nova.scientific.verification import PolynomialVerifier
from nova.scientific.symbolic_regression import SymbolicRegressor
from nova.swarm.artifacts import ArtifactStore, SigningIdentity, ScientificLedger
from nova.swarm.p2p_node import Peer, PeerNode
from nova.swarm.subspace_exchange import package_subspace, merge_subspaces
from nova.swarm.sheaf_consensus import SheafGossip


def test_exact_continuous_oscillator_invariant_and_counterexample():
    p = lambda text: Polynomial.parse(text, ["x", "v"])
    verifier = PolynomialVerifier()
    assert verifier.invariant(p("x*x+v*v"), [p("v"), p("-x")]).status == "proved"
    assert verifier.invariant(p("x*x"), [p("v"), p("-x")]).status == "refuted"


def test_polynomial_parser_never_accepts_calls():
    with pytest.raises(ValueError):
        Polynomial.parse('__import__("os")', ["x"])


def test_sparse_fit_has_heldout_evidence_without_proof_label():
    x = np.linspace(-1, 1, 80)[:, None]
    candidate = SymbolicRegressor(degree=2, max_terms=3).fit(
        x, 2 * x[:, 0] + x[:, 0] ** 2, ["x"]
    )
    assert candidate.metrics["heldout_mse"] < 1e-10
    assert candidate.to_dict()["status"] == "empirical_candidate"


def test_signed_blob_tamper_and_ledger_head(tmp_path):
    identity = SigningIdentity.load_or_create(tmp_path / "key")
    packet = identity.sign({"a": 1})
    packet["payload"]["a"] = 2
    with pytest.raises(ValueError):
        SigningIdentity.verify(packet)
    ledger = ScientificLedger(tmp_path / "ledger.sqlite", identity)
    try:
        head = ledger.append("discovery", {"status": "candidate"})
        assert ledger.verify(head)["entries"] == 1
        with pytest.raises(ValueError):
            ledger.verify("0" * 64)
    finally:
        ledger.close()


def test_subspace_union_requires_same_encoder_and_respects_capacity():
    local = np.eye(4)[:, :1]
    packet = package_subspace(np.eye(4)[:, 1:2], "shared")
    assert merge_subspaces(local, packet, "shared", 1)["status"] == "capacity_rejected"
    assert merge_subspaces(local, packet, "shared", 2)["rank"] == 2
    with pytest.raises(ValueError):
        merge_subspaces(local, packet, "other", 4)


def test_sheaf_consistency_is_not_proof():
    gossip = SheafGossip(1, "model", initial=[0.0])
    assert not gossip.accept(
        "peer", {"model_id": "other", "value": [1.0], "sequence": 0}
    )
    packet = {"model_id": "model", "value": [1.0], "sequence": 0}
    assert gossip.accept("peer", packet)
    assert not gossip.accept("peer", packet)
    assert gossip.step()["value"][0] > 0


def test_pinned_rpc_rejects_replayed_signed_request(tmp_path):
    a = SigningIdentity.load_or_create(tmp_path / "a")
    b = SigningIdentity.load_or_create(tmp_path / "b")
    client = PeerNode(
        a, ArtifactStore(tmp_path / "ac"), [Peer(b.peer_id, "tcp://127.0.0.1:9001")]
    )
    server = PeerNode(
        b, ArtifactStore(tmp_path / "bc"), [Peer(a.peer_id, "tcp://127.0.0.1:9002")]
    )
    request = canonical_json(client.message("inventory", {}))
    reply = asyncio.run(server.handle(request))
    assert reply
    with pytest.raises(ValueError):
        asyncio.run(server.handle(request))


def test_plaintext_remote_peers_are_rejected():
    with pytest.raises(ValueError):
        Peer("a" * 64, "tcp://example.com:9000")

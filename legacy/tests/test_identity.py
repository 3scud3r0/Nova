import json
import pytest
from cryptography.exceptions import InvalidTag
from nova.identity import IdentityStore, ConsentError
from nova.values import SIMULATION_LABEL
from nova.language import GroundedVerbalizer


def consent(path):
    path.mkdir(parents=True, exist_ok=True)
    file = path / "consent.json"
    file.write_text(
        json.dumps(
            dict(
                subject_id="synthetic-subject",
                granted=True,
                authority="synthetic test fixture",
                granted_at="2020-01-01T00:00:00Z",
                purposes=["memory", "style"],
                authorized_principals=["owner"],
            )
        )
    )
    return file


def source(id="s1", value="engenharia", date="2020-02-01T00:00:00Z"):
    return dict(
        subject_id="synthetic-subject",
        id=id,
        kind="diary",
        rights="synthetic test data",
        timestamp=date,
        content="Estudei engenharia com Terceiro em cidade fictícia. contato@example.test",
        participants=["Terceiro"],
        facts=[{"predicate": "profissao", "value": value}],
        events=[{"content": "Estudo com Terceiro", "timestamp": date}],
    )


def test_consent_before_read_and_actor_isolation(tmp_path):
    with pytest.raises(ConsentError):
        IdentityStore(
            tmp_path / "vault",
            tmp_path / "consent.json",
            "synthetic-subject",
            "owner",
            b"x" * 32,
        )
    path = consent(tmp_path)
    with pytest.raises(ConsentError):
        IdentityStore(
            tmp_path / "vault", path, "synthetic-subject", "stranger", b"x" * 32
        )
    with pytest.raises(ConsentError):
        IdentityStore(tmp_path / "vault", path, "another-subject", "owner", b"x" * 32)


def test_encryption_grounding_conflicts_and_unknown(tmp_path):
    store = IdentityStore(
        tmp_path / "vault", consent(tmp_path), "synthetic-subject", "owner", b"x" * 32
    )
    store.ingest(source())
    assert "revisão" in store.answer("profissao")
    store.ingest(source("s2", "medicina", "2021-02-01T00:00:00Z"))
    store.review()
    answer = store.answer("profissao")
    assert SIMULATION_LABEL in answer
    assert all(t in answer for t in ["engenharia", "medicina", "s1", "s2"])
    assert "Não sei" in store.answer("unprovided")
    assert b"engenharia" not in store.path.read_bytes()
    exported = json.dumps(store.inspect())
    assert "Terceiro" not in exported and "contato@example.test" not in exported
    assert len(store.timeline()["events"]) == 2
    wrong = IdentityStore(
        tmp_path / "vault",
        tmp_path / "consent.json",
        "synthetic-subject",
        "owner",
        b"y" * 32,
    )
    with pytest.raises(InvalidTag):
        wrong.inspect()


def test_erasure_rebuilds_all_derived_weights(tmp_path):
    store = IdentityStore(
        tmp_path / "vault", consent(tmp_path), "synthetic-subject", "owner", b"x" * 32
    )
    store.ingest(source())
    store.ingest(source("s2", "medicina"))
    receipt = store.delete_source("s1")
    assert receipt["verified"] and receipt["derived_rebuilt"]
    clean = IdentityStore(
        tmp_path / "clean-vault",
        tmp_path / "consent.json",
        "synthetic-subject",
        "owner",
        b"x" * 32,
    )
    clean.ingest(source("s2", "medicina"))
    assert store.inspect()["derived"] == clean.inspect()["derived"]
    assert "s1" not in json.dumps(store.inspect())
    assert store.erase()["verified"]
    with pytest.raises(ConsentError):
        store.answer("profissao")


def test_third_party_facts_and_stream_label(tmp_path):
    store = IdentityStore(
        tmp_path / "vault", consent(tmp_path), "synthetic-subject", "owner", b"x" * 32
    )
    payload = source()
    payload["facts"][0]["subject_id"] = "third-party"
    with pytest.raises(ConsentError):
        store.ingest(payload)
    chunks = list(GroundedVerbalizer().stream([], identity_mode=True, consented=True))
    assert chunks[0].startswith(SIMULATION_LABEL)


def test_expiry_revocation_and_style_scope(tmp_path):
    path = consent(tmp_path)
    data = json.loads(path.read_text())
    data["purposes"] = ["memory"]
    path.write_text(json.dumps(data))
    store = IdentityStore(
        tmp_path / "vault", path, "synthetic-subject", "owner", b"x" * 32
    )
    store.ingest(source())
    assert store.inspect()["derived"]["style"] == {}
    data["expires_at"] = "2020-01-02T00:00:00Z"
    path.write_text(json.dumps(data))
    with pytest.raises(ConsentError):
        store.inspect()
    assert store.delete_source("s1")["verified"]
    assert store.erase()["verified"]

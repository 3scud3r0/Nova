"""Synthetic consent fixtures only. No real person's data or consent is invented."""

import json
import tempfile
from pathlib import Path
import numpy as np
from nova.identity import IdentityStore
from nova.values import SIMULATION_LABEL
from experiments.common import write_report


def main():
    rows = []
    for seed in range(5):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subject = f"fictional-{seed}"
            consent = root / "consent.json"
            consent.write_text(
                json.dumps(
                    dict(
                        subject_id=subject,
                        granted=True,
                        authority="synthetic benchmark fixture",
                        granted_at="2020-01-01T00:00:00Z",
                        purposes=["memory", "style"],
                        authorized_principals=["test"],
                    )
                )
            )
            store = IdentityStore(
                root / "vault", consent, subject, "test", bytes([seed + 1]) * 32
            )
            for i in range(10):
                store.ingest(
                    dict(
                        subject_id=subject,
                        id=f"doc-{i}",
                        kind="diary",
                        rights="synthetic",
                        timestamp=f"2020-{i + 1:02d}-01T00:00:00Z",
                        content=f"Fictional episode number {i}.",
                        facts=[{"predicate": f"fact-{i}", "value": f"value-{i}"}],
                        events=[{"content": f"episode-{i}"}],
                    )
                )
            store.review()
            answers = [store.answer(f"fact-{i}") for i in range(10)]
            accuracy = np.mean(
                [f"value-{i}" in answer for i, answer in enumerate(answers)]
            )
            citations = np.mean(
                [f"fonte: doc-{i}" in answer for i, answer in enumerate(answers)]
            )
            unknown = [store.answer(f"unknown-{i}") for i in range(10)]
            fabricated = np.mean(["Não sei" not in answer for answer in unknown])
            label_rate = np.mean([SIMULATION_LABEL in a for a in answers + unknown])
            receipt = store.delete_source("doc-0")
            store.review()
            deletion = "value-0" not in store.answer("fact-0") and receipt["verified"]
            erased = store.erase()["verified"]
            rows.append(
                dict(
                    seed=seed,
                    factual_accuracy=accuracy,
                    source_accuracy=citations,
                    fabrication_rate=fabricated,
                    label_rate=label_rate,
                    source_deleted=deletion,
                    profile_erased=erased,
                )
            )
    write_report(
        9,
        rows,
        "Apenas perfis fictícios com consentimento de fixture: dez fatos e dez perguntas sem resposta por semente; proveniência, rótulo, apagamento por fonte e perfil completo.",
        "É uma avaliação de armazenamento/recuperação estruturada, não teste held-out de compreensão natural ou fidelidade de uma pessoa. Estilo é um perfil estatístico; naturalidade/voz/LoRA não validadas. OCR/ASR/LLM são adaptadores opcionais que requerem dependências e pesos locais. Exclusão cobre o cofre ativo e estado derivado; cópias externas/backups não estão sob controle desta biblioteca. Minimização remove participantes declarados e contatos reconhecidos, não garante descoberta de todos os terceiros em texto livre.",
    )
    assert all(
        r["source_accuracy"] >= 0.95
        and r["fabrication_rate"] == 0
        and r["source_deleted"]
        and r["profile_erased"]
        for r in rows
    )


if __name__ == "__main__":
    main()

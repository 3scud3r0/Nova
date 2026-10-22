"""Explicit local workflow: simulation -> observations -> signed replay artifacts."""

from __future__ import annotations
from pathlib import Path
import numpy as np
from nova.swarm.artifacts import ArtifactStore, SigningIdentity, ScientificLedger
from nova.swarm.holoseed import HoloSeed
from nova.scientific.dataset_synthesizer import DatasetSynthesizer
from nova.scientific.symbolic_regression import SymbolicRegressor
from .determinism import canonical_json, strict_json


def run_and_export(ecosystem, directory, ticks=100, *, tier="same_environment"):
    if not 1 <= ticks <= 4096:
        raise ValueError("run tick budget is [1,4096]")
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    identity = SigningIdentity.load_or_create(directory / "private" / "signing.key")
    store = ArtifactStore(directory / "artifacts")
    observations = []
    world = ecosystem.world
    # A fixed, documented probe grid; no training labels are inferred from a proof.
    probes = (
        np.array(list(np.ndindex(*(2,) * world.ndim))) * (np.array(world.shape) // 2)
        + 1
    )
    for _ in range(ticks):
        before_u = world.u.copy()
        before_v = world.v.copy()
        lu = world.laplacian(before_u)
        lv = world.laplacian(before_v)
        ecosystem.step()
        observations.extend(
            {"kind": "organism_trajectory", **row}
            for row in ecosystem.observation_rows()
        )
        if world.config.mode in ("gray_scott", "hybrid", "fixed_gray_scott"):
            for position in probes:
                index = tuple(position)
                observations.append(
                    {
                        "kind": "chemical_probe",
                        "tick": world.tick,
                        "position": position.tolist(),
                        "features": [
                            float(before_u[index]),
                            float(before_v[index]),
                            float(lu[index]),
                            float(lv[index]),
                        ],
                        "variables": ["u", "v", "lap_u", "lap_v"],
                        "du_dt": float(
                            (world.u[index] - before_u[index]) / world.config.dt
                        ),
                        "dv_dt": float(
                            (world.v[index] - before_v[index]) / world.config.dt
                        ),
                        "coupled_organisms": bool(ecosystem.config.initial_population),
                        "trajectory": world.config.seed,
                    }
                )
    seed = HoloSeed.pack(ecosystem, tier=tier, identity=identity)
    seed_digest = store.put_json(seed)
    (directory / "holoseed.json").write_bytes(canonical_json(seed))
    ecosystem.save(directory / "ecosystem.npz")
    genomes = {
        o.genome.hash(): store.put_json(o.genome.state_dict())
        for o in ecosystem.organisms
    }
    dataset = DatasetSynthesizer(directory / "dataset")
    for observation in observations:
        dataset.append(
            observation,
            seed_digest=seed_digest,
            units={
                "space": "grid cells",
                "time": "nondimensional",
                "energy": "simulation proxy",
            },
        )
    dataset_manifest = dataset.manifest()
    dataset_digest = store.put_json(dataset_manifest)
    ledger = ScientificLedger(directory / "ledger.sqlite", identity)
    try:
        ledger.append(
            "reproduction",
            {
                "seed_digest": seed_digest,
                "tier": tier,
                "expected_state": seed["payload"]["expected_state_sha256"],
            },
        )
        for genome, digest in genomes.items():
            ledger.append("lineage", {"genome_hash": genome, "artifact": digest})
        ledger.append("dataset", {"manifest": dataset_digest, "rows": dataset.count})
        head = ledger.verify()
    finally:
        ledger.close()
    report = {
        "protocol": "NOVA-COSM-RUN-v1",
        "directory": str(directory),
        "ticks": world.tick,
        "seed_artifact": seed_digest,
        "peer_id": identity.peer_id,
        "dataset": dataset_manifest,
        "genomes": genomes,
        "ledger": head,
        "metrics": ecosystem.metrics(),
        "scientific_status": "generated simulation observations; not universal physical truths",
    }
    (directory / "run.json").write_bytes(canonical_json(report))
    return report


def discover_dataset(path, output, *, target="dv_dt", degree=3, max_terms=8):
    if target not in ("du_dt", "dv_dt"):
        raise ValueError("unsupported target")
    rows = []
    source = Path(path)
    if source.name != "observations.jsonl":
        raise ValueError("use a DatasetSynthesizer observations.jsonl file")
    if source.stat().st_size > 256 * 1024 * 1024:
        raise ValueError("dataset input byte budget exceeded")
    # Verify the existing dataset chain before interpreting scientific rows.
    DatasetSynthesizer(source.parent)
    with source.open("rb") as stream:
        for line in stream:
            if len(line) > 262144:
                raise ValueError("row size exceeded")
            envelope = strict_json(line)
            row = envelope["observation"]
            if row.get("kind") == "chemical_probe":
                rows.append((envelope["seed_digest"], row))
            if len(rows) > 50000:
                raise ValueError("discovery sample budget exceeded")
    if len(rows) < 12:
        raise ValueError("at least 12 chemical probes required")
    groups = [r["trajectory"] for _, r in rows]
    candidate = SymbolicRegressor(degree, max_terms).fit(
        np.array([r["features"] for _, r in rows]),
        np.array([r[target] for _, r in rows]),
        ["u", "v", "lap_u", "lap_v"],
        groups=groups if len(set(groups)) > 1 else None,
        provenance={
            "seed_artifacts": sorted({digest for digest, _ in rows}),
            "target": target,
            "scope": "finite-difference simulation probes; coupled fields may not admit polynomial closure",
        },
    )
    result = candidate.to_dict()
    seed_path = source.parent.parent / "holoseed.json"
    if seed_path.is_file():
        from nova.scientific.polynomial import Polynomial
        from nova.scientific.verification import PolynomialVerifier
        import hashlib

        raw = seed_path.read_bytes()
        if hashlib.sha256(raw).hexdigest() not in {digest for digest, _ in rows}:
            raise ValueError("local seed manifest does not match dataset provenance")
        payload = HoloSeed.validate(strict_json(raw))[0]
        physics = payload["physics"]
        if physics["mode"] in ("gray_scott", "hybrid"):
            expression = (
                f"({physics['diffusion_u']})*lap_u-u*v*v+({physics['feed']})*(1-u)"
                if target == "du_dt"
                else f"({physics['diffusion_v']})*lap_v+u*v*v-(({physics['feed']})+({physics['kill']}))*v"
            )
            expected = Polynomial.parse(expression, candidate.polynomial.variables)
            result["declared_model_comparison"] = (
                PolynomialVerifier()
                .identity(
                    candidate.polynomial,
                    expected,
                    model={"physics": physics, "target": target},
                )
                .to_dict()
            )
            result["verification_scope"] = (
                "coefficient identity against declared continuous Gray-Scott reaction/diffusion term only; not the coupled integrator or real-world physics"
            )

    out = Path(output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(canonical_json(result))
    return result

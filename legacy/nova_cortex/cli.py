"""Command-line research workflows. Nothing trains or connects on import."""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import numpy as np
from .config import CortexConfig


def _digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        while chunk := source.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def latent_batches(path, *, start=0, stop=None):
    from .runtime.explained_dataset import arrow_transitions

    offset = 0
    for batch in arrow_transitions(path):
        end = offset + batch.num_rows
        first, last = max(start, offset), min(stop if stop is not None else end, end)
        if first < last:
            column = batch.column(batch.schema.get_field_index("latent")).slice(
                first - offset, last - first
            )
            # Copy once to writable training memory; do not expose mmap mutation.
            yield np.asarray(column.to_pylist(), dtype=np.float32)
        offset = end
        if stop is not None and offset >= stop:
            break


def train_sae(args):
    import torch
    from .interpretability.sparse_autoencoder import SparseAutoencoder
    from .runtime import checkpoints

    root = Path(args.dataset)
    manifest = json.loads((root / "manifest.json").read_text())
    if manifest.get("status") != "complete" or manifest.get("rows", 0) < 16:
        raise ValueError("a completed explained dataset with >=16 rows is required")
    config = CortexConfig(**manifest["config"]).validate()
    if not (
        1 <= args.epochs <= 1000
        and 1 <= args.batch_size <= 512
        and 16 <= args.max_samples <= 500000
        and 0 < args.learning_rate <= 0.01
    ):
        raise ValueError("invalid SAE training budget")
    torch.manual_seed(config.seed)
    device = torch.device(args.device)
    sae = SparseAutoencoder(
        config.latent,
        config.dictionary,
        mode=config.sae_mode,
        top_k=config.top_k,
        l1=config.l1,
    ).to(device)
    optimizer = torch.optim.Adam(sae.parameters(), lr=args.learning_rate)
    rows = min(manifest["rows"], args.max_samples)
    split = int(rows * 0.8)
    steps = 0
    last_loss = None
    # Learning-rate decay is epoch based, so streaming source batch size is immaterial.
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    for _ in range(args.epochs):
        for values in latent_batches(root / "explained.arrow", stop=split):
            for first in range(0, len(values), args.batch_size):
                tensor = torch.tensor(
                    values[first : first + args.batch_size], device=device
                )
                optimizer.zero_grad(set_to_none=True)
                loss, _ = sae.loss(tensor)
                if not torch.isfinite(loss):
                    raise FloatingPointError("nonfinite SAE loss")
                loss.backward()
                sae.project_decoder_gradient()
                torch.nn.utils.clip_grad_norm_(
                    sae.parameters(), 10, error_if_nonfinite=True
                )
                optimizer.step()
                sae.normalize_decoder()
                steps += 1
                last_loss = float(loss.detach())
        scheduler.step()
    error, active, samples = 0.0, 0.0, 0
    with torch.no_grad():
        for values in latent_batches(root / "explained.arrow", start=split, stop=rows):
            tensor = torch.tensor(values, device=device)
            reconstructed, features = sae(tensor)
            error += float((reconstructed - tensor).square().sum())
            active += float((features > 0).sum())
            samples += len(values)
    representation = (
        manifest.get("metadata", {}).get("representation_sha256")
        if manifest.get("metadata", {}).get("stationary_representation")
        else None
    )
    payload = dict(
        schema="NOVA-SAE-v1",
        sae=sae.state_dict(),
        trained=steps > 0,
        representation_sha256=representation,
        latent_dim=config.latent,
        dictionary=config.dictionary,
        mode=config.sae_mode,
        top_k=config.top_k,
        l1=config.l1,
        source_sha256=_digest(root / "explained.arrow"),
        metrics=dict(
            updates=steps,
            train_loss=last_loss,
            heldout_samples=samples,
            heldout_mse=error / max(samples * config.latent, 1),
            mean_active=active / max(samples, 1),
        ),
    )
    payload["dictionary_namespace"] = (
        checkpoints.dictionary_namespace(representation, sae)
        if representation
        else None
    )
    checkpoints.save(args.output, payload)
    return payload["metrics"]


def extract_theorems(args):
    from .interpretability.sindy_equations import SINDyEquations
    from .interpretability.formal_export import export_candidate, audit_candidate
    from .interpretability.symbolic_distiller import SymbolicDistiller

    if not 20 <= args.max_samples <= 500000:
        raise ValueError("invalid extraction sample limit")
    source = Path(args.states)
    if source.stat().st_size > 128 * 1024 * 1024:
        raise ValueError("trajectory archive exceeds budget")
    with np.load(source, allow_pickle=False) as data:
        states, time = (
            data["states"][: args.max_samples],
            data["time"][: args.max_samples],
        )
    model = SINDyEquations(trig=not args.polynomial_only, threshold=args.threshold)
    result = model.fit(states, time)
    output = Path(args.output)
    if args.nova_binary and not args.polynomial_only:
        raise ValueError("exact polynomial audit requires --polynomial-only")
    if args.lean_project and not args.nova_binary:
        raise ValueError("Lean export audit requires --nova-binary")
    if args.polynomial_only:
        export_candidate(result, output)
        if args.nova_binary:
            audit_candidate(output, args.nova_binary, lean_project=args.lean_project)
    else:
        output.mkdir(parents=True, exist_ok=False)
    (output / "sindy.json").write_text(json.dumps(result, indent=2, allow_nan=False))
    if args.pysr:
        derivative = np.gradient(states, time, axis=0, edge_order=2)
        worker = SymbolicDistiller(iterations=args.iterations)
        try:
            worker.submit(states, derivative[:, 0])
            # Offline CLI waits; live runtime can instead poll the same worker API.
            candidate = worker.future.result()
            (output / "pysr.json").write_text(
                json.dumps(candidate, indent=2, allow_nan=False)
            )
        finally:
            worker.close()
    return dict(
        output=str(output), status="candidate-not-verified", physical_truth_proved=False
    )


def extract_particle_force(args):
    from nova_engine.training import TrajectoryTransitions
    from .interpretability.symbolic_distiller import SymbolicDistiller

    root = Path(args.dataset)
    manifest = json.loads((root / "manifest.json").read_text())
    dt = float(manifest["config"]["dt"])
    if not np.isfinite(dt) or dt <= 0 or not 16 <= args.max_samples <= 50000:
        raise ValueError("invalid trajectory time step/sample budget")
    predictors, target = [], []
    used = 0
    for transition in TrajectoryTransitions(root):
        count = min(len(transition["input"]), args.max_samples - used)
        if count <= 0:
            break
        current, following = transition["input"][:count], transition["target"][:count]
        elapsed = (transition["ticks"][1] - transition["ticks"][0]) * dt
        predictors.append(current)
        target.append((following[:, 3] - current[:, 3]) / elapsed)
        used += count
    if used < 16:
        raise ValueError("not enough matched particle transitions")
    worker = SymbolicDistiller(iterations=args.iterations)
    try:
        worker.submit(np.concatenate(predictors), np.concatenate(target))
        result = worker.future.result()
    finally:
        worker.close()
    result["target"] = "finite-difference ax from matched particle IDs"
    result["predictors"] = ["x", "y", "z", "vx", "vy", "vz"]
    result["scope"] = (
        "single-particle observational candidate; omitted neighbors may make the law unidentifiable"
    )
    with Path(args.output).open("x") as output:
        json.dump(result, output, indent=2, allow_nan=False)
    return dict(output=args.output, status=result["status"])


def extract_latent(args):
    from .runtime.explained_dataset import arrow_transitions
    from .interpretability.symbolic_distiller import SymbolicDistiller

    dimensions = [int(i) for i in args.dimensions.split(",")]
    if not 1 <= len(dimensions) <= 16 or not 16 <= args.max_samples <= 50000:
        raise ValueError("bounded latent selection/sample count required")
    root = Path(args.dataset)
    manifest = json.loads((root / "manifest.json").read_text())
    if manifest.get("status") != "complete" or any(
        i < 0 or i >= manifest["config"]["hidden"] + manifest["config"]["stochastic"]
        for i in dimensions
    ):
        raise ValueError("completed dataset and valid latent indices required")
    x, y = [], []
    for batch in arrow_transitions(root / "explained.arrow"):
        for row in batch.to_pylist():
            target = json.loads(row["next_observables"]).get(args.target)
            if target is not None and np.isfinite(target):
                x.append([row["latent"][i] for i in dimensions])
                y.append(float(target))
            if len(x) >= args.max_samples:
                break
        if len(x) >= args.max_samples:
            break
    if len(x) < 16:
        raise ValueError("insufficient latents paired with measured acceleration")
    worker = SymbolicDistiller(iterations=args.iterations)
    try:
        worker.submit(np.asarray(x), np.asarray(y))
        result = worker.future.result()
    finally:
        worker.close()
    result.update(
        target=args.target,
        latent_dimensions=dimensions,
        alignment="latent at t -> ID-matched mean acceleration over the action interval t..t+1",
    )
    with Path(args.output).open("x") as out:
        json.dump(result, out, indent=2, allow_nan=False)
    return dict(status="candidate-not-verified", output=args.output)


def fit_probe_command(args):
    from .interpretability.concept_probes import fit_probe

    path = Path(args.samples)
    if path.stat().st_size > 256 * 1024 * 1024:
        raise ValueError("probe input exceeds budget")
    with np.load(path, allow_pickle=False) as data:
        probe, evidence = fit_probe(
            data["x_train"],
            data["y_train"],
            data["x_heldout"],
            data["y_heldout"],
            classification=args.classification,
        )
    evidence["dataset_sha256"] = _digest(path)
    with Path(args.output).open("x") as output:
        json.dump(
            dict(
                weights=probe.weights.tolist(),
                bias=probe.bias,
                mean=probe.mean.tolist(),
                scale=probe.scale.tolist(),
                task=probe.task,
                evidence=evidence,
            ),
            output,
            indent=2,
            allow_nan=False,
        )
    return evidence


def main(argv=None):
    parser = argparse.ArgumentParser(prog="nova-cortex")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("--ring", required=True)
    run.add_argument("--output", required=True)
    run.add_argument("--ticks", type=int, default=1024)
    run.add_argument("--config")
    run.add_argument("--profile", choices=["full", "compact"], default="compact")
    run.add_argument("--device", default="cpu")
    run.add_argument("--checkpoint")
    run.add_argument("--sae-checkpoint")
    run.add_argument("--frozen-world", action="store_true")
    run.add_argument("--catalog")
    run.add_argument("--memory-directory")
    run.add_argument("--console-every", type=int, default=32)
    sae = sub.add_parser("train-sae")
    sae.add_argument("--dataset", required=True)
    sae.add_argument("--output", required=True)
    sae.add_argument("--epochs", type=int, default=3)
    sae.add_argument("--batch-size", type=int, default=64)
    sae.add_argument("--max-samples", type=int, default=500000)
    sae.add_argument("--learning-rate", type=float, default=1e-3)
    sae.add_argument("--device", default="cpu")
    science = sub.add_parser("extract-theorems")
    science.add_argument(
        "--states",
        required=True,
        help="NPZ with states [T,D] and strictly increasing time [T]",
    )
    science.add_argument("--output", required=True)
    science.add_argument("--polynomial-only", action="store_true")
    science.add_argument("--pysr", action="store_true")
    science.add_argument("--nova-binary")
    science.add_argument("--lean-project")
    science.add_argument("--threshold", type=float, default=0.05)
    science.add_argument("--iterations", type=int, default=40)
    science.add_argument("--max-samples", type=int, default=50000)
    force = sub.add_parser("particle-force")
    force.add_argument("--dataset", required=True)
    force.add_argument("--output", required=True)
    force.add_argument("--max-samples", type=int, default=20000)
    force.add_argument("--iterations", type=int, default=40)
    latent = sub.add_parser("extract-latent")
    latent.add_argument("--dataset", required=True)
    latent.add_argument("--output", required=True)
    latent.add_argument("--dimensions", default="0,1,2,3")
    latent.add_argument(
        "--target", choices=["mean_ax", "mean_ay", "mean_az"], default="mean_ax"
    )
    latent.add_argument("--max-samples", type=int, default=20000)
    latent.add_argument("--iterations", type=int, default=40)
    probe = sub.add_parser("probe")
    probe.add_argument("--samples", required=True)
    probe.add_argument("--output", required=True)
    probe.add_argument("--classification", action="store_true")
    register = sub.add_parser("register-concept")
    register.add_argument("--catalog", required=True)
    register.add_argument("--concept", required=True)
    export = sub.add_parser("export-d4rl")
    export.add_argument("--dataset", required=True)
    export.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    if args.command == "run":
        from .runtime.brain_loop import BrainLoop

        config = (
            CortexConfig.load(args.config)
            if args.config
            else (
                CortexConfig.compact(device=args.device)
                if args.profile == "compact"
                else CortexConfig(device=args.device).validate()
            )
        )
        brain = BrainLoop(
            config,
            args.ring,
            args.output,
            checkpoint=args.checkpoint,
            sae_checkpoint=args.sae_checkpoint,
            frozen_world=args.frozen_world,
            catalog=args.catalog,
            memory_directory=args.memory_directory,
        )
        result = asyncio.run(brain.run(args.ticks, console_every=args.console_every))
    elif args.command == "train-sae":
        result = train_sae(args)
    elif args.command == "extract-theorems":
        result = extract_theorems(args)
    elif args.command == "particle-force":
        result = extract_particle_force(args)
    elif args.command == "extract-latent":
        result = extract_latent(args)
    elif args.command == "probe":
        result = fit_probe_command(args)
    elif args.command == "register-concept":
        from .interpretability.monosemantic_catalog import MonosemanticCatalog, Concept

        with Path(args.concept).open() as file:
            concept = Concept(**json.load(file))
        catalog = MonosemanticCatalog(args.catalog)
        try:
            result = dict(digest=catalog.register(concept))
        finally:
            catalog.close()
    else:
        from .runtime.explained_dataset import export_d4rl

        export_d4rl(args.dataset, args.output)
        result = dict(output=args.output)
    print(json.dumps(result, allow_nan=False))

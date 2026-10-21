"""Research workflows and consent-scoped local identity operations."""

from __future__ import annotations
import argparse
import importlib
import json
import os
from pathlib import Path
import sys

PHASES = {
    1: "01_linear_nullspace_audit",
    2: "02_jepa_latent_world",
    3: "03_continual_split_mnist",
    4: "04_planning_latent",
    5: "05_kernel_benchmark",
    6: "06_research_ablation",
    7: "07_brain_perception",
    8: "08_cognition",
    9: "09_identity_fidelity",
    10: "10_adaptive_capacity",
    11: "11_equilibrium_world",
    12: "12_energy_planning",
}


def main(argv=None):
    parser = argparse.ArgumentParser(prog="nova", description="NOVA research workflows")
    sub = parser.add_subparsers(dest="command", required=True)
    demo = sub.add_parser("demo")
    demo.add_argument("--ticks", type=int, default=100)
    demo.add_argument("--seed", type=int, default=0)
    demo.add_argument("--checkpoint", default="checkpoints/demo.npz")
    demo.add_argument("--resume")
    demo.add_argument("--world")
    demo.add_argument("--metrics", default="reports/demo.jsonl")
    demo.add_argument("--planning", action="store_true", default=None)
    demo.add_argument(
        "--profile", choices=["baseline", "adaptive", "brain"], default="baseline"
    )
    demo.add_argument("--config", help="YAML runtime configuration")
    demo.add_argument("--world-backend", choices=["torch", "equilibrium", "adex"])
    demo.add_argument("--planner", choices=["cem", "energy"])
    demo.add_argument(
        "--memory-policy", choices=["strict", "relax", "expand", "hybrid"]
    )
    demo.add_argument(
        "--online-learning", action=argparse.BooleanOptionalAction, default=None
    )
    train = sub.add_parser("train-world")
    train.add_argument("--output", default="checkpoints/world.npz")
    train.add_argument("--steps", type=int, default=900)
    train.add_argument("--seed", type=int, default=0)
    train.add_argument(
        "--backend", choices=["torch", "equilibrium", "adex"], default="torch"
    )
    train.add_argument("--train-encoder", action="store_true")
    bench = sub.add_parser("benchmark")
    bench.add_argument("phase", type=int, choices=PHASES)
    bench.add_argument("args", nargs=argparse.REMAINDER)
    dash = sub.add_parser("dashboard")
    dash.add_argument("--metrics", default="reports/demo.jsonl")
    dash.add_argument("--output", default="reports/dashboard.html")
    key = sub.add_parser("keygen")
    key.add_argument("--output", required=True)
    identity = sub.add_parser("identity")
    identity.add_argument(
        "action",
        choices=[
            "ingest",
            "inspect",
            "review",
            "answer",
            "timeline",
            "delete-source",
            "erase",
        ],
    )
    identity.add_argument("--directory", default="private/vault")
    identity.add_argument("--consent", default="private/consent.json")
    identity.add_argument("--subject", required=True)
    identity.add_argument("--actor", required=True)
    identity.add_argument("--key-file")
    identity.add_argument("--input")
    identity.add_argument("--predicate")
    identity.add_argument("--source-id")
    args = parser.parse_args(argv)
    if args.command == "train-world":
        from nova.training import train_world

        result = train_world(
            args.output,
            args.steps,
            args.seed,
            backend=args.backend,
            train_encoder=args.train_encoder,
        )
    elif args.command == "demo":
        import numpy as np
        from nova.runtime import CognitiveRuntime
        from nova.profiles import runtime_config
        from nova.environments import LinearPoint
        from nova.training import load_world

        if args.ticks < 1:
            parser.error("--ticks must be positive")
        overrides = {"seed": args.seed}
        if args.config:
            import yaml

            content = yaml.safe_load(Path(args.config).read_text())
            if not isinstance(content, dict):
                parser.error("configuration must be a mapping")
            overrides.update(content.get("runtime", content))
        for field, value in (
            ("planning", args.planning),
            ("world_backend", args.world_backend),
            ("planner_backend", args.planner),
            ("world_online_learning", args.online_learning),
        ):
            if value is not None:
                overrides[field] = value
        if args.memory_policy:
            overrides.update(adaptive_memory=True, memory_policy=args.memory_policy)
        runtime = (
            CognitiveRuntime.load(args.resume)
            if args.resume
            else CognitiveRuntime(runtime_config(args.profile, overrides))
        )
        if runtime.config.world_backend == "torch":
            import torch

            torch.set_num_threads(2)
        if runtime.config.observation_dim != 12 or runtime.config.action_dim != 2:
            parser.error(
                "the built-in LinearPoint demo requires observation_dim=12 and action_dim=2"
            )
        if args.world:
            load_world(runtime, args.world)
        env = LinearPoint(seed=args.seed)
        reward = 0.0
        if runtime.external_state:
            saved = runtime.external_state
            env.state = np.asarray(saved["state"])
            env.rng.bit_generator.state = saved["rng"]
            obs = np.asarray(saved["observation"])
            reward = saved["reward"]
        else:
            obs = env.reset()
        for _ in range(args.ticks):
            outcome = runtime.tick(obs, reward)
            obs, reward, _, _ = env.step(outcome["action"])
        runtime.external_state = {
            "state": env.state.tolist(),
            "rng": env.rng.bit_generator.state,
            "observation": obs.tolist(),
            "reward": reward,
        }
        runtime.save(args.checkpoint)
        Path(args.metrics).parent.mkdir(parents=True, exist_ok=True)
        runtime.write_metrics(args.metrics)
        result = {
            "profile": "resumed" if args.resume else args.profile,
            "world_backend": runtime.config.world_backend,
            "planner_backend": runtime.config.planner_backend,
            "adaptive_memory": runtime.config.adaptive_memory,
            "ticks": runtime.tick_index,
            "checkpoint": args.checkpoint,
            "metrics": args.metrics,
            "encoder": "loaded"
            if args.world
            else "checkpoint"
            if args.resume
            else "untrained demo",
            "last": runtime.metrics[-1],
        }
    elif args.command == "benchmark":
        original = sys.argv
        sys.argv = [original[0], *args.args]
        try:
            importlib.import_module("experiments." + PHASES[args.phase]).main()
        finally:
            sys.argv = original
        result = {"phase": args.phase, "report": f"reports/fase{args.phase}.md"}
    elif args.command == "dashboard":
        from nova.observability import dashboard

        dashboard(args.metrics, args.output)
        result = {"dashboard": args.output}
    elif args.command == "keygen":
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(os.urandom(32))
        result = {
            "key_file": str(path),
            "note": "Store securely; key bytes are never printed.",
        }
    else:
        from nova.identity import IdentityStore

        key_bytes = Path(args.key_file).read_bytes() if args.key_file else None
        store = IdentityStore(
            args.directory,
            args.consent,
            args.subject,
            args.actor,
            key_bytes,
            erasure_only=args.action in ("erase", "delete-source"),
        )
        if args.action == "ingest":
            if not args.input:
                parser.error("--input is required for ingest")
            result = store.ingest_file(args.input)
        elif args.action == "answer":
            if not args.predicate:
                parser.error("--predicate is required for answer")
            result = store.answer(args.predicate)
        elif args.action == "delete-source":
            if not args.source_id:
                parser.error("--source-id is required for delete-source")
            result = store.delete_source(args.source_id)
        else:
            result = getattr(store, args.action)()
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

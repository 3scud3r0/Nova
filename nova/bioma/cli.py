"""Explicit entry points for local Biocosm experiments and opt-in peer exchange."""

from __future__ import annotations
import argparse
import asyncio
from pathlib import Path
from .determinism import canonical_json, strict_json
from .presets import PRESETS, create_ecosystem


def main(argv=None):
    from nova.planetary_cli import COMMANDS, main as planetary_main

    if argv and argv[0] in COMMANDS:
        return planetary_main(argv)
    parser = argparse.ArgumentParser(
        prog="nova cosm",
        description="Experimental fields, organisms, reproducible seeds and scoped discovery",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("run", "serve", "render"):
        p = sub.add_parser(name)
        p.add_argument("--preset", choices=PRESETS, default="organisms")
        p.add_argument("--seed", type=int, default=0)
        p.add_argument("--size", type=int, default=32)
        p.add_argument("--dimensions", type=int, choices=(2, 3), default=3)
        p.add_argument("--population", type=int)
        p.add_argument(
            "--genome",
            help="local genome or evolution champion JSON for custom genesis",
        )
        p.add_argument(
            "--resume", help="local ecosystem checkpoint; not a remote executable"
        )
        if name == "run":
            p.add_argument("--ticks", type=int, default=100)
            p.add_argument("--output", default="runs/cosm")
            p.add_argument(
                "--tier",
                choices=("same_environment", "strict_integer"),
                default="same_environment",
            )
        if name == "serve":
            p.add_argument("--port", type=int, default=8765)
        if name == "render":
            p.add_argument("--output", default="runs/cosm.html")
            p.add_argument(
                "--kind", choices=("html", "volume", "slice"), default="html"
            )
            p.add_argument("--resolution", type=int, default=384)
    p = sub.add_parser("reproduce")
    p.add_argument("packet")
    p.add_argument("--output")
    p.add_argument("--max-ticks", type=int, default=10000)
    p.add_argument("--require-signature", action="store_true")
    p = sub.add_parser("discover")
    p.add_argument("--dataset", required=True)
    p.add_argument("--output", default="runs/candidate.json")
    p.add_argument("--target", choices=("du_dt", "dv_dt"), default="dv_dt")
    p.add_argument("--degree", type=int, default=3)
    p.add_argument("--max-terms", type=int, default=8)
    p = sub.add_parser("verify")
    p.add_argument("--variables", nargs="+", required=True)
    p.add_argument("--lhs", required=True)
    p.add_argument("--rhs", required=True)
    p.add_argument("--backend", choices=("exact", "z3", "lean"), default="exact")
    p.add_argument("--lean-project")
    p = sub.add_parser("evolve")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--population", type=int, default=4)
    p.add_argument("--generations", type=int, default=4)
    p.add_argument("--evaluations", type=int, default=16)
    p.add_argument("--ticks", type=int, default=32)
    p.add_argument("--output", default="runs/evolution.json")
    for name in ("node", "sync", "peer-id"):
        p = sub.add_parser(name)
        p.add_argument("--directory", default="runs/peer")
        p.add_argument(
            "--peers", help="local JSON list of pinned {peer_id,endpoint} objects"
        )
        if name == "node":
            p.add_argument("--host", default="127.0.0.1")
            p.add_argument("--port", type=int, default=8766)
            p.add_argument("--transport", choices=("tcp", "websocket"), default="tcp")
            p.add_argument("--certfile")
            p.add_argument("--keyfile")
        if name == "sync":
            p.add_argument("--peer-id", required=True)
    for command in sorted(COMMANDS):
        sub.add_parser(command, help="v0.4 planetary workflow")
    args = parser.parse_args(argv)
    if args.command in ("run", "serve", "render"):
        from .ecosystem import Ecosystem

        genomes = None
        if args.genome:
            if args.resume:
                parser.error("--genome sets genesis and cannot accompany --resume")
            content = strict_json(Path(args.genome).read_bytes())
            genomes = [content.get("champion", content)]
        eco = (
            Ecosystem.load(args.resume)
            if args.resume
            else create_ecosystem(
                args.preset,
                seed=args.seed,
                size=args.size,
                dimensions=args.dimensions,
                population=args.population,
                genesis_genomes=genomes,
            )
        )
        if args.command == "run":
            from .pipeline import run_and_export
            from nova.visuals import FieldRenderer

            result = run_and_export(eco, args.output, args.ticks, tier=args.tier)
            FieldRenderer.export_html(eco, Path(args.output) / "viewer.html")
            FieldRenderer.render(eco, Path(args.output) / "volume.png")
        elif args.command == "serve":
            from nova.visuals.server import serve

            serve(eco, port=args.port)
            return
        else:
            from nova.visuals import FieldRenderer

            result = (
                FieldRenderer.export_html(eco, args.output)
                if args.kind == "html"
                else FieldRenderer.render(
                    eco, args.output, kind=args.kind, resolution=args.resolution
                )
            )
    elif args.command == "reproduce":
        from nova.swarm.holoseed import HoloSeed

        eco, result = HoloSeed.reproduce(
            strict_json(Path(args.packet).read_bytes()),
            max_ticks=args.max_ticks,
            require_signature=args.require_signature,
        )
        if args.output:
            eco.save(args.output)
        if result["status"] != "matched":
            print(canonical_json(result).decode())
            raise SystemExit(2)
    elif args.command == "discover":
        from .pipeline import discover_dataset

        result = discover_dataset(
            args.dataset,
            args.output,
            target=args.target,
            degree=args.degree,
            max_terms=args.max_terms,
        )
    elif args.command == "verify":
        from nova.scientific.polynomial import Polynomial
        from nova.scientific.verification import PolynomialVerifier, Z3Verifier

        lhs = Polynomial.parse(args.lhs, args.variables)
        rhs = Polynomial.parse(args.rhs, args.variables)
        if args.backend == "lean":
            from nova.scientific.verifier_lean import LeanVerifier

            if not args.lean_project:
                parser.error("--lean-project is required for Lean")
            verifier = LeanVerifier(args.lean_project)
        else:
            verifier = PolynomialVerifier() if args.backend == "exact" else Z3Verifier()
        result = verifier.identity(lhs, rhs).to_dict()
    elif args.command == "evolve":
        from .evolution import ArchitectureSearch

        if not 1 <= args.ticks <= 512:
            parser.error("--ticks must be in [1,512]")

        def evaluate(genome, seed):
            eco = create_ecosystem(
                "organisms", seed=seed, size=16, genesis_genomes=[genome.state_dict()]
            )
            eco.step(args.ticks)
            energy = sum(o.energy for o in eco.organisms)
            return {
                "fitness": energy,
                "survivors": len(eco.organisms),
                "world_seed": seed,
                "ticks": args.ticks,
                "metric": "remaining synthetic resource energy",
            }

        result = ArchitectureSearch(args.seed, args.population, args.evaluations).run(
            evaluate, args.generations
        )
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(canonical_json(result))
        result = {k: v for k, v in result.items() if k != "champion"} | {
            "champion_artifact": str(out),
            "validation_used_for_selection": False,
        }
    else:
        from nova.swarm.artifacts import SigningIdentity, ArtifactStore
        from nova.swarm.p2p_node import Peer, PeerNode

        directory = Path(args.directory)
        identity = SigningIdentity.load_or_create(directory / "private" / "signing.key")
        peers = (
            []
            if not args.peers
            else [Peer(**p) for p in strict_json(Path(args.peers).read_bytes())]
        )
        node = PeerNode(identity, ArtifactStore(directory / "artifacts"), peers)
        if args.command == "peer-id":
            result = {"peer_id": identity.peer_id, "directory": str(directory)}
        elif args.command == "sync":
            result = asyncio.run(node.synchronize(args.peer_id))
        else:
            print(
                canonical_json(
                    {
                        "peer_id": identity.peer_id,
                        "host": args.host,
                        "port": args.port,
                        "transport": args.transport,
                    }
                ).decode(),
                flush=True,
            )
            try:
                asyncio.run(
                    node.serve(
                        args.host,
                        args.port,
                        certfile=args.certfile,
                        keyfile=args.keyfile,
                        transport=args.transport,
                    )
                )
            except KeyboardInterrupt:
                pass
            return
    print(canonical_json(result).decode())

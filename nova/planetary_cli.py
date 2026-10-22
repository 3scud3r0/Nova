"""v0.4 commands; network services, proof workers and GPU execution are explicit."""

from __future__ import annotations
import argparse
import asyncio
from pathlib import Path
import zipfile
import numpy as np
from nova.bioma.determinism import canonical_json, strict_json

COMMANDS = {
    "start",
    "join",
    "native",
    "nonlinear",
    "hamiltonian",
    "proof-daemon",
    "proof-submit",
    "challenge",
    "aggregate",
    "spore",
    "descriptor",
}


def read_arrays(path, names):
    with zipfile.ZipFile(path) as archive:
        if (
            len(archive.infolist()) > 8
            or sum(entry.file_size for entry in archive.infolist()) > 64 * 1024 * 1024
        ):
            raise ValueError("numerical input archive exceeds budget")
    with np.load(path, allow_pickle=False) as data:
        return [data[name].copy() for name in names]


def main(argv):
    parser = argparse.ArgumentParser(
        prog="nova cosm",
        description="Experimental planetary orchestration; no performance or universal-truth guarantee",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("start", "join"):
        p = sub.add_parser(name)
        p.add_argument(
            "--preset",
            default="organisms",
            choices=(
                "organisms",
                "ink",
                "lenia",
                "conway",
                "light",
                "particles",
                "fluid",
                "nca",
                "fixed",
            ),
        )
        p.add_argument("--seed", type=int, default=0)
        p.add_argument("--size", type=int, default=32)
        p.add_argument("--resume")
        p.add_argument("--crossover-rate", type=float, default=0.1)
        p.add_argument(
            "--signaling", action=argparse.BooleanOptionalAction, default=True
        )
        p.add_argument("--directory", default="runs/planetary")
        p.add_argument("--bootstrap", help="JSON list of signed peer descriptors")
        p.add_argument("--host", default="127.0.0.1")
        p.add_argument("--port", type=int, default=8766)
        p.add_argument(
            "--advertise",
            help="reachable signed endpoint; defaults to listener address/port",
        )
        p.add_argument("--allow-lan", action="store_true")
        p.add_argument("--mdns-ip")
        p.add_argument("--certfile")
        p.add_argument("--keyfile")
        p.add_argument("--transport", choices=("tcp", "websocket"), default="tcp")
        p.add_argument("--migration", action="store_true")
        p.add_argument("--validate-challenges", action="store_true")
        p.add_argument(
            "--ice-file",
            help="local STUN/TURN JSON; may contain private credentials, never shared",
        )
        p.add_argument("--lean-project")
        p.add_argument("--science", action=argparse.BooleanOptionalAction, default=True)
        p.add_argument("--max-ticks", type=int, default=10000)
        if name == "start":
            p.add_argument(
                "--backend", choices=("python", "rust", "webgpu"), default="python"
            )
            p.add_argument("--renderer", choices=("webgl", "webgpu"), default="webgpu")
            p.add_argument("--viewer-port", type=int, default=8765)
            p.add_argument("--open-browser", action="store_true")
        else:
            p.add_argument("--duration", type=int, default=3600)
    p = sub.add_parser("native")
    p.add_argument("--backend", choices=("rust", "webgpu"), default="rust")
    p.add_argument("--size", type=int, default=32)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--ticks", type=int, default=100)
    p.add_argument("--fluid", action="store_true")
    p.add_argument("--memory-mib", type=int, default=512)
    p.add_argument("--output", default="runs/native.npz")
    for name in ("nonlinear", "hamiltonian"):
        p = sub.add_parser(name)
        p.add_argument(
            "--input",
            required=True,
            help="bounded local NPZ with x,y or states,derivatives arrays",
        )
        p.add_argument("--variables", nargs="+", required=True)
        p.add_argument("--output", default=f"runs/{name}.json")
        if name == "hamiltonian":
            p.add_argument("--basis", nargs="+", required=True)
    for name in ("proof-daemon", "proof-submit"):
        p = sub.add_parser(name)
        p.add_argument("--directory", default="runs/planetary/science")
        p.add_argument("--lean-project")
        if name == "proof-daemon":
            p.add_argument("--once", action="store_true")
        else:
            p.add_argument("--lhs", required=True)
            p.add_argument("--rhs", required=True)
            p.add_argument("--variables", nargs="+", required=True)
    for name in ("challenge", "spore", "descriptor"):
        p = sub.add_parser(name)
        p.add_argument("--directory", default="runs/planetary")
        p.add_argument("--output", default=f"runs/{name}.json")
        if name == "descriptor":
            p.add_argument("--endpoint", required=True)
        if name == "spore":
            p.add_argument("--genome", required=True)
        if name == "challenge":
            p.add_argument("--lhs", required=True)
            p.add_argument("--rhs", default="0")
            p.add_argument("--variables", nargs="+", required=True)
            p.add_argument("--bounds", required=True, help="JSON [[lo,hi],...]")
            p.add_argument(
                "--kind",
                choices=("identity", "oscillator_invariant"),
                default="identity",
            )
            p.add_argument("--seed", type=int, default=0)
            p.add_argument("--samples", type=int, default=512)
            p.add_argument("--local", action="store_true")
        if name in ("challenge", "spore"):
            p.add_argument(
                "--send-peers",
                help="explicit bounded JSON peer list; up to 50 recipients",
            )
    p = sub.add_parser("aggregate")
    p.add_argument("--receipts", required=True)
    p.add_argument("--challenge", required=True)
    args = parser.parse_args(argv)
    if args.command in ("start", "join"):
        from .bioma.presets import create_ecosystem
        from .bioma.ecosystem import Ecosystem
        from .planetary import PlanetaryConfig, PlanetaryService

        if args.command == "start" and args.backend != "python":
            from .core.resident import ResidentSimulation, ResidentConfig

            if args.resume:
                parser.error(
                    "native snapshots are exports, not resumable ecosystem checkpoints"
                )
            eco = ResidentSimulation(ResidentConfig(args.size, args.seed, args.backend))
        else:
            eco = (
                Ecosystem.load(args.resume)
                if args.resume
                else create_ecosystem(
                    args.preset,
                    seed=args.seed,
                    size=args.size,
                    signaling=args.signaling,
                    crossover_rate=args.crossover_rate,
                )
            )
        if args.advertise is None:
            if args.host in ("0.0.0.0", "::"):
                parser.error(
                    "a wildcard listener requires an explicit reachable --advertise endpoint"
                )
            host = f"[{args.host}]" if ":" in args.host else args.host
            scheme = (
                ("wss" if args.certfile else "ws")
                if args.transport == "websocket"
                else ("tls" if args.certfile else "tcp")
            )
            args.advertise = f"{scheme}://{host}:{args.port}"
        config = PlanetaryConfig(
            **{
                name: getattr(args, name)
                for name in (
                    "directory",
                    "host",
                    "port",
                    "advertise",
                    "bootstrap",
                    "allow_lan",
                    "mdns_ip",
                    "certfile",
                    "keyfile",
                    "transport",
                    "migration",
                    "validate_challenges",
                    "ice_file",
                    "lean_project",
                    "science",
                    "max_ticks",
                )
            }
        )
        service = PlanetaryService(eco, config)
        try:
            if args.command == "start":
                from .visuals.holographic_canvas import start

                start(
                    eco,
                    port=args.viewer_port,
                    renderer=args.renderer,
                    planetary=service,
                    open_browser=args.open_browser,
                )
            else:
                if not 1 <= args.duration <= 86400:
                    parser.error("--duration must be in [1,86400]")
                try:
                    asyncio.run(service.run(args.duration))
                except KeyboardInterrupt:
                    pass
        finally:
            service.close()
            if hasattr(eco, "genesis_genomes"):
                with service.lock:
                    eco.save(Path(args.directory) / "ecosystem.npz")
            from .visuals.holographic_canvas import export_atlas

            export_atlas(service.atlas(), Path(args.directory) / "science_atlas.html")
        return
    if args.command == "native":
        from .core.resident import ResidentSimulation, ResidentConfig

        if not 1 <= args.ticks <= 1024 or not 1 <= args.memory_mib <= 8192:
            parser.error("native steps/memory budget exceeded")
        simulation = ResidentSimulation(
            ResidentConfig(
                args.size,
                args.seed,
                args.backend,
                args.fluid,
                args.memory_mib * 1024**2,
            )
        )
        simulation.step(args.ticks)
        result = {**simulation.save(args.output), "metrics": simulation.metrics()}
    elif args.command in ("nonlinear", "hamiltonian"):
        if args.command == "nonlinear":
            from .scientific.non_polynomial import NonPolynomialRegressor

            x, y = read_arrays(args.input, ["x", "y"])
            result = NonPolynomialRegressor().fit(x, y, args.variables)
        else:
            from .scientific.hamiltonian_search import HamiltonianSearch

            x, y = read_arrays(args.input, ["states", "derivatives"])
            result = HamiltonianSearch(args.variables, args.basis).fit(x, y)
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(canonical_json(result))
    elif args.command in ("proof-daemon", "proof-submit"):
        from .scientific.auto_lean import ProofDaemon

        worker = ProofDaemon(args.directory, lean_project=args.lean_project)
        if args.command == "proof-submit":
            result = {
                "job": worker.submit(args.lhs, args.rhs, args.variables),
                "status": "queued",
            }
        elif args.once:
            result = {"receipts": worker.process_once()}
        else:
            try:
                worker.run()
            except KeyboardInterrupt:
                worker.stop.set()
            return
    elif args.command == "aggregate":
        from .swarm.cross_validation import aggregate_attestations

        result = aggregate_attestations(
            strict_json(Path(args.receipts).read_bytes(), 4 * 1024 * 1024),
            args.challenge,
        )
    else:
        from .swarm.artifacts import SigningIdentity, ArtifactStore

        identity = SigningIdentity.load_or_create(
            Path(args.directory) / "private" / "signing.key"
        )
        store = ArtifactStore(Path(args.directory) / "artifacts")
        if args.command == "descriptor":
            from .swarm.dht_discovery import descriptor

            packet = descriptor(identity, args.endpoint)
        elif args.command == "spore":
            from .swarm.spore_migration import make_spore
            from .bioma.genetics import MorphogeneticCPPN

            content = strict_json(Path(args.genome).read_bytes())
            genome = MorphogeneticCPPN.from_state_dict(content.get("champion", content))
            packet = make_spore(identity, genome, {"peer": identity.peer_id})
        else:
            from .swarm.cross_validation import make_challenge, CrossValidationWorker

            packet = make_challenge(
                identity,
                args.lhs,
                args.rhs,
                args.variables,
                strict_json(args.bounds),
                kind=args.kind,
                seed=args.seed,
                samples=args.samples,
            )
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(canonical_json(packet))
        result = {"artifact": store.put_json(packet), "output": str(output)}
        if args.command == "challenge" and args.local:
            worker = CrossValidationWorker(identity)
            worker.enqueue(packet, identity.peer_id)
            result["local_evidence"] = worker.process_once()
        if args.command in ("challenge", "spore") and args.send_peers:
            from .swarm.p2p_node import Peer, PeerNode

            peers = [Peer(**p) for p in strict_json(Path(args.send_peers).read_bytes())]
            if not 1 <= len(peers) <= 50:
                raise ValueError("recipient budget is [1,50]")

            async def distribute():
                node = PeerNode(identity, store, peers)
                gate = asyncio.Semaphore(3)

                async def send(peer):
                    async with gate:
                        try:
                            return {
                                "peer": peer.peer_id,
                                "result": await node.request(
                                    peer.peer_id, args.command, packet
                                ),
                            }
                        except (
                            ValueError,
                            KeyError,
                            TypeError,
                            OSError,
                            asyncio.TimeoutError,
                        ) as error:
                            return {
                                "peer": peer.peer_id,
                                "status": "failed",
                                "error": type(error).__name__,
                            }

                return await asyncio.gather(*(send(peer) for peer in peers))

            result["recipients"] = asyncio.run(distribute())
    print(canonical_json(result).decode())

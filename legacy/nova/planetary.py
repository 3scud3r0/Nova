"""Opt-in bounded orchestration of a local biosphere, proof spool and peer mesh."""

from __future__ import annotations
import asyncio
from collections import deque
from dataclasses import dataclass
from pathlib import Path
import threading
import time
from .bioma.determinism import canonical_json, strict_json
from .bioma.macro_evolution import LineageArchive
from .swarm.artifacts import ArtifactStore, SigningIdentity, ScientificLedger, atomic
from .swarm.dht_discovery import DiscoveryTable, descriptor, LanDiscovery
from .swarm.p2p_node import PeerNode
from .swarm.spore_migration import SporeMigration, make_spore
from .swarm.cross_validation import CrossValidationWorker
from .scientific.auto_lean import ProofDaemon


@dataclass(frozen=True)
class PlanetaryConfig:
    directory: str = "runs/planetary"
    host: str = "127.0.0.1"
    port: int = 8766
    advertise: str = "tcp://127.0.0.1:8766"
    bootstrap: str | None = None
    allow_lan: bool = False
    mdns_ip: str | None = None
    certfile: str | None = None
    keyfile: str | None = None
    transport: str = "tcp"
    migration: bool = False
    validate_challenges: bool = False
    ice_file: str | None = None
    lean_project: str | None = None
    science: bool = True
    max_ticks: int = 10000
    tick_interval: float = 0.05

    def __post_init__(self):
        if (
            not 1 <= self.port <= 65535
            or not 1 <= self.max_ticks <= 100000
            or not 0.01 <= self.tick_interval <= 60
        ):
            raise ValueError("planetary service clock/port budget exceeded")
        if self.mdns_ip and not self.allow_lan:
            raise ValueError("mDNS requires explicit LAN admission")


class PlanetaryService:
    def __init__(self, ecosystem, config=PlanetaryConfig()):
        self.ecosystem = ecosystem
        self.config = config
        self.directory = Path(config.directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.identity = SigningIdentity.load_or_create(
            self.directory / "private" / "signing.key"
        )
        self.store = ArtifactStore(self.directory / "artifacts")
        self.discovery = DiscoveryTable(
            self.identity,
            descriptor(self.identity, config.advertise),
            allow_lan=config.allow_lan,
        )
        self.node = PeerNode(self.identity, self.store, discovery=self.discovery)
        self.node.migration = SporeMigration(self.identity, enabled=config.migration)
        self.node.cross_validation = (
            CrossValidationWorker(self.identity) if config.validate_challenges else None
        )
        self.proofs = ProofDaemon(
            self.directory / "science", lean_project=config.lean_project
        )
        self.archive = LineageArchive()
        self.lock = threading.RLock()
        self.shutdown = threading.Event()
        self.paused = False
        self.thread = None
        self.jobs = {}
        self._loop = None
        self._task = None
        self.probes = deque(maxlen=512)
        self.state = {
            "status": "created",
            "peer_id": self.identity.peer_id,
            "routing_peers": 0,
            "events": [],
            "discoveries": [],
            "migrations": [],
            "proofs": [],
        }
        self.recent_spores = set()
        self.ledger = None
        atomic(self.directory / "descriptor.json", canonical_json(self.discovery.own))

    def event(self, kind, body):
        record = {"kind": kind, **body}
        self.state["events"] = (self.state["events"] + [record])[-128:]
        if self.ledger:
            self.ledger.append(
                kind
                if kind
                in (
                    "discovery",
                    "lineage",
                    "peer_claim",
                    "verification",
                    "reproduction",
                )
                else "peer_claim",
                record,
            )

    def control(self, paused):
        if type(paused) is not bool:
            raise ValueError("paused must be boolean")
        self.paused = paused

    def atlas(self):
        with self.lock:
            return {
                **self.state,
                "routing_peers": len(self.node.routing.peers),
                "paused": self.paused,
                "simulation": self.ecosystem.metrics() if self.ecosystem else None,
                "communications": self.ecosystem.interpreter.report()
                if self.ecosystem and hasattr(self.ecosystem, "interpreter")
                else None,
                "ancestry": self.archive.snapshot(),
                "network_scope": "bounded self-signed peer discovery; no trusted global consensus",
                "attestations": list(
                    self.node.cross_validation.receipts.copy().values()
                )[-32:]
                if self.node.cross_validation
                else [],
            }

    def advance(self):
        with self.lock:
            eco = self.ecosystem
            if self.paused or eco is None or eco.world.tick >= self.config.max_ticks:
                return None
            world = eco.world
            before = None
            if hasattr(world, "laplacian") and world.config.mode in (
                "gray_scott",
                "hybrid",
            ):
                index = tuple(n // 2 for n in world.shape)
                before = (
                    float(world.u[index]),
                    float(world.v[index]),
                    float(world.laplacian(world.u)[index]),
                    float(world.laplacian(world.v)[index]),
                )
            eco.step()
            if before is not None:
                self.probes.append(
                    {
                        "features": before,
                        "target": float((world.v[index] - before[1]) / world.config.dt),
                        "tick": world.tick,
                    }
                )
            if hasattr(eco, "genesis_genomes"):
                if world.tick % 16 == 0:
                    self.archive.observe(eco)
                migration = self.node.migration.admit(eco)
            else:
                migration = None
            return migration

    def discover(self):
        if (
            len(self.probes) < 24
            or not self.ecosystem
            or not hasattr(self.ecosystem, "genesis_genomes")
        ):
            return None
        import numpy as np
        from .scientific.non_polynomial import NonPolynomialRegressor
        from .scientific.polynomial import Polynomial
        from .swarm.holoseed import HoloSeed
        from .scientific.dataset_synthesizer import DatasetSynthesizer

        with self.lock:
            rows = list(self.probes)
            packet = HoloSeed.pack(self.ecosystem, identity=self.identity)
            physics = self.ecosystem.world.config
        seed_digest = self.store.put_json(packet)
        dataset = DatasetSynthesizer(self.directory / "science" / "dataset")
        for row in rows[-64:]:
            dataset.append(
                row,
                seed_digest=seed_digest,
                units={"time": "nondimensional", "space": "grid cells"},
            )
        dataset.manifest()
        candidate = NonPolynomialRegressor().fit(
            np.asarray([r["features"] for r in rows]),
            np.asarray([r["target"] for r in rows]),
            ["u", "v", "lap_u", "lap_v"],
        )
        candidate["seed_artifact"] = seed_digest
        candidate["tick"] = rows[-1]["tick"]
        candidate["finite_difference_coupling_warning"] = True
        digest = self.store.put_json(self.identity.sign(candidate))
        atomic(
            self.directory / "science" / "latest_candidate.json",
            canonical_json(candidate),
        )
        # Only a candidate independently equal to the declared polynomial term can
        # become a proved identity. Transcendental candidates remain unproved.
        expected = (
            f"({physics.diffusion_v})*lap_v+u*v*v-({physics.feed}+{physics.kill})*v"
        )
        try:
            Polynomial.parse(candidate["expression"], candidate["variables"])
            job = self.proofs.submit(
                candidate["expression"],
                expected,
                candidate["variables"],
                model={
                    "physics_term": "continuous Gray-Scott dv; excludes coupling/integration"
                },
            )
            candidate["proof_job"] = job
        except (ValueError, SyntaxError):
            candidate["proof_status"] = "outside_polynomial_Lean_template"
        return {
            "artifact": digest,
            "expression": candidate["expression"],
            "heldout_mse": candidate["heldout_mse"],
            "formal_proof": False,
        }

    def spawn(self, name, operation):
        if name in self.jobs and not self.jobs[name].done():
            return False

        async def runner():
            try:
                await operation()
            except (
                ValueError,
                OSError,
                ImportError,
                KeyError,
                TypeError,
                asyncio.TimeoutError,
            ) as error:
                self.state[name + "_status"] = {
                    "status": "inconclusive",
                    "reason": type(error).__name__,
                }

        self.jobs[name] = asyncio.create_task(runner())
        return True

    async def mesh_job(self, seeds):
        self.discovery.own = descriptor(self.identity, self.config.advertise)
        atomic(self.directory / "descriptor.json", canonical_json(self.discovery.own))
        self.state["discovery"] = await self.discovery.discover(self.node, seeds)
        if self.node.webrtc:
            for peer in list(self.node.routing.peers)[:2]:
                if peer not in self.node.webrtc.connections:
                    try:
                        await self.node.webrtc.connect(peer)
                    except (
                        ValueError,
                        KeyError,
                        TypeError,
                        OSError,
                        asyncio.TimeoutError,
                    ):
                        pass
        atomic(
            self.directory / "peers.json",
            canonical_json(
                [
                    {"peer_id": p.peer_id, "endpoint": p.endpoint}
                    for p in self.node.routing.peers.values()
                ]
            ),
        )

    async def science_job(self):
        candidate = await asyncio.to_thread(self.discover)
        if candidate:
            self.state["discoveries"] = (self.state["discoveries"] + [candidate])[-128:]
            self.event("discovery", candidate)

    async def proof_job(self):
        proofs = await asyncio.to_thread(self.proofs.process_once)
        for proof in proofs:
            self.event("verification", proof)
        self.state["proofs"] = (self.state["proofs"] + proofs)[-128:]

    async def spore_job(self, tick):
        with self.lock:
            organisms = [
                o
                for o in self.ecosystem.organisms
                if o.age >= 64
                and o.energy >= 3
                and o.genome.hash() not in self.recent_spores
            ]
            organism = max(organisms, key=lambda o: o.energy, default=None)
            spore = (
                make_spore(
                    self.identity,
                    organism.genome,
                    {"tick": tick, "peer": self.identity.peer_id},
                )
                if organism
                else None
            )
        if spore:
            self.store.put_json(spore)
            self.recent_spores.add(spore["payload"]["genome_sha256"])
            for peer in list(self.node.routing.peers)[:3]:
                try:
                    await self.node.request(peer, "spore", spore)
                except (ValueError, KeyError, TypeError, OSError, asyncio.TimeoutError):
                    pass

    async def run(self, duration=None):
        self._loop = asyncio.get_running_loop()
        self._task = asyncio.current_task()
        config = self.config
        self.ledger = ScientificLedger(self.directory / "ledger.sqlite", self.identity)
        server = None
        lan = None
        started = time.monotonic()
        last_tick = -1
        next_proof = 0.0
        next_discovery = 0.0
        last_spore = -1
        try:
            if config.ice_file:
                from .swarm.webrtc_transport import WebRTCTransport

                ice = strict_json(Path(config.ice_file).read_bytes())
                self.node.webrtc = WebRTCTransport(self.node, ice)
            server = asyncio.create_task(
                self.node.serve(
                    config.host,
                    config.port,
                    certfile=config.certfile,
                    keyfile=config.keyfile,
                    transport=config.transport,
                )
            )
            await asyncio.sleep(0)
            if config.mdns_ip:
                lan = LanDiscovery(self.discovery.own)
                await lan.start(config.mdns_ip, config.port)
            bootstraps = (
                []
                if not config.bootstrap
                else strict_json(Path(config.bootstrap).read_bytes())
            )
            self.state["status"] = "running"
            print(
                canonical_json(
                    {
                        "NOVA": "planetary_experimental",
                        "peer_id": self.identity.peer_id,
                        "endpoint": config.advertise,
                    }
                ).decode(),
                flush=True,
            )
            while not self.shutdown.is_set() and (
                duration is None or time.monotonic() - started < duration
            ):
                if server.done():
                    await server
                now = time.monotonic()
                if now >= next_discovery:
                    seeds = bootstraps + ([] if not lan else lan.found[:32])
                    if self.spawn(
                        "mesh", lambda seeds=seeds: self.mesh_job(seeds[:32])
                    ):
                        bootstraps = []
                        if lan:
                            lan.found.clear()
                    next_discovery = now + 30
                migration = await asyncio.to_thread(self.advance)
                if migration:
                    self.state["migrations"] = (self.state["migrations"] + [migration])[
                        -64:
                    ]
                    self.event("lineage", migration)
                tick = self.ecosystem.world.tick if self.ecosystem else 0
                if tick != last_tick and tick % 64 == 0 and tick > 0:
                    if config.science:
                        self.spawn("science", self.science_job)
                    last_tick = tick
                if now >= next_proof:
                    self.spawn("proof", self.proof_job)
                    next_proof = now + 2
                if self.node.cross_validation:
                    for receipt in self.node.cross_validation.process_once():
                        self.store.put_json(receipt)
                        self.event("verification", {"attestation": receipt})
                if config.migration and self.ecosystem and tick - last_spore >= 256:
                    self.spawn("spore", lambda tick=tick: self.spore_job(tick))
                    last_spore = tick
                await asyncio.sleep(config.tick_interval)
        finally:
            self.state["status"] = "stopped"
            for task in self.jobs.values():
                task.cancel()
            await asyncio.gather(*self.jobs.values(), return_exceptions=True)
            if server:
                server.cancel()
                await asyncio.gather(server, return_exceptions=True)
            if lan:
                await lan.close()
            if self.node.webrtc:
                await self.node.webrtc.close()
            atomic(self.directory / "atlas.json", canonical_json(self.atlas()))
            self.ledger.close()
            self.ledger = None

    def start(self):
        def target():
            try:
                asyncio.run(self.run())
            except asyncio.CancelledError:
                pass
            except (ValueError, OSError, ImportError) as error:
                self.state["status"] = "error"
                self.state["error"] = str(error)[:512]

        self.thread = threading.Thread(
            target=target, daemon=True, name="nova-planetary"
        )
        self.thread.start()

    def close(self):
        self.shutdown.set()
        if self.thread:
            if self._loop and self._task and not self._task.done():
                self._loop.call_soon_threadsafe(self._task.cancel)
            self.thread.join(timeout=10)

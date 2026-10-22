"""Finite digital ecosystem with resource accounting and deterministic event order."""

from __future__ import annotations
from dataclasses import dataclass, asdict
import hashlib
import numpy as np
from nova.checkpoint import save_state, load_state
from .physics_engine import PhysicsConfig, PhysicsEngine
from .genetics import MorphogeneticCPPN, GeneRegulatoryNetwork
from .brains import DevelopedBrain
from .acoustics import AcousticChannel
from .linguistics import LewisAgent, SignalInterpreter
from .determinism import SplitMix64, canonical_json, digest_state


@dataclass(frozen=True)
class EcosystemConfig:
    initial_population: int = 4
    max_population: int = 32
    initial_energy: float = 3.0
    reproduction_energy: float = 6.0
    metabolic_rate: float = 0.002
    motor_cost: float = 0.005
    feeding_rate: float = 0.05
    food_yield: float = 4.0
    max_history: int = 2048
    neural_control: bool = True
    mutation_rate: float = 0.05
    signaling: bool = False
    crossover_rate: float = 0.0

    def __post_init__(self):
        if (
            not 0 <= self.initial_population <= self.max_population <= 256
            or not 1 <= self.max_history <= 8192
        ):
            raise ValueError("population/history budget exceeded")
        values = (
            self.initial_energy,
            self.reproduction_energy,
            self.metabolic_rate,
            self.motor_cost,
            self.feeding_rate,
            self.food_yield,
        )
        if (
            any(not np.isfinite(x) or x < 0 for x in values)
            or self.initial_energy <= 0
            or self.reproduction_energy <= 0
            or not 0 <= self.mutation_rate <= 1
            or not 0 <= self.crossover_rate <= 1
        ):
            raise ValueError("invalid resource parameters")


class Organism:
    def __init__(self, identifier, genome, position, energy, *, neural_control=True):
        self.id = identifier
        self.genome = genome
        self.position = np.asarray(position, dtype=float)
        self.velocity = np.zeros_like(self.position)
        self.energy = float(energy)
        self.age = 0
        self.body = genome.develop_body()
        self.grn = GeneRegulatoryNetwork(genome.grn)
        self.brain = (
            DevelopedBrain(genome, actions=len(self.position))
            if neural_control
            else None
        )
        self.language = LewisAgent(genome.seed)
        self.heard_context = None
        self.last_latent = np.zeros(8)
        self.neural_complexity = genome.develop_brain()["active_synapses"]

    def state_dict(self):
        return {
            "id": self.id,
            "genome": self.genome.state_dict(),
            "position": self.position.copy(),
            "velocity": self.velocity.copy(),
            "energy": self.energy,
            "age": self.age,
            "grn_expression": self.grn.expression.copy(),
            "body": self.body,
            "brain": None if self.brain is None else self.brain.state_dict(),
            "last_latent": self.last_latent.copy(),
            "language": self.language.state_dict(),
            "heard_context": self.heard_context,
        }

    @classmethod
    def from_state_dict(cls, state):
        obj = cls(
            state["id"],
            MorphogeneticCPPN.from_state_dict(state["genome"]),
            state["position"],
            state["energy"],
            neural_control=state["brain"] is not None,
        )
        obj.velocity = np.asarray(state["velocity"]).copy()
        obj.age = state["age"]
        obj.grn.expression = np.asarray(state["grn_expression"]).copy()
        obj.body = state["body"]
        obj.last_latent = np.asarray(state["last_latent"]).copy()
        obj.language = (
            LewisAgent.restore(state["language"])
            if "language" in state
            else obj.language
        )
        obj.heard_context = state.get("heard_context")
        if obj.brain:
            obj.brain.restore(state["brain"])
        return obj


class Ecosystem:
    """Organisms consume a chemical resource and spend a nondimensional energy proxy.

    Body morphology changes mass/drag/metabolic costs. Bodies are point masses
    with developed voxel appearance, not resolved muscle/soft-body mechanics.
    Reproduction transfers parent energy; metabolism is an explicit sink. This
    is digital selection over a grammar, not evidence of biological life.
    """

    protocol = "NOVA-ECOSYSTEM-v1"

    def __init__(
        self,
        physics: PhysicsConfig | None = None,
        config: EcosystemConfig | None = None,
        *,
        genesis_genomes=None,
    ):
        self.world = PhysicsEngine(physics)
        self.config = config or EcosystemConfig()
        self.rng = SplitMix64(self.world.config.seed ^ 0xCAFE)
        self.genesis_genomes = None
        if genesis_genomes is not None:
            if len(genesis_genomes) != self.config.initial_population:
                raise ValueError("genesis population mismatch")
            self.genesis_genomes = [
                MorphogeneticCPPN.from_state_dict(g).state_dict()
                for g in genesis_genomes
            ]
        self.acoustics = AcousticChannel(self.world.shape)
        self.interpreter = SignalInterpreter()
        self.signaling_success = 0
        self.migration_energy = 0.0
        self.organisms = []
        self.events = []
        self.history = []
        self.births = 0
        self.deaths = 0
        self.spent_energy = 0.0
        self.food_energy = 0.0
        for index in range(self.config.initial_population):
            seed = self.rng.next_u64()
            genome = (
                MorphogeneticCPPN(seed)
                if self.genesis_genomes is None
                else MorphogeneticCPPN.from_state_dict(self.genesis_genomes[index])
            )
            self.organisms.append(
                Organism(
                    self._id(genome),
                    genome,
                    self.rng.uniform((self.world.ndim,)) * np.asarray(self.world.shape),
                    self.config.initial_energy,
                    neural_control=self.config.neural_control,
                )
            )

    def _id(self, genome):
        return hashlib.sha256(
            canonical_json(
                {
                    "genome": genome.hash(),
                    "serial": self.births,
                    "initial_slot": len(self.organisms),
                    "tick": self.world.tick,
                }
            )
        ).hexdigest()[:24]

    def apply_event(self, event):
        # Only data operations, never source code/callback deserialization.
        if len(self.events) >= 10000:
            raise ValueError("event log budget exceeded")
        if event.get("tick") == self.world.tick and event.get("kind") == "immigrate":
            if len(self.organisms) >= self.config.max_population:
                raise ValueError("immigration exceeds population budget")
            genome = MorphogeneticCPPN.from_state_dict(event["genome"])
            if (
                genome.config.neural_nodes > 64
                or genome.config.max_n2 > 2
                or genome.config.body_resolution > 16
            ):
                raise ValueError("immigration development budget exceeded")
            position = np.asarray(event["position"], dtype=float)
            energy = float(event["energy"])
            if (
                position.shape != (self.world.ndim,)
                or not np.isfinite(position).all()
                or not 0 < energy <= 10
            ):
                raise ValueError("invalid immigrant position/energy")
            if len(canonical_json(event)) > 131072:
                raise ValueError("immigration event too large")
            self.births += 1
            organism = Organism(
                self._id(genome),
                genome,
                position % np.asarray(self.world.shape),
                energy,
                neural_control=self.config.neural_control,
            )
            self.organisms.append(organism)
            self.migration_energy += energy
            self.events.append(dict(event))
            return
        if event.get("tick") != self.world.tick or event.get("kind") not in (
            "inject",
            "impulse",
        ):
            raise ValueError("event tick/kind mismatch")
        position = np.asarray(event["position"], dtype=float)
        if position.shape != (self.world.ndim,) or not np.isfinite(position).all():
            raise ValueError("invalid event position")
        amount = float(event.get("amount", 0))
        if not np.isfinite(amount) or abs(amount) > 1:
            raise ValueError("event amplitude out of range")
        self.world.inject(
            position,
            nutrient=amount if event["kind"] == "inject" else 0.0,
            signal=amount if event["kind"] == "impulse" else 0.0,
        )
        self.events.append(dict(event))

    def _sensory(self, o):
        resource = float(self.world.sample(self.world.v, o.position[None])[0])
        signal = float(self.world.sample(self.world.wave, o.position[None])[0])
        flow = np.array(
            [self.world.sample(v, o.position[None])[0] for v in self.world.velocity]
        )
        position = o.position / np.asarray(self.world.shape)
        values = np.r_[
            position,
            o.velocity,
            flow,
            resource,
            signal,
            o.energy / self.config.reproduction_energy,
        ]
        return np.resize(np.tanh(values), 12), resource, flow

    def step(self, steps=1):
        if not isinstance(steps, int) or not 1 <= steps <= 10000:
            raise ValueError("invalid tick budget")
        c = self.config
        dt = self.world.config.dt
        for _ in range(steps):
            self.world.step()
            if c.signaling:
                lookup = {o.id: o for o in self.organisms}
                for pulse in self.acoustics.receive(self.world.tick, set(lookup)):
                    sender, receiver = (
                        lookup[pulse["sender"]],
                        lookup[pulse["receiver"]],
                    )
                    guess = receiver.language.interpret(pulse["token"])
                    context = pulse["context"]
                    reward = float(guess == context)
                    self.signaling_success += int(reward)
                    sender.language.reinforce(context, pulse["token"], guess, reward)
                    receiver.language.reinforce(context, pulse["token"], guess, reward)
                    receiver.heard_context = guess
                    self.interpreter.observe(pulse["token"], context)
                    # Bounded task reward is an explicit artificial energy source.
                    sender.energy += 0.0005 * reward
                    receiver.energy += 0.0005 * reward
            newborn = []
            survivors = []
            for o in sorted(self.organisms, key=lambda x: x.id):
                sensory, _, flow = self._sensory(o)
                expression = o.grn.step(sensory, dt=min(dt, 1.0))
                if o.brain:
                    action, o.last_latent = o.brain.step(
                        sensory, modulator=expression[0]
                    )
                else:
                    action = np.sin(o.position + o.age * 0.1 + o.genome.seed % 31)
                if c.signaling:
                    temperature = float(
                        self.world.sample(self.world.temperature, o.position[None])[0]
                    )
                    resource = float(
                        self.world.sample(self.world.v, o.position[None])[0]
                    )
                    context = self.interpreter.context(resource, temperature)
                    token = o.language.signal(context, self.world.tick)
                    previous = len(self.acoustics.pending)
                    spent = self.acoustics.emit(
                        o.id,
                        o.position,
                        token,
                        [(other.id, other.position) for other in self.organisms],
                        self.world.tick,
                    )
                    for pulse in self.acoustics.pending[previous:]:
                        pulse["context"] = context
                    o.energy -= spent
                    self.spent_energy += spent
                    if o.heard_context is not None:
                        # Decoded resource bin changes motor gain; token mapping is learned.
                        action = action * (0.8 if o.heard_context % 2 else 1.1)
                mass = 1 + o.body["mass_proxy"] / max(
                    1, o.genome.config.body_resolution**3
                )
                force = action * (0.25 + 0.75 * expression[1])
                drag = 0.2 + o.body["surface_proxy"] / max(
                    1, o.genome.config.body_resolution**3
                )
                o.velocity += dt * (force / mass + drag * (flow - o.velocity))
                o.position = (o.position + dt * o.velocity) % np.asarray(
                    self.world.shape
                )
                taken = self.world.consume(
                    o.position, c.feeding_rate * dt * (0.5 + expression[2])
                )
                gain = c.food_yield * taken
                cost = dt * (
                    c.metabolic_rate * mass
                    + c.motor_cost * float(action @ action)
                    + 0.00001 * o.neural_complexity
                )
                o.energy += gain - cost
                self.spent_energy += cost
                self.food_energy += gain
                o.age += 1
                # Reaction to drag is deposited on the field; nearest-cell coupling
                # is approximate, so exact momentum conservation is not claimed.
                self.world.inject(
                    o.position,
                    heat=cost,
                    signal=0.005 * action.mean() * expression[3],
                    impulse=-dt * drag * (flow - o.velocity),
                )
                if o.energy <= 0:
                    self.deaths += 1
                    self.world.inject(o.position, nutrient=min(0.2, mass * 0.01))
                    continue
                if (
                    o.energy >= c.reproduction_energy
                    and len(self.organisms) + len(newborn) < c.max_population
                ):
                    child_genome = o.genome.mutate(self.rng.next_u64(), c.mutation_rate)
                    if (
                        c.crossover_rate
                        and self.rng.uniform((1,))[0] < c.crossover_rate
                    ):
                        from .macro_evolution import crossover

                        mates = [
                            other
                            for other in self.organisms
                            if other.id != o.id
                            and other.energy > 0
                            and other.genome.config == o.genome.config
                        ]
                        if mates:
                            mate = mates[int(self.rng.integers(0, len(mates), (1,))[0])]
                            child_genome = crossover(
                                o.genome, mate.genome, self.rng.next_u64()
                            ).mutate(self.rng.next_u64(), c.mutation_rate)
                            child_genome.parents = [o.genome.hash(), mate.genome.hash()]
                            child_genome.generation = (
                                max(o.genome.generation, mate.genome.generation) + 1
                            )
                    energy = o.energy * 0.5
                    o.energy -= energy
                    self.births += 1
                    newborn.append(
                        Organism(
                            self._id(child_genome),
                            child_genome,
                            (
                                o.position
                                + self.rng.uniform((self.world.ndim,), -0.1, 0.1)
                            )
                            % np.asarray(self.world.shape),
                            energy,
                            neural_control=c.neural_control,
                        )
                    )
                survivors.append(o)
            self.organisms = (survivors + newborn)[: c.max_population]
            self.history.append(self.metrics())
            self.history = self.history[-c.max_history :]
        return self.metrics()

    def metrics(self):
        return {
            **self.world.metrics(),
            "population": len(self.organisms),
            "births": self.births,
            "deaths": self.deaths,
            "organism_energy": float(sum(o.energy for o in self.organisms)),
            "metabolic_sink": self.spent_energy,
            "food_energy": self.food_energy,
            "signaling_events": self.interpreter.events,
            "signaling_success": self.signaling_success,
            "signaling_reward_energy": 0.001 * self.signaling_success,
            "migration_energy": self.migration_energy,
            "genetic_diversity": len({o.genome.hash() for o in self.organisms}),
        }

    def observation_rows(self):
        rows = []
        for o in sorted(self.organisms, key=lambda x: x.id):
            rows.append(
                {
                    "tick": self.world.tick,
                    "organism": o.id,
                    "genome": o.genome.hash(),
                    "position": o.position.tolist(),
                    "velocity": o.velocity.tolist(),
                    "energy": o.energy,
                    "latent": o.last_latent.tolist(),
                    "neural_nodes": o.genome.config.neural_nodes,
                }
            )
        return rows

    def state_dict(self):
        return {
            "kind": self.protocol,
            "genesis_genomes": self.genesis_genomes,
            "world": self.world.state_dict(),
            "config": asdict(self.config),
            "rng": self.rng.state,
            "organisms": [o.state_dict() for o in self.organisms],
            "events": self.events,
            "history": self.history,
            "births": self.births,
            "deaths": self.deaths,
            "spent_energy": self.spent_energy,
            "food_energy": self.food_energy,
            "acoustics": self.acoustics.state_dict(),
            "interpreter": self.interpreter.state_dict(),
            "signaling_success": self.signaling_success,
            "migration_energy": self.migration_energy,
        }

    def save(self, path):
        save_state(path, self.state_dict())

    @classmethod
    def from_state_dict(cls, state):
        if state.get("kind") != cls.protocol:
            raise ValueError("unknown ecosystem format")
        wc = state["world"]["config"].copy()
        wc["shape"] = tuple(wc["shape"])
        wc["birth"] = tuple(wc["birth"])
        wc["survive"] = tuple(wc["survive"])
        cfg = EcosystemConfig(**state["config"])
        empty = asdict(cfg)
        empty["initial_population"] = 0
        obj = cls(PhysicsConfig(**wc), EcosystemConfig(**empty))
        obj.genesis_genomes = state.get("genesis_genomes")
        obj.config = cfg
        obj.world = PhysicsEngine.from_state_dict(state["world"])
        obj.rng.state = state["rng"]
        if len(state["organisms"]) > cfg.max_population:
            raise ValueError("population checkpoint exceeds budget")
        obj.organisms = [Organism.from_state_dict(s) for s in state["organisms"]]
        for key in (
            "events",
            "history",
            "births",
            "deaths",
            "spent_energy",
            "food_energy",
        ):
            setattr(obj, key, state[key])
        if "acoustics" in state:
            obj.acoustics = AcousticChannel.restore(state["acoustics"])
        if "interpreter" in state:
            obj.interpreter = SignalInterpreter.restore(state["interpreter"])
        obj.signaling_success = state.get("signaling_success", 0)
        obj.migration_energy = state.get("migration_energy", 0.0)
        return obj

    @classmethod
    def load(cls, path):
        return cls.from_state_dict(load_state(path))

    def state_hash(self):
        return digest_state(self.state_dict())

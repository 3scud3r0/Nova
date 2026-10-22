"""Developed mixed neural graph: rates, AdEx, HH and Boolean units actually step."""

from __future__ import annotations
import numpy as np
from nova.neuron import AdExPopulation, HodgkinHuxleyCompartments
from nova.jepa.equilibrium import EquilibriumWorldModel
from nova.continual import AdaptiveSubspaceLinear, AdaptiveConfig
from .genetics import MorphogeneticCPPN
from .determinism import SplitMix64


class DevelopedBrain:
    def __init__(self, genome: MorphogeneticCPPN, sensors=12, actions=3):
        self.topology = genome.develop_brain()
        self.n = len(self.topology["types"])
        self.sensors, self.actions = sensors, actions
        rng = SplitMix64(genome.seed)
        self.sensory_projection = rng.uniform((sensors, self.n), -0.5, 0.5)
        self.motor_projection = rng.uniform((self.n, actions), -0.5, 0.5)
        self.latent_projection = rng.uniform((self.n, 8), -0.25, 0.25)
        self.activation = np.zeros(self.n)
        self.adex = AdExPopulation(self.n, seed=genome.seed)
        self.adex.types = self.topology["types"].copy()
        self.adex.tau = np.choose(self.adex.types, [200.0, 30.0, 250.0, 150.0])
        self.adex.a = np.choose(self.adex.types, [2.0, 0.0, 4.0, 2.0])
        self.adex.b = np.choose(self.adex.types, [40.0, 0.0, 80.0, 20.0])
        self.hh = {
            int(i): HodgkinHuxleyCompartments(1)
            for i in np.flatnonzero(self.topology["families"] == 2)
        }
        self.world = EquilibriumWorldModel(sensors, 8, actions, seed=genome.seed)
        self.world.freeze_encoder()
        self.memory = AdaptiveSubspaceLinear(
            8,
            8,
            seed=genome.seed,
            config=AdaptiveConfig(
                max_features=32, max_state_bytes=1024 * 1024, growth_step=8
            ),
        )
        self.previous_latent = None
        self.previous_action = np.zeros(actions)
        self.ticks = 0
        self.last_error = 0.0
        self.resource_readout = np.zeros(9)
        self.planning_weight = 0.0

    def step(self, sensory, modulator=0.0):
        sensory = np.asarray(sensory, dtype=float)
        if sensory.shape != (self.sensors,) or not np.isfinite(sensory).all():
            raise ValueError("invalid organism sensors")
        current = (
            self.activation @ self.topology["weights"]
            + sensory @ self.sensory_projection
        )
        rate = 0.5 + 0.5 * np.tanh(current)
        spikes, _ = self.adex.step((300 + 50 * np.tanh(current), 0.0), dt=0.1)
        output = rate.copy()
        families = self.topology["families"]
        output[families == 1] = spikes[families == 1]
        for index, neuron in self.hh.items():
            fired = False
            for _ in range(10):
                fired = (
                    bool(
                        neuron.step(
                            (10 + float(np.clip(current[index], -20, 20)), 0.0), dt=0.01
                        )[0][0]
                    )
                    or fired
                )
            output[index] = float(fired)
        for index in np.flatnonzero(families == 3):
            inputs = self.activation[self.topology["weights"][:, index] != 0] > 0.5
            gate = int(index) % 4
            output[index] = float(
                inputs.all()
                if gate == 0 and len(inputs)
                else inputs.any()
                if gate == 1
                else np.count_nonzero(inputs) % 2
                if gate == 2
                else not inputs.any()
            )
        self.activation = np.clip(0.9 * self.activation + 0.1 * output, 0, 1)
        latent = np.tanh(self.activation @ self.latent_projection)
        action = np.tanh((self.activation - 0.5) @ self.motor_projection)
        if self.previous_latent is not None:
            prediction = self.world.predict(
                self.previous_latent[None], self.previous_action[None]
            )[0]
            self.last_error = float(np.mean((prediction - latent) ** 2))
            self.world.learn_latent(
                self.previous_latent[None],
                self.previous_action[None],
                latent[None],
                lr=0.001,
            )
            self.memory.step(
                self.memory.encode(self.previous_latent[None]), latent[None], lr=0.001
            )
        resource_features = np.r_[latent, 1.0]
        residual = float(sensory[-1] - resource_features @ self.resource_readout)
        self.resource_readout += (
            0.01
            * np.clip(residual, -1, 1)
            * resource_features
            / (1 + resource_features @ resource_features)
        )
        # Learned equilibrium forecasts participate in the action path. This is
        # a bounded one-step heuristic, not a demonstrated optimal controller.
        if self.ticks >= 8:
            candidates = np.clip(
                np.vstack(
                    (
                        action,
                        np.zeros(self.actions),
                        action + 0.25 * np.eye(self.actions),
                        action - 0.25 * np.eye(self.actions),
                    )
                ),
                -1,
                1,
            )
            future = self.world.predict(
                np.repeat(latent[None], len(candidates), axis=0), candidates
            )
            value = (
                future @ self.resource_readout[:8]
                + self.resource_readout[8]
                - 0.01 * np.sum(candidates * candidates, axis=1)
            )
            self.planning_weight = 0.25 / (1 + 100 * self.last_error)
            action = (
                1 - self.planning_weight
            ) * action + self.planning_weight * candidates[int(np.argmax(value))]
        self.ticks += 1
        self.memory.age(1.0, consolidation=float(np.clip(modulator, 0, 1)) * 0.01)
        if self.ticks % 32 == 0:
            self.memory.consolidate(self.memory.encode(latent[None]))
            self.memory.manage_capacity()
        self.previous_latent = latent
        self.previous_action = action.copy()
        return action, latent

    def state_dict(self):
        return {
            "topology": self.topology,
            "activation": self.activation.copy(),
            "adex": self.adex.state_dict(),
            "hh": {
                str(i): {"v": n.v.copy(), "gates": n.gates.copy()}
                for i, n in self.hh.items()
            },
            "world": self.world.state_dict(),
            "memory": self.memory.state_dict(),
            "previous_latent": self.previous_latent,
            "previous_action": self.previous_action,
            "ticks": self.ticks,
            "last_error": self.last_error,
            "resource_readout": self.resource_readout.copy(),
            "planning_weight": self.planning_weight,
        }

    def restore(self, state):
        self.topology = {
            k: np.asarray(v) if k != "active_synapses" else v
            for k, v in state["topology"].items()
        }
        self.activation = np.asarray(state["activation"]).copy()
        self.adex.load_state_dict(state["adex"])
        for key, value in state["hh"].items():
            self.hh[int(key)].v = np.asarray(value["v"]).copy()
            self.hh[int(key)].gates = np.asarray(value["gates"]).copy()
        self.world = EquilibriumWorldModel.from_state_dict(state["world"])
        self.memory = AdaptiveSubspaceLinear.from_state_dict(state["memory"])
        self.previous_latent = state["previous_latent"]
        self.previous_action = np.asarray(state["previous_action"]).copy()
        self.ticks = state["ticks"]
        self.last_error = state["last_error"]
        self.resource_readout = np.asarray(state["resource_readout"]).copy()
        self.planning_weight = state["planning_weight"]

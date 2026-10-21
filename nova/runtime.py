"""Stateful research cycle; deterministic snapshots exclude identity stores and keys."""

from __future__ import annotations
from dataclasses import dataclass, asdict
import json
from pathlib import Path
from time import perf_counter
import numpy as np
import torch
from torch import nn
from nova.jepa import JEPA
from nova.continual import ProtectedLinear
from nova.memory import (
    SensoryBuffer,
    WorkingMemory,
    EpisodicMemory,
    Episode,
    SemanticGraph,
)
from nova.synapse import DiffusiveCascade
from nova.neuromod import Neuromodulator
from nova.planning import LatentPlanner
from nova.values import InternalState


@dataclass
class RuntimeConfig:
    seed: int = 0
    observation_dim: int = 12
    latent_dim: int = 8
    action_dim: int = 2
    memory_capacity: int = 128
    sleep_every: int = 100
    tick_budget_ms: float = 100.0
    planning: bool = False
    neuromodulation: bool = False
    deterministic: bool = True


class CognitiveRuntime:
    """Perceive -> predict -> evaluate -> recall -> decide -> learn -> periodic sleep.

    Default demo encoders are untrained. Load a trained world model for scientific
    use. Encoder coordinates are frozen while protected memory learns online.
    Optional hypotheses are not silently enabled by this integration harness.
    """

    def __init__(self, config: RuntimeConfig | None = None):
        self.config = config or RuntimeConfig()
        c = self.config
        if (
            min(
                c.observation_dim,
                c.latent_dim,
                c.action_dim,
                c.memory_capacity,
                c.sleep_every,
            )
            < 1
            or c.tick_budget_ms <= 0
        ):
            raise ValueError("invalid runtime config")
        self.rng = np.random.default_rng(c.seed)
        with torch.random.fork_rng():
            torch.manual_seed(c.seed)
            self.world = JEPA(c.observation_dim, c.latent_dim, c.action_dim)
            self.policy = nn.Sequential(
                nn.Linear(c.latent_dim, 32),
                nn.Tanh(),
                nn.Linear(32, c.action_dim),
                nn.Tanh(),
            )
        self.world.context.requires_grad_(False)
        self.world.target.requires_grad_(False)
        self.continual = ProtectedLinear(c.latent_dim, c.latent_dim, seed=c.seed)
        self.cascade = DiffusiveCascade(c.latent_dim)
        self.mod = (
            Neuromodulator() if c.neuromodulation else Neuromodulator(frozenset())
        )
        self.internal = InternalState()
        self.sensory = SensoryBuffer()
        self.working = WorkingMemory(dimensions=c.latent_dim)
        self.episodic = EpisodicMemory(c.memory_capacity)
        self.semantic = SemanticGraph()
        self.rest = self.rng.normal(0, 0.03, c.latent_dim)
        self.z = self.rest.copy()
        self.prediction = self.rest.copy()
        self.last_action = np.zeros(c.action_dim)
        self.tick_index = 0
        self.previous_observation = None
        self.metrics = []
        self.external_state = {}
        self.planner = LatentPlanner(
            self.predict,
            self.cost,
            c.action_dim,
            seed=c.seed,
            rollouts=64,
            horizon=6,
            iterations=3,
        )

    def predict(self, z, a):
        with torch.no_grad():
            return self.world.predictor(
                torch.as_tensor(z, dtype=torch.float32),
                torch.as_tensor(a, dtype=torch.float32),
            ).numpy()

    @staticmethod
    def cost(z):
        return np.sum(z * z, axis=-1)

    def tick(self, observation=None, reward=0.0):
        start = perf_counter()
        previous = self.z.copy()
        self.tick_index += 1
        idle = observation is None
        if idle:
            self.z = 0.99 * self.z + 0.01 * self.rest
        else:
            observation = np.asarray(observation, dtype=np.float32)
            if (
                observation.shape != (self.config.observation_dim,)
                or not np.isfinite(observation).all()
            ):
                raise ValueError("invalid observation")
            self.sensory.append(observation.copy())
            with torch.no_grad():
                self.z = (
                    self.world.context(torch.from_numpy(observation))
                    .numpy()
                    .astype(float)
                )
        error = float(np.mean((self.z - self.prediction) ** 2))
        uncertainty = float(np.clip(error, 0, 1))
        self.mod.update(
            error, reward, -self.cost(previous), -self.cost(self.z), uncertainty
        )
        recalled = self.episodic.retrieve(self.z, limit=1)
        context = self.z if not recalled else 0.9 * self.z + 0.1 * recalled[0].embedding
        self.working.update(context)
        slow = (
            not idle
            and self.config.planning
            and (uncertainty > 0.1 or self.mod.surprise > 0.5)
            and self.internal.energy > 0.1
        )
        if idle:
            action = np.zeros(self.config.action_dim)
            mode = "idle"
        elif slow:
            result = self.planner.plan(
                context,
                None if self.config.deterministic else self.config.tick_budget_ms * 0.7,
            )
            action = result.action
            mode = "deliberate"
            optimizer = torch.optim.SGD(self.policy.parameters(), lr=0.001)
            loss = (
                (
                    self.policy(torch.tensor(context, dtype=torch.float32))
                    - torch.tensor(action, dtype=torch.float32)
                )
                .square()
                .mean()
            )
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        else:
            with torch.no_grad():
                action = (
                    self.policy(torch.tensor(context, dtype=torch.float32))
                    .numpy()
                    .astype(float)
                )
            mode = "fast"
        if not idle:
            self.continual.step(
                previous[None], self.z[None], self.mod.learning_rate(0.001)
            )
            self.cascade.step(np.full(self.config.latent_dim, error), dt=0.1)
            self.episodic.threshold = self.mod.write_threshold(0.05)
            self.episodic.write(
                Episode(
                    str(self.tick_index),
                    self.z.copy(),
                    f"observation at tick {self.tick_index}",
                    f"sensor:{self.tick_index}",
                    f"{self.tick_index:012d}",
                    surprise=error,
                    valence=self.internal.valence,
                )
            )
            self.previous_observation = observation.copy()
        self.last_action = action.copy()
        self.prediction = self.predict(self.z[None], action[None])[0]
        # Deterministic resource proxy; wall latency is observational, never checkpoint semantics.
        self.internal.update(
            error,
            0.8 if slow else 0.1,
            len(self.episodic.episodes) / self.config.memory_capacity,
            reward,
        )
        if self.tick_index % self.config.sleep_every == 0:
            self.sleep()
        elapsed = (perf_counter() - start) * 1000
        metric = dict(
            tick=self.tick_index,
            mode=mode,
            error=error,
            free_dims=self.continual.free_dims,
            memory=len(self.episodic.episodes),
            latency_ms=elapsed,
            budget_exceeded=elapsed > self.config.tick_budget_ms,
            energy=self.internal.energy,
        )
        self.metrics.append(metric)
        return {
            "action": action,
            "mode": mode,
            "latent": self.z.copy(),
            "metrics": metric,
        }

    def sleep(self):
        def learn(episode):
            self.semantic.add(
                episode.id,
                "observed",
                episode.content,
                episode.source,
                timestamp=episode.timestamp,
            )

        self.episodic.sleep(learn)
        if self.episodic.episodes:
            self.continual.consolidate(
                np.stack([e.embedding for e in self.episodic.episodes])
            )
        self.cascade.consolidate(self.mod.consolidation() * 0.01)
        self.internal.sleep()

    def save(self, path):
        """NPZ + JSON only, no executable pickle; all mutable integration state included."""
        arrays = {
            f"world.{k}": v.detach().numpy() for k, v in self.world.state_dict().items()
        }
        arrays.update(
            {
                f"policy.{k}": v.detach().numpy()
                for k, v in self.policy.state_dict().items()
            }
        )
        for key in ("W_base", "dW", "U", "singular_values", "last_update"):
            arrays[f"continual.{key}"] = getattr(self.continual, key)
        for key in ("z", "prediction", "rest", "last_action"):
            arrays[key] = getattr(self, key)
        arrays["cascade"] = self.cascade.state
        arrays["working"] = self.working.state
        mod = asdict(self.mod)
        mod["enabled"] = sorted(mod["enabled"])
        episodes = [
            {**asdict(e), "embedding": e.embedding.tolist()}
            for e in self.episodic.episodes
        ]
        metadata = dict(
            version=1,
            config=asdict(self.config),
            tick=self.tick_index,
            rng=self.rng.bit_generator.state,
            planner_rng=self.planner.rng.bit_generator.state,
            mod=mod,
            internal=asdict(self.internal),
            episodes=episodes,
            facts=self.semantic.facts,
            working_cursor=self.working.cursor,
            sensory=[x.tolist() for x in self.sensory],
            previous_observation=None
            if self.previous_observation is None
            else self.previous_observation.tolist(),
            episodic_threshold=self.episodic.threshold,
            metrics=self.metrics,
            external_state=self.external_state,
        )
        arrays["metadata"] = np.array(json.dumps(metadata, allow_nan=False))
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as stream:
            np.savez_compressed(stream, **arrays)

    @classmethod
    def load(cls, path):
        with np.load(path, allow_pickle=False) as arrays:
            meta = json.loads(str(arrays["metadata"]))
            if meta["version"] != 1:
                raise ValueError("unsupported checkpoint version")
            obj = cls(RuntimeConfig(**meta["config"]))
            for name, module in [("world", obj.world), ("policy", obj.policy)]:
                module.load_state_dict(
                    {
                        k: torch.from_numpy(arrays[f"{name}.{k}"].copy())
                        for k in module.state_dict()
                    }
                )
            for key in ("W_base", "dW", "U", "singular_values", "last_update"):
                setattr(obj.continual, key, arrays[f"continual.{key}"].copy())
            obj.continual.W_base.flags.writeable = False
            for key in ("z", "prediction", "rest", "last_action"):
                setattr(obj, key, arrays[key].copy())
            obj.cascade.state = arrays["cascade"].copy()
            obj.working.state = arrays["working"].copy()
            obj.working.cursor = meta["working_cursor"]
            obj.tick_index = meta["tick"]
            obj.rng.bit_generator.state = meta["rng"]
            obj.planner.rng.bit_generator.state = meta["planner_rng"]
            meta["mod"]["enabled"] = frozenset(meta["mod"]["enabled"])
            obj.mod = Neuromodulator(**meta["mod"])
            obj.internal = InternalState(**meta["internal"])
            obj.episodic.episodes = [
                Episode(
                    **{
                        **e,
                        "embedding": np.asarray(e["embedding"]),
                        "participants": tuple(e["participants"]),
                    }
                )
                for e in meta["episodes"]
            ]
            obj.episodic.threshold = meta["episodic_threshold"]
            obj.semantic.facts = meta["facts"]
            obj.sensory.extend(np.asarray(x, dtype=np.float32) for x in meta["sensory"])
            obj.previous_observation = (
                None
                if meta["previous_observation"] is None
                else np.asarray(meta["previous_observation"], dtype=np.float32)
            )
            obj.metrics = meta["metrics"]
            obj.external_state = meta.get("external_state", {})
            return obj

    def write_metrics(self, path):
        Path(path).write_text("".join(json.dumps(m) + "\n" for m in self.metrics))

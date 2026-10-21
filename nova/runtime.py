"""Integrated cognitive cycle with optional adaptive memory and physical latent inference."""

from __future__ import annotations
from collections import deque
from dataclasses import dataclass, asdict, replace
import json
from pathlib import Path
from time import perf_counter
import numpy as np
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
from nova.values.progress import LearningProgress
from nova.checkpoint import save_state, load_state, CheckpointFormatError


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
    world_backend: str = "torch"
    world_online_learning: bool = False
    adaptive_memory: bool = False
    memory_policy: str = "hybrid"
    memory_growth: int = 8
    max_memory_features: int = 128
    memory_reserve: float = 0.2
    max_memory_bytes: int = 32 * 1024 * 1024
    planner_backend: str = "cem"
    planner_horizon: int = 6
    planner_iterations: int = 3
    planner_rollouts: int = 64
    solver_max_calls: int = 512
    sheaf_weight: float = 0.0
    spiking_units: int = 100
    spiking_steps: int = 100
    spiking_backend: str = "numpy"
    spiking_plasticity: bool = False
    history_limit: int = 2048
    goal_latent: list[float] | None = None
    state_lower: list[float] | None = None
    state_upper: list[float] | None = None

    def __post_init__(self):
        if (
            min(
                self.observation_dim,
                self.latent_dim,
                self.action_dim,
                self.memory_capacity,
                self.sleep_every,
                self.history_limit,
                self.planner_horizon,
                self.planner_iterations,
                self.planner_rollouts,
                self.spiking_units,
                self.spiking_steps,
            )
            < 1
        ):
            raise ValueError("dimensions and budgets must be positive")
        if not np.isfinite(self.tick_budget_ms) or self.tick_budget_ms <= 0:
            raise ValueError("invalid time budget")
        if self.world_backend not in (
            "torch",
            "equilibrium",
            "adex",
        ) or self.planner_backend not in ("cem", "energy"):
            raise ValueError("unknown world/planner backend")
        if self.spiking_plasticity and self.world_backend != "adex":
            raise ValueError("spiking plasticity requires AdEx backend")
        if self.world_online_learning and self.world_backend == "torch":
            raise ValueError(
                "online world learning is provided by the local EqProp backends"
            )


class _Dynamics:
    def __init__(self, runtime):
        self.runtime = runtime

    def predict(self, z, a):
        return self.runtime.predict(z, a)

    def linearize(self, z, a):
        return self.runtime.linearize(z, a)


class CognitiveRuntime:
    """Versioned memory + real latent backend + amortized/energy-based control.

    Baseline behavior remains selectable. Adaptive and physical backends are
    experimental and unbenchmarked in this revision. Encoders are frozen for
    online rate-model training. A stateful AdEx representation has history
    dependence; stored-activation protection is not raw-observation retention.
    """

    def __init__(self, config: RuntimeConfig | None = None):
        self.config = config or RuntimeConfig()
        c = self.config
        self.rng = np.random.default_rng(c.seed)
        if c.world_backend == "torch":
            import torch
            from torch import nn
            from nova.jepa import JEPA

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
        else:
            from nova.jepa.equilibrium import EquilibriumWorldModel
            from nova.brain.latent import SpikingWorldModel
            from nova.reasoning.local_policy import LocalPolicy

            if c.world_backend == "adex":
                self.world = SpikingWorldModel(
                    c.observation_dim,
                    c.latent_dim,
                    c.action_dim,
                    seed=c.seed,
                    spiking_units=c.spiking_units,
                    spiking_steps=c.spiking_steps,
                    spiking_backend=c.spiking_backend,
                )
            else:
                self.world = EquilibriumWorldModel(
                    c.observation_dim, c.latent_dim, c.action_dim, seed=c.seed
                )
            self.world.freeze_encoder()
            self.policy = LocalPolicy(c.latent_dim, c.action_dim, seed=c.seed)
        if c.adaptive_memory:
            from nova.continual.adaptive import AdaptiveSubspaceLinear, AdaptiveConfig

            cfg = AdaptiveConfig(
                policy=c.memory_policy,
                growth_step=c.memory_growth,
                max_features=c.max_memory_features,
                max_state_bytes=c.max_memory_bytes,
                reserve_fraction=c.memory_reserve,
            )
            self.continual = AdaptiveSubspaceLinear(
                c.latent_dim, c.latent_dim, seed=c.seed, config=cfg
            )
        else:
            self.continual = ProtectedLinear(c.latent_dim, c.latent_dim, seed=c.seed)
        self.cascade = DiffusiveCascade(c.latent_dim)
        self.mod = (
            Neuromodulator() if c.neuromodulation else Neuromodulator(frozenset())
        )
        self.internal = InternalState()
        self.progress = LearningProgress()
        self.sensory = SensoryBuffer()
        self.working = WorkingMemory(dimensions=c.latent_dim)
        self.episodic = EpisodicMemory(c.memory_capacity)
        self.semantic = SemanticGraph(capacity=4 * c.memory_capacity)
        self.rest = self.rng.normal(0, 0.03, c.latent_dim)
        self.z = self.rest.copy()
        self.prediction = self.rest.copy()
        self.last_action = np.zeros(c.action_dim)
        self.z_version = 0
        self.tick_index = 0
        self.previous_observation = None
        self.metrics = deque(maxlen=c.history_limit)
        self.external_state = {}
        self.last_solver = {}
        self.last_world_update = {}
        self.goal = (
            np.zeros(c.latent_dim)
            if c.goal_latent is None
            else np.asarray(c.goal_latent, dtype=float)
        )
        if self.goal.shape != (c.latent_dim,) or not np.isfinite(self.goal).all():
            raise ValueError("goal shape mismatch")
        self._create_planner()

    def _create_planner(self):
        c = self.config
        constraint = None
        if c.state_lower is not None or c.state_upper is not None:
            from nova.planning.energy import BoxStateConstraint

            if c.state_lower is None or c.state_upper is None:
                raise ValueError("both state bounds required")
            constraint = BoxStateConstraint(c.state_lower, c.state_upper)
            if constraint.lower.shape != (c.latent_dim,):
                raise ValueError("state constraint dimension mismatch")
        if c.planner_backend == "energy":
            from nova.planning.energy import EnergyPlanner, EnergyPlannerConfig

            cfg = EnergyPlannerConfig(
                horizon=c.planner_horizon,
                iterations=c.planner_iterations,
                max_model_calls=c.solver_max_calls,
                sheaf_weight=c.sheaf_weight,
            )
            self.planner = EnergyPlanner(
                _Dynamics(self),
                self.planning_cost_gradient,
                c.action_dim,
                c.latent_dim,
                config=cfg,
                constraint=constraint,
            )
        else:
            self.planner = LatentPlanner(
                self.predict,
                self.planning_cost,
                c.action_dim,
                seed=c.seed,
                rollouts=c.planner_rollouts,
                horizon=c.planner_horizon,
                iterations=c.planner_iterations,
                constraint=constraint,
            )

    def _encode(self, observation):
        if self.config.world_backend != "torch":
            return self.world.encode(observation)[0]
        import torch

        with torch.no_grad():
            return (
                self.world.context(torch.as_tensor(observation, dtype=torch.float32))
                .numpy()
                .astype(float)
            )

    def predict(self, z, a):
        if self.config.world_backend != "torch":
            return self.world.predict(z, a)
        import torch

        with torch.no_grad():
            return self.world.predictor(
                torch.as_tensor(z, dtype=torch.float32),
                torch.as_tensor(a, dtype=torch.float32),
            ).numpy()

    def linearize(self, z, a):
        if self.config.world_backend != "torch":
            return self.world.linearize(z, a)
        # Explicit derivative of the baseline Linear -> SiLU -> Linear predictor.
        z, a = np.asarray(z, dtype=float), np.asarray(a, dtype=float)
        network = self.world.predictor.net
        w1, b1 = network[0].weight.detach().numpy(), network[0].bias.detach().numpy()
        w2, b2 = network[2].weight.detach().numpy(), network[2].bias.detach().numpy()
        pre = np.c_[z, a] @ w1.T + b1
        from scipy.special import expit

        sigmoid = expit(pre)
        derivative = sigmoid * (1 + pre * (1 - sigmoid))
        jacobian = np.einsum("oh,bh,hi->boi", w2, derivative, w1)
        output = (pre * sigmoid) @ w2.T + b2
        return (
            output,
            jacobian[:, :, : self.config.latent_dim],
            jacobian[:, :, self.config.latent_dim :],
        )

    @staticmethod
    def cost(z):
        return np.sum(np.asarray(z) ** 2, axis=-1)

    @staticmethod
    def cost_gradient(z):
        return CognitiveRuntime.cost(z), 2 * np.asarray(z)

    def planning_cost(self, z):
        return np.sum((np.asarray(z) - self.goal) ** 2, axis=-1)

    def planning_cost_gradient(self, z):
        return self.planning_cost(z), 2 * (np.asarray(z) - self.goal)

    def set_goal(self, latent):
        goal = np.asarray(latent, dtype=float)
        if goal.shape != self.goal.shape or not np.isfinite(goal).all():
            raise ValueError("invalid goal")
        self.goal = goal.copy()
        self.planner.warm_actions.fill(0)

    def _policy_predict(self, z):
        if self.config.world_backend != "torch":
            return self.policy.predict(z)
        import torch

        with torch.no_grad():
            return self.policy(torch.as_tensor(z, dtype=torch.float32)).numpy()

    def _policy_learn(self, z, action):
        if self.config.world_backend != "torch":
            return self.policy.learn(z, action, lr=0.001)
        import torch

        optimizer = torch.optim.SGD(self.policy.parameters(), lr=0.001)
        loss = (
            (
                self.policy(torch.as_tensor(z, dtype=torch.float32))
                - torch.as_tensor(action, dtype=torch.float32)
            )
            .square()
            .mean()
        )
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        return float(loss.detach())

    def _memory_input(self, z, version=None):
        x = np.atleast_2d(z)
        return self.continual.encode(x, version) if self.config.adaptive_memory else x

    @property
    def feature_version(self):
        return self.continual.feature_version if self.config.adaptive_memory else 0

    def tick(self, observation=None, reward=0.0):
        start = perf_counter()
        idle = observation is None
        if not np.isfinite(reward):
            raise ValueError("nonfinite reward")
        if not idle:
            observation = np.asarray(observation, dtype=float)
            if (
                observation.shape != (self.config.observation_dim,)
                or not np.isfinite(observation).all()
            ):
                raise ValueError("invalid observation")
        previous = self.z.copy()
        previous_version = self.z_version
        previous_action = self.last_action.copy()
        self.tick_index += 1
        if idle:
            self.z = 0.99 * self.z + 0.01 * self.rest
        else:
            self.sensory.append(observation.copy())
            self.z = np.asarray(self._encode(observation), dtype=float)
        self.z_version = self.feature_version
        error = float(np.mean((self.z - self.prediction) ** 2))
        uncertainty = float(np.clip(error, 0, 1))
        self.mod.update(
            error, reward, -self.cost(previous), -self.cost(self.z), uncertainty
        )
        recalled = self.episodic.retrieve(self.z, limit=1)
        sensory_weight = (
            self.mod.sensory_weight() if self.config.neuromodulation else 0.9
        )
        context = (
            self.z
            if not recalled
            else sensory_weight * self.z + (1 - sensory_weight) * recalled[0].embedding
        )
        self.working.update(context)
        slow = (
            not idle
            and self.config.planning
            and (uncertainty > 0.1 or self.mod.surprise > 0.5)
            and self.internal.energy > 0.1
        )
        self.last_solver = {}
        if idle:
            action = np.zeros(self.config.action_dim)
            mode = "idle"
        elif slow:
            if self.config.neuromodulation:
                if self.config.planner_backend == "energy":
                    self.planner.config = replace(
                        self.planner.config, discount=self.mod.discount()
                    )
                else:
                    self.planner.discount = self.mod.discount()
            result = self.planner.plan(
                context,
                None if self.config.deterministic else self.config.tick_budget_ms * 0.7,
            )
            action = result.action
            mode = "deliberate"
            self.last_solver = result.diagnostics
            if result.cost is not None:
                self._policy_learn(context, action)
        else:
            action = self._policy_predict(context)
            mode = "fast"
        world_loss = None
        if not idle:
            memory_input = self._memory_input(previous, previous_version)
            self.continual.step(
                memory_input, self.z[None], self.mod.learning_rate(0.001)
            )
            if self.config.adaptive_memory:
                self.continual.observe(memory_input)
                self.continual.age(1.0, consolidation=0.01 * self.mod.consolidation())
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
                    feature_version=self.z_version,
                )
            )
            if (
                self.config.world_online_learning
                and self.previous_observation is not None
            ):
                update = self.world.learn_latent(
                    previous[None],
                    previous_action[None],
                    self.z[None],
                    lr=self.mod.learning_rate(0.001),
                )
                world_loss = update.get("loss")
                self.last_world_update = {
                    key: value
                    for key, value in update.items()
                    if not isinstance(value, np.ndarray)
                }
            if self.config.spiking_plasticity:
                self.world.spiking.learn_local(self.mod.reward_pe)
            self.previous_observation = observation.copy()
        self.last_action = np.asarray(action, dtype=float).copy()
        self.prediction = self.predict(self.z[None], self.last_action[None])[0]
        self.internal.update(
            error,
            0.8 if slow else 0.1,
            len(self.episodic.episodes) / self.config.memory_capacity,
            reward,
        )
        self.internal.curiosity = 0.0 if idle else self.progress.update(error)
        if self.tick_index % self.config.sleep_every == 0:
            self.sleep()
        elapsed = (perf_counter() - start) * 1000
        metric = {
            "tick": self.tick_index,
            "mode": mode,
            "error": error,
            "free_dims": self.continual.free_dims,
            "memory": len(self.episodic.episodes),
            "latency_ms": elapsed,
            "budget_exceeded": elapsed > self.config.tick_budget_ms,
            "energy": self.internal.energy,
            "curiosity": self.internal.curiosity,
            "progress_standard_error": self.progress.standard_error,
            "world_backend": self.config.world_backend,
            "planner_backend": self.config.planner_backend,
            "world_loss": world_loss,
            "semantic_facts": len(self.semantic.facts),
            "semantic_evicted": self.semantic.evicted,
            "feature_version": self.feature_version,
            "memory_width": self.continual.in_features,
            "solver_model_calls": self.last_solver.get("model_calls", 0),
            "solver_feasible": self.last_solver.get("feasible"),
            "world_converged": getattr(self.world, "last_diagnostics", {}).get(
                "converged"
            ),
        }
        if self.config.adaptive_memory:
            metric.update(self.continual.capacity_metrics())
        self.metrics.append(metric)
        return {
            "action": self.last_action.copy(),
            "mode": mode,
            "latent": self.z.copy(),
            "metrics": metric,
            "solver": self.last_solver.copy(),
        }

    def remember_anchor(self, episode: Episode):
        if not episode.anchor:
            raise ValueError("anchor must be explicit")
        if episode.embedding.shape != (self.config.latent_dim,):
            raise ValueError("anchor latent shape mismatch")
        x = self._memory_input(episode.embedding, episode.feature_version)
        if not self.episodic.write(episode, force=True):
            raise ValueError("episode capacity contains only anchors")
        if self.config.adaptive_memory:
            self.continual.consolidate(x, anchor=True)
        else:
            self.continual.consolidate(x)

    def sleep(self):
        self.episodic.sleep(
            lambda e: self.semantic.add(
                e.id,
                "observed",
                e.content,
                e.source,
                timestamp=e.timestamp,
                anchor=e.anchor,
            )
        )
        if self.episodic.episodes:
            x = np.stack([e.embedding for e in self.episodic.episodes])
            versions = np.array([e.feature_version for e in self.episodic.episodes])
            self.continual.consolidate(self._memory_input(x, versions))
        if self.config.adaptive_memory:
            self.continual.manage_capacity()
        self.cascade.consolidate(self.mod.consolidation() * 0.01)
        self.internal.sleep()

    def state_dict(self):
        if self.config.world_backend == "torch":
            world = {k: v.detach().numpy() for k, v in self.world.state_dict().items()}
            policy = {
                k: v.detach().numpy() for k, v in self.policy.state_dict().items()
            }
        else:
            world = self.world.state_dict()
            policy = self.policy.state_dict()
        memory = (
            self.continual.state_dict()
            if self.config.adaptive_memory
            else {
                **{
                    k: getattr(self.continual, k).copy()
                    for k in ("W_base", "dW", "U", "singular_values", "last_update")
                },
                "rank_max": self.continual.rank_max,
                "energy_threshold": self.continual.energy_threshold,
            }
        )
        return {
            "kind": "nova-runtime",
            "config": asdict(self.config),
            "world": world,
            "policy": policy,
            "memory": memory,
            "cascade": self.cascade.state.copy(),
            "working": self.working.state.copy(),
            "working_cursor": self.working.cursor,
            "z": self.z.copy(),
            "prediction": self.prediction.copy(),
            "rest": self.rest.copy(),
            "last_action": self.last_action.copy(),
            "goal": self.goal.copy(),
            "z_version": self.z_version,
            "tick": self.tick_index,
            "rng": self.rng.bit_generator.state,
            "planner": self.planner.state_dict()
            if hasattr(self.planner, "state_dict")
            else {"rng": self.planner.rng.bit_generator.state},
            "mod": {**asdict(self.mod), "enabled": sorted(self.mod.enabled)},
            "internal": asdict(self.internal),
            "progress": self.progress.state_dict(),
            "episodes": [asdict(e) for e in self.episodic.episodes],
            "facts": self.semantic.facts,
            "semantic_evicted": self.semantic.evicted,
            "sensory": list(self.sensory),
            "previous_observation": self.previous_observation,
            "episodic_threshold": self.episodic.threshold,
            "metrics": list(self.metrics),
            "external_state": self.external_state,
            "last_solver": self.last_solver,
            "last_world_update": self.last_world_update,
        }

    def save(self, path):
        save_state(path, self.state_dict())

    @classmethod
    def from_state_dict(cls, state):
        if state.get("kind") != "nova-runtime":
            raise ValueError("not a runtime checkpoint")
        obj = cls(RuntimeConfig(**state["config"]))
        if obj.config.world_backend == "torch":
            import torch

            for name in ("world", "policy"):
                getattr(obj, name).load_state_dict(
                    {
                        k: torch.from_numpy(np.asarray(v).copy())
                        for k, v in state[name].items()
                    }
                )
        else:
            from nova.jepa.equilibrium import EquilibriumWorldModel
            from nova.brain.latent import SpikingWorldModel
            from nova.reasoning.local_policy import LocalPolicy

            model_class = (
                SpikingWorldModel
                if obj.config.world_backend == "adex"
                else EquilibriumWorldModel
            )
            obj.world = model_class.from_state_dict(state["world"])
            obj.policy = LocalPolicy.from_state_dict(state["policy"])
        if obj.config.adaptive_memory:
            from nova.continual.adaptive import AdaptiveSubspaceLinear

            obj.continual = AdaptiveSubspaceLinear.from_state_dict(state["memory"])
        else:
            for name in ("W_base", "dW", "U", "singular_values", "last_update"):
                setattr(obj.continual, name, np.asarray(state["memory"][name]).copy())
            obj.continual.W_base.flags.writeable = False
            obj.continual.rank_max = state["memory"]["rank_max"]
            obj.continual.energy_threshold = state["memory"]["energy_threshold"]
        for name in ("z", "prediction", "rest", "last_action"):
            setattr(obj, name, np.asarray(state[name]).copy())
        obj.goal = np.asarray(state.get("goal", obj.goal)).copy()
        obj.z_version = state["z_version"]
        obj.tick_index = state["tick"]
        obj.rng.bit_generator.state = state["rng"]
        obj.cascade.state = np.asarray(state["cascade"]).copy()
        obj.working.state = np.asarray(state["working"]).copy()
        obj.working.cursor = state["working_cursor"]
        mod = state["mod"].copy()
        mod["enabled"] = frozenset(mod["enabled"])
        obj.mod = Neuromodulator(**mod)
        obj.internal = InternalState(**state["internal"])
        obj.progress = LearningProgress.from_state_dict(state["progress"])
        obj.episodic.episodes = [
            Episode(**{**e, "participants": tuple(e["participants"])})
            for e in state["episodes"]
        ]
        obj.episodic.threshold = state["episodic_threshold"]
        obj.semantic.facts = state["facts"]
        obj.semantic.evicted = state.get("semantic_evicted", 0)
        obj.sensory.extend(state["sensory"])
        obj.previous_observation = state["previous_observation"]
        obj.metrics = deque(state["metrics"], maxlen=obj.config.history_limit)
        obj.external_state = state["external_state"]
        obj.last_solver = state.get("last_solver", {})
        obj.last_world_update = state.get("last_world_update", {})
        obj._create_planner()
        if hasattr(obj.planner, "load_state_dict"):
            obj.planner.load_state_dict(state["planner"])
        else:
            obj.planner.rng.bit_generator.state = state["planner"]["rng"]
        return obj

    @classmethod
    def load(cls, path):
        try:
            return cls.from_state_dict(load_state(path))
        except CheckpointFormatError as error:
            if str(error) != "not a v2 state archive":
                raise
        # Explicit migration of the published v1 runtime format.
        with np.load(path, allow_pickle=False) as arrays:
            if "metadata" not in arrays.files:
                raise ValueError("unknown checkpoint format")
            meta = json.loads(str(arrays["metadata"]))
            if meta.get("version") != 1:
                raise ValueError("unsupported legacy version")
            obj = cls(RuntimeConfig(**meta["config"]))
            state = obj.state_dict()
            for name, module in [("world", obj.world), ("policy", obj.policy)]:
                state[name] = {
                    k: arrays[f"{name}.{k}"].copy() for k in module.state_dict()
                }
            for name in ("W_base", "dW", "U", "singular_values", "last_update"):
                state["memory"][name] = arrays[f"continual.{name}"].copy()
            for name in ("z", "prediction", "rest", "last_action"):
                state[name] = arrays[name].copy()
            state.update(
                cascade=arrays["cascade"].copy(),
                working=arrays["working"].copy(),
                working_cursor=meta["working_cursor"],
                tick=meta["tick"],
                rng=meta["rng"],
                mod=meta["mod"],
                internal=meta["internal"],
                episodes=[
                    {**e, "embedding": np.asarray(e["embedding"])}
                    for e in meta["episodes"]
                ],
                facts=meta["facts"],
                sensory=[np.asarray(x) for x in meta["sensory"]],
                previous_observation=None
                if meta["previous_observation"] is None
                else np.asarray(meta["previous_observation"]),
                episodic_threshold=meta["episodic_threshold"],
                metrics=meta["metrics"],
                external_state=meta.get("external_state", {}),
            )
            state["planner"] = {"rng": meta["planner_rng"]}
            return cls.from_state_dict(state)

    def write_metrics(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(
            "".join(json.dumps(m, allow_nan=False) + "\n" for m in self.metrics)
        )

"""Validated architecture and workload budgets, shared by all cortex entry points."""

from dataclasses import dataclass, asdict, fields
import json
from pathlib import Path


@dataclass(frozen=True)
class CortexConfig:
    seed: int = 42
    channels: int = 4
    embedding: int = 512
    hidden: int = 768
    stochastic: int = 256
    action_dim: int = 8
    proprio_dim: int = 32
    ensemble: int = 3
    dictionary: int = 16384
    top_k: int = 32
    sae_mode: str = "topk"
    l1: float = 0.01
    learning_rate: float = 0.0003
    kl_balance: float = 0.8
    kl_weight: float = 0.1
    free_nats: float = 1.0
    replay_capacity: int = 4096
    protected_fraction: float = 0.1
    replay_alpha: float = 0.6
    batch_size: int = 16
    sleep_every: int = 256
    sleep_updates: int = 64
    stagnation_window: int = 128
    horizon: int = 12
    cem_population: int = 64
    cem_elites: int = 8
    cem_iterations: int = 4
    cem_gradient_steps: int = 2
    plan_every: int = 8
    uncertainty_threshold: float = 0.05
    preference_energy: float = 0.5
    preference_diversity: float = 0.5
    risk_weight: float = 1.0
    epistemic_weight: float = 0.1
    jepa_weight: float = 0.1
    max_voxels: int = 2_097_152
    symbolic_every: int = 0
    symbolic_window: int = 512
    symbolic_dimensions: int = 4
    symbolic_iterations: int = 40
    train_retina: bool = False
    device: str = "cpu"

    @property
    def latent(self):
        return self.hidden + self.stochastic

    def validate(self):
        import math

        for f in fields(self):
            value = getattr(self, f.name)
            if f.type in {int, bool, str} and type(value) is not f.type:
                raise ValueError(f"invalid type for {f.name}")
            if f.type is float and (
                not isinstance(value, (int, float)) or isinstance(value, bool)
            ):
                raise ValueError(f"invalid numeric type for {f.name}")
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError(f"nonfinite {f.name}")
        if not (
            1 <= self.channels <= 32
            and 16 <= self.embedding <= 2048
            and 8 <= self.hidden <= 2048
            and 4 <= self.stochastic <= 1024
            and 1 <= self.ensemble <= 8
            and self.action_dim == 8
            and self.proprio_dim == 32
            and self.latent <= self.dictionary <= 32768
            and self.dictionary * self.latent <= 33_554_432
            and 1 <= self.top_k <= min(256, self.dictionary)
        ):
            raise ValueError("architecture exceeds supported dimensions")
        if not (
            0 < self.learning_rate <= 0.01
            and 0 <= self.l1 <= 1
            and 0 <= self.kl_balance <= 1
            and 0 <= self.kl_weight <= 10
            and 0 <= self.free_nats <= 100
            and self.sae_mode in {"topk", "l1"}
            and self.jepa_weight >= 0
        ):
            raise ValueError("invalid learning configuration")
        if not (
            8 <= self.replay_capacity <= 65536
            and 0 <= self.protected_fraction <= 0.5
            and 0 <= self.replay_alpha <= 1
            and 2 <= self.batch_size <= 256
            and 0 <= self.sleep_every <= 1_000_000
            and 0 <= self.sleep_updates <= 10000
            and 4 <= self.stagnation_window <= 10000
            and 1 <= self.max_voxels <= 2_097_152
        ):
            raise ValueError("invalid memory/workload budget")
        if not (
            1 <= self.horizon <= 32
            and 4 <= self.cem_population <= 512
            and 1 <= self.cem_elites <= self.cem_population
            and 1 <= self.cem_iterations <= 16
            and 0 <= self.cem_gradient_steps <= 8
            and 1 <= self.plan_every <= 10000
            and self.uncertainty_threshold >= 0
            and 0 <= self.preference_energy <= 1
            and 0 <= self.preference_diversity <= 1
            and 0 <= self.risk_weight <= 100
            and 0 <= self.epistemic_weight <= 10
        ):
            raise ValueError("invalid controller configuration")
        memory = (
            self.replay_capacity
            * (
                2 * self.embedding
                + self.hidden
                + self.stochastic
                + 2 * self.proprio_dim
                + 2 * self.action_dim
                + 4
            )
            * 4
        )
        if (
            not 0 <= self.seed < 2**63
            or memory > 1024**3
            or self.cem_population * self.horizon * self.latent > 4_194_304
        ):
            raise ValueError("seed, replay or imagined-state memory budget exceeded")
        if not (
            0 <= self.symbolic_every <= 1_000_000
            and 16 <= self.symbolic_window <= 5000
            and 1 <= self.symbolic_dimensions <= min(16, self.latent)
            and 1 <= self.symbolic_iterations <= 1000
        ):
            raise ValueError("invalid background symbolic workload")
        if self.device != "cpu" and not self.device.startswith(("cuda", "mps")):
            raise ValueError("unsupported device")
        return self

    def to_dict(self):
        return asdict(self)

    @classmethod
    def compact(cls, **kwargs):
        values = dict(
            embedding=64,
            hidden=48,
            stochastic=16,
            dictionary=512,
            top_k=8,
            replay_capacity=512,
            batch_size=8,
            horizon=6,
            cem_population=16,
            cem_elites=4,
            cem_gradient_steps=0,
            sleep_updates=16,
        )
        values.update(kwargs)
        return cls(**values).validate()

    @classmethod
    def load(cls, path):
        p = Path(path)
        if p.stat().st_size > 65536:
            raise ValueError("configuration too large")
        return cls(**json.loads(p.read_text())).validate()

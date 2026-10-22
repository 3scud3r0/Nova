"""Explicit opt-in research profiles; choosing a profile is not an evidence claim."""

from dataclasses import asdict
from .runtime import RuntimeConfig


def runtime_config(profile="baseline", overrides=None):
    options = {
        "baseline": {},
        "adaptive": dict(
            world_backend="equilibrium",
            adaptive_memory=True,
            planning=True,
            planner_backend="energy",
            world_online_learning=True,
            neuromodulation=True,
            planner_iterations=12,
            sleep_every=32,
        ),
        "brain": dict(
            world_backend="adex",
            adaptive_memory=True,
            planning=True,
            planner_backend="energy",
            world_online_learning=True,
            neuromodulation=True,
            planner_iterations=12,
            sleep_every=32,
        ),
    }
    if profile not in options:
        raise ValueError("unknown runtime profile")
    values = {**options[profile], **(overrides or {})}
    # Validate all names/types through the dataclass instead of silently ignoring typos.
    return RuntimeConfig(**values)


def describe(config: RuntimeConfig):
    return {
        "config": asdict(config),
        "status": "experimental; no new performance measurements in this revision",
        "autograd_used": config.world_backend == "torch",
        "retention_scope": "versioned retained activation span; released directions may change",
        "finite_capacity": True,
        "time_budget": "soft wall budget or deterministic operation budget",
    }

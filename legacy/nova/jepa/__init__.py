"""Lazy backend exports: NumPy equilibrium inference does not import PyTorch."""

from importlib import import_module

__all__ = [
    "JEPA",
    "ContextEncoder",
    "TargetEncoder",
    "LatentPredictor",
    "EquilibriumNetwork",
    "EquilibriumWorldModel",
    "EquilibriumConfig",
]


def __getattr__(name):
    if name in ("JEPA", "ContextEncoder", "TargetEncoder", "LatentPredictor"):
        return getattr(import_module(".torch_backend", __name__), name)
    if name in ("EquilibriumNetwork", "EquilibriumWorldModel", "EquilibriumConfig"):
        return getattr(import_module(".equilibrium", __name__), name)
    raise AttributeError(name)

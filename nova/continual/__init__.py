"""Linear retention with explicit, finite subspace capacity."""

from .protected import ProtectedLinear, linear_cka

__all__ = ["ProtectedLinear", "linear_cka"]

from .adaptive import AdaptiveSubspaceLinear, AdaptiveConfig

__all__ += ["AdaptiveSubspaceLinear", "AdaptiveConfig"]

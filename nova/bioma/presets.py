"""Named, bounded 3D demonstrations with explicit model semantics."""

from .physics_engine import PhysicsConfig
from .ecosystem import Ecosystem, EcosystemConfig

PRESETS = {
    "organisms": "hybrid",
    "ink": "gray_scott",
    "lenia": "lenia",
    "conway": "conway",
    "light": "wave",
    "particles": "particles",
    "fluid": "fluid",
    "nca": "nca",
    "fixed": "fixed_gray_scott",
}


def create_ecosystem(
    preset="organisms",
    *,
    seed=0,
    size=32,
    dimensions=3,
    population=None,
    genesis_genomes=None,
    signaling=False,
    crossover_rate=0.0,
):
    if preset not in PRESETS:
        raise ValueError("unknown preset")
    if dimensions not in (2, 3) or not 8 <= size <= 64:
        raise ValueError("demo grid budget exceeded")
    if genesis_genomes is not None and population is None:
        population = len(genesis_genomes)
    count = (4 if preset == "organisms" else 0) if population is None else population
    world = Ecosystem(
        PhysicsConfig(mode=PRESETS[preset], shape=(size,) * dimensions, seed=seed),
        EcosystemConfig(
            initial_population=count, signaling=signaling, crossover_rate=crossover_rate
        ),
        genesis_genomes=genesis_genomes,
    )
    # Excitation belongs to the seeded engine initialization, so a seed replay
    # must include it as a recorded event rather than an implicit preset change.
    if preset == "light":
        world.apply_event(
            {
                "tick": 0,
                "kind": "impulse",
                "position": [size / 2] * dimensions,
                "amount": 1.0,
            }
        )
    return world

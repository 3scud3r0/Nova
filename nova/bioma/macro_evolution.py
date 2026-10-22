"""Finite phenotype niches, ancestry records and compatible-genome crossover."""

from .determinism import SplitMix64
from .genetics import MorphogeneticCPPN


def crossover(left, right, seed):
    if left.config != right.config:
        raise ValueError("crossover requires homologous shapes/configuration")
    child = MorphogeneticCPPN.from_state_dict(left.state_dict())
    rng = SplitMix64(seed)
    for name in ("w_in", "w_out", "grn", "coordinates", "activations"):
        a, b = getattr(child, name), getattr(right, name)
        mask = rng.uniform(a.shape) < 0.5
        a[mask] = b[mask]
    for name in ("weights", "biases"):
        for a, b in zip(getattr(child, name), getattr(right, name)):
            mask = rng.uniform(a.shape) < 0.5
            a[mask] = b[mask]
    child.seed = seed
    child.parents = [left.hash(), right.hash()]
    child.generation = max(left.generation, right.generation) + 1
    child.grammar = (left.grammar + right.grammar)[-64:]
    return child


class LineageArchive:
    """Trait bins are descriptive niches, not established biological species."""

    def __init__(self, max_records=4096):
        if not 1 <= max_records <= 16384:
            raise ValueError("lineage archive budget exceeded")
        self.max_records = max_records
        self.records = {}

    def observe(self, ecosystem):
        for organism in ecosystem.organisms:
            key = organism.genome.hash()
            if key not in self.records:
                if len(self.records) >= self.max_records:
                    continue
                fraction = (
                    organism.body["occupied_voxels"]
                    / organism.genome.config.body_resolution**3
                )
                niche = (
                    min(3, int(fraction * 4)),
                    min(3, organism.genome.config.neural_nodes // 32),
                    min(3, organism.neural_complexity // 128),
                )
                self.records[key] = {
                    "genome": key,
                    "parents": organism.genome.parents,
                    "generation": organism.genome.generation,
                    "first_tick": ecosystem.world.tick,
                    "last_tick": ecosystem.world.tick,
                    "niche": list(niche),
                    "max_energy": organism.energy,
                }
            record = self.records[key]
            record["last_tick"] = ecosystem.world.tick
            record["max_energy"] = max(record["max_energy"], organism.energy)
        return self.snapshot()

    def snapshot(self):
        return {
            "lineages": list(self.records.values()),
            "niches": len({tuple(r["niche"]) for r in self.records.values()}),
            "scope": "finite phenotype bins and observed ancestry only",
        }

"""Budgeted architecture/morphology search with separate seeds and Pareto archives."""

from __future__ import annotations
from dataclasses import dataclass
import numpy as np
from .genetics import MorphogeneticCPPN
from .determinism import SplitMix64


@dataclass
class Evaluation:
    genome_hash: str
    seed: int
    fitness: float
    complexity: int
    metrics: dict


class ArchitectureSearch:
    """Mutation/selection over CPPN + graph grammar, not arbitrary universal NAS.

    A caller supplies the actual evaluation task. Archive uses measured fitness
    and complexity; validation seeds are not fed into parent selection.
    """

    def __init__(self, seed=0, population=8, max_evaluations=128):
        if not 2 <= population <= 128 or not population <= max_evaluations <= 10000:
            raise ValueError("search budget out of range")
        self.rng = SplitMix64(seed)
        self.population = [
            MorphogeneticCPPN(self.rng.next_u64()) for _ in range(population)
        ]
        self.max_evaluations = max_evaluations
        self.evaluations = []
        self.archive = []

    def run(self, evaluator, generations=4, validation_seeds=(101, 103, 107)):
        if generations < 1:
            raise ValueError("generations must be positive")
        evaluated = 0
        champion = None
        for _ in range(generations):
            scored = []
            evaluation_seed = self.rng.next_u64()
            for genome in self.population:
                if evaluated >= self.max_evaluations:
                    break
                seed = evaluation_seed
                metrics = evaluator(genome, seed)
                fitness = float(metrics["fitness"])
                if not np.isfinite(fitness):
                    raise ValueError("nonfinite task fitness")
                result = Evaluation(
                    genome.hash(),
                    seed,
                    fitness,
                    genome.config.neural_nodes
                    + genome.develop_brain()["active_synapses"],
                    dict(metrics),
                )
                self.evaluations.append(result)
                evaluated += 1
                scored.append((fitness, genome))
                self.archive.append(result)
            if not scored:
                break
            scored.sort(key=lambda x: (-x[0], x[1].hash()))
            champion = scored[0][1]
            parents = [g for _, g in scored[: max(1, len(scored) // 2)]]
            self.population = [champion] + [
                parents[i % len(parents)].mutate(self.rng.next_u64(), 0.1)
                for i in range(len(self.population) - 1)
            ]
        archive = self.archive
        self.archive = [
            a
            for a in archive
            if not any(
                b.fitness >= a.fitness
                and b.complexity <= a.complexity
                and (b.fitness > a.fitness or b.complexity < a.complexity)
                for b in archive
            )
        ]
        validation = (
            []
            if champion is None
            else [evaluator(champion, int(seed)) for seed in validation_seeds]
        )
        return {
            "champion": None if champion is None else champion.state_dict(),
            "training_evaluations": evaluated,
            "validation_evaluations": len(validation),
            "evaluation_budget_scope": "training; validation adds explicit held-out seeds",
            "validation": validation,
            "pareto": [vars(x) for x in self.archive],
        }

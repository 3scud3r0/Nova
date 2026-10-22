"""Seeded compositional patterns, graph grammar mutations and digital GRNs."""

from __future__ import annotations
from dataclasses import dataclass, asdict, replace
import hashlib
import numpy as np
from .determinism import SplitMix64, canonical_json


@dataclass(frozen=True)
class GenomeConfig:
    width: int = 16
    depth: int = 3
    neural_nodes: int = 24
    body_resolution: int = 12
    connection_threshold: float = 0.6
    max_edges: int = 512
    max_n2: int = 2

    def __post_init__(self):
        if (
            not 4 <= self.width <= 64
            or not 1 <= self.depth <= 6
            or not 4 <= self.neural_nodes <= 128
            or not 4 <= self.body_resolution <= 24
        ):
            raise ValueError("genome development budget exceeded")
        if (
            not 0 <= self.connection_threshold <= 1
            or not 0 <= self.max_n2 <= 8
            or not 0 <= self.max_edges <= 4096
        ):
            raise ValueError("invalid topology budget")


class MorphogeneticCPPN:
    """8-coordinate CPPN; pair queries use both endpoints, not just a midpoint.

    Body output is an occupancy/density score, NOT a signed distance function.
    Functions are sin, tanh, Gaussian, abs and linear, selected per hidden unit.
    Neural architecture varies within this finite grammar; not every conceivable
    neural architecture is representable or discovered by a random draw.
    """

    def __init__(self, seed=42, config: GenomeConfig | None = None):
        self.seed = seed
        self.config = config or GenomeConfig()
        c = self.config
        rng = SplitMix64(seed)
        self.w_in = rng.uniform((8, c.width), -1, 1)
        self.weights = [
            rng.uniform((c.width, c.width), -1 / np.sqrt(c.width), 1 / np.sqrt(c.width))
            for _ in range(c.depth)
        ]
        self.biases = [rng.uniform((c.width,), -0.5, 0.5) for _ in range(c.depth)]
        self.activations = rng.integers(0, 5, (c.depth, c.width))
        self.w_out = rng.uniform((c.width, 8), -0.5, 0.5)
        self.coordinates = rng.uniform((c.neural_nodes, 3), -1, 1)
        self.grn = rng.uniform((6, 6), -0.5, 0.5)
        self.grammar = []
        self.parents = []
        self.generation = 0

    def _evaluate(self, features):
        h = np.tanh(np.asarray(features) @ self.w_in)
        for w, b, kinds in zip(self.weights, self.biases, self.activations):
            x = np.clip(h @ w + b, -20, 20)
            options = np.stack(
                (np.sin(x), np.tanh(x), np.exp(-x * x), np.abs(x), x), axis=-1
            )
            h = np.take_along_axis(
                options, np.broadcast_to(kinds, x.shape)[..., None], axis=-1
            )[..., 0]
        return np.tanh(h @ self.w_out)

    def query_body(self, coordinates):
        p = np.asarray(coordinates, dtype=float)
        r = np.linalg.norm(p, axis=-1, keepdims=True)
        return self._evaluate(
            np.concatenate(
                (p, r, np.zeros((*p.shape[:-1], 3)), np.ones_like(r)), axis=-1
            )
        )

    def query_pair(self, left, right):
        left, right = np.broadcast_arrays(np.asarray(left), np.asarray(right))
        distance = np.linalg.norm(left - right, axis=-1, keepdims=True)
        return self._evaluate(
            np.concatenate((left, right, distance, np.ones_like(distance)), axis=-1)
        )

    def develop_body(self):
        axis = np.linspace(-1, 1, self.config.body_resolution)
        coords = np.stack(np.meshgrid(axis, axis, axis, indexing="ij"), -1)
        values = self.query_body(coords)
        density = np.maximum(values[..., 0] - 0.2 * np.linalg.norm(coords, axis=-1), 0)
        material = np.argmax(values[..., 1:5], axis=-1).astype(np.uint8)
        return {
            "density": density,
            "material": material,
            "occupied_voxels": int(np.count_nonzero(density > 0.1)),
            "mass_proxy": float(density.sum()),
            "surface_proxy": float(
                sum(np.abs(np.diff(density, axis=a)).sum() for a in range(3))
            ),
        }

    def develop_brain(self):
        n = len(self.coordinates)
        properties = self.query_body(self.coordinates)
        types = np.zeros(n, dtype=np.int64)
        # Cell identity determines every outgoing sign (Dale); row=source.
        inhibitory = np.argsort(properties[:, 1], kind="stable")[: max(1, n // 5)]
        types[inhibitory] = 1
        if len(inhibitory) > 1:
            types[inhibitory[len(inhibitory) // 2 :]] = 2
        if len(inhibitory) > 3:
            types[inhibitory[-max(1, len(inhibitory) // 4) :]] = 3
        pair = self.query_pair(
            self.coordinates[:, None, :], self.coordinates[None, :, :]
        )
        strength = np.maximum(pair[..., 3], 0)
        mask = pair[..., 4] > self.config.connection_threshold
        np.fill_diagonal(mask, False)
        eligible = np.flatnonzero(mask)
        keep = (
            eligible[
                np.argsort(strength.ravel()[eligible], kind="stable")[
                    -self.config.max_edges :
                ]
            ]
            if self.config.max_edges
            else []
        )
        weights = np.zeros((n, n))
        weights.ravel()[keep] = strength.ravel()[keep] * 10
        weights *= np.where(types == 0, 1.0, -1.0)[:, None]
        families = np.argmax(
            properties[:, 4:8], axis=1
        )  # 0=rate, 1=AdEx, 2=HH, 3=logic
        n2 = np.flatnonzero(families == 2)
        if len(n2) > self.config.max_n2:
            families[n2[self.config.max_n2 :]] = 1
        for operation in self.grammar:
            if operation["op"] == "edge":
                i, j = operation["source"] % n, operation["target"] % n
                if i != j:
                    weights[i, j] = abs(operation["weight"]) * (
                        1 if types[i] == 0 else -1
                    )
            elif operation["op"] == "prune":
                weights[operation["source"] % n, operation["target"] % n] = 0
        # Apply edge budget after grammar too.
        active = np.flatnonzero(weights)
        if len(active) > self.config.max_edges:
            drop = (
                active[
                    np.argsort(abs(weights.ravel()[active]), kind="stable")[
                        : -self.config.max_edges
                    ]
                ]
                if self.config.max_edges
                else active
            )
            weights.ravel()[drop] = 0
        return {
            "coordinates": self.coordinates.copy(),
            "types": types,
            "families": families,
            "weights": weights,
            "active_synapses": int(np.count_nonzero(weights)),
        }

    def mutate(self, seed, rate=0.05):
        if not 0 <= rate <= 1:
            raise ValueError("mutation rate must be in [0,1]")
        child = MorphogeneticCPPN.from_state_dict(self.state_dict())
        rng = SplitMix64(seed)
        for value in [
            child.w_in,
            *child.weights,
            *child.biases,
            child.w_out,
            child.grn,
        ]:
            mask = rng.uniform(value.shape) < rate
            value += mask * rng.uniform(value.shape, -0.15, 0.15)
        if rng.uniform((1,))[0] < rate:
            child.activations = rng.integers(0, 5, child.activations.shape)
        if rng.uniform((1,))[0] < rate:
            n = len(child.coordinates)
            if n < 128 and (n <= 4 or rng.next_u64() % 2):
                child.coordinates = np.vstack(
                    (child.coordinates, rng.uniform((1, 3), -1, 1))
                )
            elif n > 4:
                child.coordinates = child.coordinates[:-1].copy()
            child.config = replace(child.config, neural_nodes=len(child.coordinates))
        n = len(child.coordinates)
        op = {
            "op": "edge" if rng.next_u64() % 2 else "prune",
            "source": int(rng.next_u64() % n),
            "target": int(rng.next_u64() % n),
            "weight": float(rng.uniform((1,), 0, 10)[0]),
        }
        child.grammar = (child.grammar + [op])[-64:]
        child.parents = [self.hash()]
        child.generation += 1
        child.seed = seed
        return child

    def state_dict(self):
        return {
            "config": asdict(self.config),
            "seed": self.seed,
            "w_in": self.w_in.tolist(),
            "weights": [w.tolist() for w in self.weights],
            "biases": [b.tolist() for b in self.biases],
            "activations": self.activations.tolist(),
            "w_out": self.w_out.tolist(),
            "coordinates": self.coordinates.tolist(),
            "grn": self.grn.tolist(),
            "grammar": self.grammar,
            "parents": self.parents,
            "generation": self.generation,
        }

    @classmethod
    def from_state_dict(cls, state):
        obj = cls(state["seed"], GenomeConfig(**state["config"]))
        for name in ("w_in", "w_out", "coordinates", "grn"):
            setattr(obj, name, np.asarray(state[name], dtype=float))
        obj.weights = [np.asarray(w, dtype=float) for w in state["weights"]]
        obj.biases = [np.asarray(b, dtype=float) for b in state["biases"]]
        obj.activations = np.asarray(state["activations"], dtype=int)
        obj.grammar = state["grammar"]
        obj.parents = state["parents"]
        obj.generation = state["generation"]
        expected = cls(obj.seed, obj.config)
        for name in ("w_in", "w_out", "coordinates", "grn", "activations"):
            value = getattr(obj, name)
            if (
                value.shape != getattr(expected, name).shape
                or not np.isfinite(value).all()
            ):
                raise ValueError("invalid genome array")
        if (
            len(obj.weights) != obj.config.depth
            or len(obj.biases) != obj.config.depth
            or len(obj.grammar) > 64
        ):
            raise ValueError("genome depth/grammar budget exceeded")
        for w, b in zip(obj.weights, obj.biases):
            if (
                w.shape != (obj.config.width, obj.config.width)
                or b.shape != (obj.config.width,)
                or not np.isfinite(w).all()
                or not np.isfinite(b).all()
            ):
                raise ValueError("invalid genome layer")
        if np.any(obj.activations < 0) or np.any(obj.activations > 4):
            raise ValueError("invalid activation")
        for op in obj.grammar:
            if op.get("op") not in ("edge", "prune") or any(
                type(op.get(k)) is not int or not 0 <= op[k] < 128
                for k in ("source", "target")
            ):
                raise ValueError("invalid graph operation")
            if not np.isfinite(op.get("weight", 0)) or abs(op.get("weight", 0)) > 50:
                raise ValueError("invalid graph weight")
        if (
            len(obj.parents) > 2
            or not isinstance(obj.generation, int)
            or obj.generation < 0
        ):
            raise ValueError("invalid lineage")
        return obj

    def hash(self):
        return hashlib.sha256(canonical_json(self.state_dict())).hexdigest()


class GeneRegulatoryNetwork:
    """Digital expression dx/dt = sigmoid(Wx + sensory) - x; not real wet-lab DNA."""

    def __init__(self, weights):
        self.weights = np.asarray(weights, dtype=float)
        self.expression = np.zeros(len(self.weights))

    def step(self, sensory, dt=0.1):
        if not 0 < dt <= 1:
            raise ValueError("GRN dt must be in (0,1]")
        drive = np.clip(
            self.weights @ self.expression + np.resize(sensory, len(self.expression)),
            -30,
            30,
        )
        self.expression += dt * (1 / (1 + np.exp(-drive)) - self.expression)
        return self.expression.copy()

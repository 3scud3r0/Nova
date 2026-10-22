"""Budgeted sparse bricks/octree metadata and explicit visual LOD scheduling."""

import numpy as np


class SparseBrickField:
    def __init__(self, brick_size=8, max_bricks=4096):
        if not 2 <= brick_size <= 16 or not 1 <= max_bricks <= 16384:
            raise ValueError("sparse brick budget exceeded")
        self.brick_size = brick_size
        self.max_bricks = max_bricks
        self.bricks = {}

    def write(self, coordinate, value):
        coordinate = np.asarray(coordinate, dtype=int)
        if (
            coordinate.shape != (3,)
            or np.any(abs(coordinate) > 2**20)
            or not np.isfinite(value)
        ):
            raise ValueError("invalid sparse sample")
        key = tuple(coordinate // self.brick_size)
        local = tuple(coordinate % self.brick_size)
        if key not in self.bricks:
            if len(self.bricks) >= self.max_bricks:
                raise MemoryError("sparse brick budget exhausted")
            self.bricks[key] = np.zeros((self.brick_size,) * 3, dtype=np.float32)
        self.bricks[key][local] = value

    def sample(self, coordinate):
        p = np.asarray(coordinate, dtype=int)
        brick = self.bricks.get(tuple(p // self.brick_size))
        return 0.0 if brick is None else float(brick[tuple(p % self.brick_size)])

    def octree(self):
        nodes = set()
        for key in self.bricks:
            shifted = tuple(x + 2**20 for x in key)
            for depth in range(22):
                nodes.add((depth, *(x >> depth for x in shifted)))
        return {
            "nodes": sorted(nodes),
            "bricks": len(self.bricks),
            "nbytes": sum(b.nbytes for b in self.bricks.values()),
            "format": "NOVA sparse bricks; not NanoVDB",
        }


def visual_lod(distance, projected_radius, *, near=1.0, far=10.0):
    if (
        not np.isfinite([distance, projected_radius, near, far]).all()
        or distance < 0
        or projected_radius < 0
        or not 0 < near < far
    ):
        raise ValueError("invalid camera LOD bounds")
    blend = float(np.clip((far - distance) / (far - near), 0, 1))
    return {
        "render_weight": blend,
        "sprite_radius": max(0.5, float(projected_radius)),
        "scope": "visual only; does not freeze physical state or reduce entropy",
    }

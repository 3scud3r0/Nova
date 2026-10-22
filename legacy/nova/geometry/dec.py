"""Oriented simplicial boundary operators and metric-aware finite Hodge stars."""

from itertools import combinations

import numpy as np
from scipy import sparse


class SimplicialComplex:
    def __init__(self, vertices, top_simplices):
        self.vertices = np.asarray(vertices, dtype=float)
        top = [tuple(sorted(s)) for s in top_simplices]
        if (
            self.vertices.ndim != 2
            or not len(top)
            or len(self.vertices) > 16384
            or len(top) > 32768
            or not np.isfinite(self.vertices).all()
        ):
            raise ValueError("simplicial complex budget exceeded")
        self.dimension = len(top[0]) - 1
        if not 1 <= self.dimension <= 3 or any(
            len(s) != self.dimension + 1
            or len(set(s)) != len(s)
            or min(s) < 0
            or max(s) >= len(self.vertices)
            for s in top
        ):
            raise ValueError("invalid simplex")
        self.simplices = [
            sorted({face for simplex in top for face in combinations(simplex, k + 1)})
            for k in range(self.dimension + 1)
        ]
        self.boundaries = []
        for k in range(1, self.dimension + 1):
            lookup = {s: i for i, s in enumerate(self.simplices[k - 1])}
            rows = []
            cols = []
            data = []
            for j, s in enumerate(self.simplices[k]):
                for i in range(k + 1):
                    rows.append(lookup[s[:i] + s[i + 1 :]])
                    cols.append(j)
                    data.append((-1) ** i)
            self.boundaries.append(
                sparse.csr_matrix(
                    (np.asarray(data, dtype=np.int64), (rows, cols)),
                    shape=(len(lookup), len(self.simplices[k])),
                )
            )

    def exterior(self, degree):
        return self.boundaries[degree].T.tocsr()

    def chain_residual(self):
        return [
            int(abs((self.boundaries[k - 1] @ self.boundaries[k]).data).sum())
            for k in range(1, len(self.boundaries))
        ]

    def simplex_volumes(self, degree):
        import math

        volumes = []
        for simplex in self.simplices[degree]:
            if degree == 0:
                volumes.append(1.0)
                continue
            edges = self.vertices[list(simplex[1:])] - self.vertices[simplex[0]]
            det = np.linalg.det(edges @ edges.T)
            if det <= 1e-20:
                raise ValueError("degenerate simplex metric")
            volumes.append(np.sqrt(det) / math.factorial(degree))
        return np.asarray(volumes)

    def hodge(self, degree, dual_volumes):
        dual = np.asarray(dual_volumes, dtype=float)
        primal = self.simplex_volumes(degree)
        if (
            dual.shape != primal.shape
            or np.any(dual <= 0)
            or not np.isfinite(dual).all()
        ):
            raise ValueError("positive matching dual volumes required")
        return sparse.diags(dual / primal)

    def betti(self, max_simplices=512):
        if sum(map(len, self.simplices)) > max_simplices:
            raise ValueError("dense rank/cohomology budget exceeded")
        ranks = (
            [0]
            + [
                int(np.linalg.matrix_rank(b.toarray().astype(float)))
                for b in self.boundaries
            ]
            + [0]
        )
        return [len(s) - ranks[k] - ranks[k + 1] for k, s in enumerate(self.simplices)]

    def gaussian_curvature(self):
        if self.dimension != 2:
            raise ValueError("triangle surface required")
        defect = np.full(len(self.vertices), 2 * np.pi)
        edge_count = {}
        for triangle in self.simplices[2]:
            for i, v in enumerate(triangle):
                a = self.vertices[triangle[(i + 1) % 3]] - self.vertices[v]
                b = self.vertices[triangle[(i + 2) % 3]] - self.vertices[v]
                denom = np.linalg.norm(a) * np.linalg.norm(b)
                if denom <= 0:
                    raise ValueError("degenerate surface")
                defect[v] -= np.arccos(np.clip(a @ b / denom, -1, 1))
            for edge in combinations(triangle, 2):
                edge_count[tuple(sorted(edge))] = (
                    edge_count.get(tuple(sorted(edge)), 0) + 1
                )
        boundary = {v for edge, count in edge_count.items() if count == 1 for v in edge}
        for v in boundary:
            defect[v] -= np.pi
        return defect

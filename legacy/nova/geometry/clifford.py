"""Finite Clifford algebra including Cl(4,1), with an explicit conformal embedding."""

import numpy as np


class Clifford:
    def __init__(self, signature=(1, 1, 1, 1, -1)):
        if not 1 <= len(signature) <= 6 or any(s not in (-1, 1) for s in signature):
            raise ValueError("nondegenerate diagonal metric of dimension <=6 required")
        self.signature = tuple(signature)
        self.size = 1 << len(signature)

    def product(self, a, b):
        a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
        if (
            a.shape != (self.size,)
            or b.shape != a.shape
            or not np.isfinite(a).all()
            or not np.isfinite(b).all()
        ):
            raise ValueError("finite multivector shape mismatch")
        out = np.zeros(self.size)
        for i in np.flatnonzero(a):
            for j in np.flatnonzero(b):
                swaps = sum(
                    (int(j) & ((1 << k) - 1)).bit_count()
                    for k in range(len(self.signature))
                    if int(i) & (1 << k)
                )
                factor = (-1) ** swaps
                for k, s in enumerate(self.signature):
                    if (int(i) & int(j)) & (1 << k):
                        factor *= s
                out[int(i) ^ int(j)] += factor * a[i] * b[j]
        return out

    def conformal_point(self, point):
        if self.signature != (1, 1, 1, 1, -1):
            raise ValueError("conformal embedding requires Cl(4,1) convention")
        p = np.asarray(point, dtype=float)
        if p.shape != (3,) or not np.isfinite(p).all():
            raise ValueError("finite Euclidean 3-point required")
        out = np.zeros(self.size)
        for k in range(3):
            out[1 << k] = p[k]
        # e_o=(e_- - e_+)/2, e_inf=e_-+e_+; X^2=0.
        out[1 << 3] = 0.5 * (p @ p - 1)
        out[1 << 4] = 0.5 * (p @ p + 1)
        return out

    def reverse(self, a):
        a = np.asarray(a, dtype=float)
        if a.shape != (self.size,):
            raise ValueError("multivector shape mismatch")
        return a * np.array(
            [
                (-1) ** (i.bit_count() * (i.bit_count() - 1) // 2)
                for i in range(self.size)
            ]
        )

    def wedge(self, a, b):
        a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
        if a.shape != (self.size,) or b.shape != a.shape:
            raise ValueError("multivector shape mismatch")
        out = np.zeros(self.size)
        for i in np.flatnonzero(a):
            for j in np.flatnonzero(b):
                if int(i) & int(j):
                    continue
                swaps = sum(
                    (int(j) & ((1 << k) - 1)).bit_count()
                    for k in range(len(self.signature))
                    if int(i) & (1 << k)
                )
                out[int(i) ^ int(j)] += (-1) ** swaps * a[i] * b[j]
        return out

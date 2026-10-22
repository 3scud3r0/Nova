"""Optional NVIDIA Warp force reference. O(N^2), explicit device, no core dependency."""
import numpy as np
import warp as wp


@wp.kernel
def advance(p: wp.array(dtype=wp.vec3), v: wp.array(dtype=wp.vec3),
            species: wp.array(dtype=wp.int32), matrix: wp.array(dtype=wp.float32),
            out_p: wp.array(dtype=wp.vec3), out_v: wp.array(dtype=wp.vec3),
            n: int, dt: float, cutoff: float):
    i = wp.tid()
    force = wp.vec3(0.0, 0.0, 0.0)
    for j in range(n):
        if i != j:
            d = p[j] - p[i]
            r = wp.length(d)
            if r > 1e-9 and r < cutoff:
                q = r / cutoff
                weight = matrix[species[i]*8+species[j]] * (1.0-wp.abs(2.0*q-1.25)/0.75)
                if q < 0.25:
                    weight = q/0.25-1.0
                force = force + d/r*weight*4.0
    out_v[i] = (v[i]+dt*force)*wp.exp(-1.8*dt)
    out_p[i] = p[i]+dt*out_v[i]


class WarpLife:
    def __init__(self, positions, velocities, species, matrix, *, device="cpu", dt=1/120, cutoff=0.35):
        positions, velocities, species, matrix = map(np.asarray, (positions, velocities, species, matrix))
        if (positions.ndim != 2 or positions.shape[1] != 3 or velocities.shape != positions.shape
                or species.shape != (len(positions),) or matrix.shape != (8, 8)
                or not all(np.isfinite(a).all() for a in (positions, velocities, species, matrix))
                or np.any((species < 0) | (species > 7) | (species != np.floor(species)))
                or np.any(np.abs(matrix) > 1) or not np.isfinite([dt, cutoff]).all()):
            raise ValueError("invalid particle arrays, species or affinity matrix")
        self.n = len(positions)
        if not 1 <= self.n <= 4096 or not 0 < dt <= 0.02 or cutoff <= 0:
            raise ValueError("Warp reference budget exceeded")
        self.device, self.dt, self.cutoff = device, dt, cutoff
        self.p = wp.array(np.asarray(positions, np.float32), dtype=wp.vec3, device=device)
        self.v = wp.array(np.asarray(velocities, np.float32), dtype=wp.vec3, device=device)
        self.species = wp.array(np.asarray(species, np.int32), dtype=wp.int32, device=device)
        self.matrix = wp.array(np.asarray(matrix, np.float32).reshape(64), dtype=wp.float32, device=device)
        self.out_p, self.out_v = wp.empty_like(self.p), wp.empty_like(self.v)

    def step(self, ticks=1):
        if not 0 <= ticks <= 100000:
            raise ValueError("tick budget exceeded")
        for _ in range(ticks):
            wp.launch(advance, dim=self.n, inputs=[self.p, self.v, self.species, self.matrix,
                      self.out_p, self.out_v, self.n, self.dt, self.cutoff], device=self.device)
            self.p, self.out_p = self.out_p, self.p
            self.v, self.out_v = self.out_v, self.v

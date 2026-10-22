"""Optional Taichi canonical force reference. O(N^2), bounded at 4096 particles."""
import numpy as np
import taichi as ti


@ti.data_oriented
class TaichiLife:
    def __init__(self, positions, velocities, species, matrix, *, dt=1/120, cutoff=0.35):
        positions, velocities, species, matrix = map(np.asarray, (positions, velocities, species, matrix))
        if (positions.ndim != 2 or positions.shape[1] != 3 or velocities.shape != positions.shape
                or species.shape != (len(positions),) or matrix.shape != (8, 8)
                or not all(np.isfinite(a).all() for a in (positions, velocities, species, matrix))
                or np.any((species < 0) | (species > 7) | (species != np.floor(species)))
                or np.any(np.abs(matrix) > 1) or not np.isfinite([dt, cutoff]).all()):
            raise ValueError("invalid particle arrays, species or affinity matrix")
        n = len(positions)
        if not 1 <= n <= 4096 or not 0 < dt <= 0.02 or cutoff <= 0:
            raise ValueError("Taichi reference budget exceeded")
        self.n, self.dt, self.cutoff = n, dt, cutoff
        # Call ti.init(arch=ti.vulkan/ti.cuda/ti.cpu) explicitly before construction.
        self.p = ti.Vector.field(3, ti.f32, shape=n)
        self.v = ti.Vector.field(3, ti.f32, shape=n)
        self.next_v = ti.Vector.field(3, ti.f32, shape=n)
        self.species = ti.field(ti.i32, shape=n)
        self.matrix = ti.field(ti.f32, shape=(8, 8))
        self.p.from_numpy(np.asarray(positions, np.float32))
        self.v.from_numpy(np.asarray(velocities, np.float32))
        self.species.from_numpy(np.asarray(species, np.int32))
        self.matrix.from_numpy(np.asarray(matrix, np.float32))

    @ti.kernel
    def forces(self):
        for i in range(self.n):
            f = ti.Vector([0.0, 0.0, 0.0])
            for j in range(self.n):
                if i != j:
                    d = self.p[j] - self.p[i]
                    r = d.norm()
                    if r > 1e-9 and r < self.cutoff:
                        q = r / self.cutoff
                        weight = self.matrix[self.species[i], self.species[j]] * (1 - ti.abs(2*q-1.25)/0.75)
                        if q < 0.25:
                            weight = q / 0.25 - 1
                        f += d / r * weight * 4
            self.next_v[i] = (self.v[i] + self.dt*f) * ti.exp(-1.8*self.dt)

    @ti.kernel
    def integrate(self):
        for i in range(self.n):
            self.v[i] = self.next_v[i]
            self.p[i] += self.dt*self.v[i]

    def step(self, ticks=1):
        if not 0 <= ticks <= 100000:
            raise ValueError("tick budget exceeded")
        for _ in range(ticks):
            self.forces()
            self.integrate()

import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  GuideSpec,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';
import { hslToRgb } from '../core/color';
import { SpatialGrid } from '../physics/spatialGrid';

// Molecular-dynamics crystallization: point "atoms" interacting through a conservative Lennard-Jones
// pair potential, integrated with velocity-Verlet and held at a target temperature by a Berendsen
// thermostat. Unlike Particle Life (asymmetric, non-conservative rules), this MINIMISES a real energy
// whose floor is a close-packed lattice — so cooling anneals a gas into a hexagonal crystal, and
// reheating melts it back. 2-D in the z=0 plane (cleanest hex lattice); the engine SpatialGrid keeps
// the short-range force O(n). A soft-core clamp (never evaluate the force below 0.85σ) kills the r→0
// LJ singularity, and a reflecting box keeps every atom on screen.
const DIM = 6; // [x, y, z, vx, vy, vz] — z, vz pinned to 0 so SpatialGrid (which reads x,y,z) works verbatim
const SIGMA_BASE = 0.9; // base LJ σ; the `spacing` param scales it
const EPS_BASE = 1.0; // base well depth; `epsilon` scales it
const RMIN_FRAC = 0.85; // soft core: clamp r² so the force is never evaluated below 0.85σ
const RCUT_FRAC = 2.5; // LJ cutoff at 2.5σ (= grid cell size)
const FILL = 0.72; // packing fraction used to size the box
const HALF_CAP = 44; // hard cap on box half-extent (keeps maxAbs < 50 at any count)
const TAU = 0.6; // Berendsen relaxation time (in dt units)
const RENDER_HALF = 2.5; // physics box (±HALF, grows with count) is mapped to this FIXED render extent
// so the camera frames a dense lattice regardless of atom count (raw ±HALF would be tiny dust on screen)

const PARAM_SPEC: ParamSpec[] = [
  { key: 'temperature', label: 'temperature', min: 0, max: 4, step: 0.01, default: 0.25 }, // 0 = freeze, high = gas
  { key: 'epsilon', label: 'ε bond', min: 0.3, max: 3, step: 0.05, default: 1 }, // well depth (cohesion)
  { key: 'spacing', label: 'σ spacing', min: 0.7, max: 1.3, step: 0.02, default: 1 }, // scales the lattice constant
  { key: 'gravity', label: 'gravity', min: 0, max: 0.5, step: 0.01, default: 0 }, // optional downward g
];

function boxHalf(n: number, a0: number): number {
  return Math.min(HALF_CAP, 0.5 * Math.sqrt((n * a0 * a0 * 0.866) / FILL));
}

class CrystalArchetype implements Archetype {
  readonly id = 'crystal';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly state: Float64Array; // [x,y,z,vx,vy,vz] per atom (z,vz ≡ 0)
  private readonly accel: Float64Array; // [ax,ay] per atom
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly grid: SpatialGrid;
  private readonly a0: number; // rest lattice constant (for the render point size + box)
  private readonly half: number;

  constructor(config: ArchetypeConfig) {
    const n = config.particleCount;
    this.particleCount = n;
    const sigma = SIGMA_BASE * (config.params.spacing ?? 1);
    this.a0 = sigma * Math.pow(2, 1 / 6); // LJ minimum separation
    this.half = boxHalf(n, this.a0);
    this.state = new Float64Array(n * DIM);
    this.accel = new Float64Array(n * 2);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.grid = new SpatialGrid(n, this.half);

    const rng = mulberry32(config.seed);
    const T0 = config.params.temperature ?? 0.5;
    const speed = Math.sqrt(Math.max(0, T0));
    // seed a perturbed hex lattice centred in the box (rows offset by a0/2, row pitch a0·√3/2)
    const cols = Math.max(1, Math.ceil(Math.sqrt(n / 0.866)));
    const rows = Math.ceil(n / cols);
    const pitchY = this.a0 * 0.866;
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = (col + (row % 2) * 0.5 - cols * 0.5) * this.a0 + (rng() - 0.5) * 0.1 * this.a0;
      const y = (row - rows * 0.5) * pitchY + (rng() - 0.5) * 0.1 * this.a0;
      const ang = rng() * Math.PI * 2;
      this.state[o] = x;
      this.state[o + 1] = y;
      // z, vz stay 0
      this.state[o + 3] = Math.cos(ang) * speed;
      this.state[o + 4] = Math.sin(ang) * speed;
      hslToRgb(0.6, 0.85, 0.6, this.colors, i * 3);
    }
    this.computeAccel(config.params as ResolvedParams);
    this.syncPositions();
  }

  // Lennard-Jones acceleration via the cell list (reflecting box → non-wrapping 27-cell stencil).
  private computeAccel(p: ResolvedParams): void {
    const st = this.state;
    const acc = this.accel;
    const n = this.particleCount;
    const sigma = SIGMA_BASE * (p.spacing ?? 1);
    const eps = EPS_BASE * (p.epsilon ?? 1);
    const rcut = RCUT_FRAC * sigma;
    const rcut2 = rcut * rcut;
    const rmin2 = (RMIN_FRAC * sigma) ** 2;
    const sigma2 = sigma * sigma;
    const grav = p.gravity ?? 0;
    acc.fill(0);
    this.grid.build(st, DIM, 0, n, rcut);
    const g = this.grid.gx;
    const start = this.grid.cellStart;
    const order = this.grid.order;
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const xi = st[o], yi = st[o + 1];
      const cx = this.grid.coord(xi), cy = this.grid.coord(yi), cz = this.grid.coord(0);
      let ax = 0, ay = 0;
      for (let dz = -1; dz <= 1; dz++) {
        const ncz = cz + dz; if (ncz < 0 || ncz >= g) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const ncy = cy + dy; if (ncy < 0 || ncy >= g) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const ncx = cx + dx; if (ncx < 0 || ncx >= g) continue;
            const c = (ncz * g + ncy) * g + ncx;
            for (let k = start[c]; k < start[c + 1]; k++) {
              const j = order[k];
              if (j === i) continue;
              const jo = j * DIM;
              const ddx = st[jo] - xi, ddy = st[jo + 1] - yi;
              const r2 = ddx * ddx + ddy * ddy;
              if (r2 >= rcut2 || r2 < 1e-12) continue;
              const re2 = r2 < rmin2 ? rmin2 : r2; // soft core: never below 0.85σ
              const sr2 = sigma2 / re2;
              const sr6 = sr2 * sr2 * sr2;
              const sr12 = sr6 * sr6;
              const fOverR = (24 * eps * (2 * sr12 - sr6)) / re2; // >0 = repulsive at small r
              ax += -fOverR * ddx;
              ay += -fOverR * ddy;
            }
          }
        }
      }
      acc[i * 2] = ax;
      acc[i * 2 + 1] = ay - grav; // gravity pulls −y
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const st = this.state;
    const acc = this.accel;
    const n = this.particleCount;
    const half = this.half;
    // velocity-Verlet, first half (x,y only)
    for (let i = 0; i < n; i++) {
      const o = i * DIM, ai = i * 2;
      st[o] += st[o + 3] * dt + 0.5 * acc[ai] * dt * dt;
      st[o + 1] += st[o + 4] * dt + 0.5 * acc[ai + 1] * dt * dt;
      st[o + 3] += 0.5 * acc[ai] * dt;
      st[o + 4] += 0.5 * acc[ai + 1] * dt;
      // reflecting box: mirror position about the wall it crossed + flip that velocity
      if (st[o] > half) { st[o] = 2 * half - st[o]; st[o + 3] = -st[o + 3]; }
      else if (st[o] < -half) { st[o] = -2 * half - st[o]; st[o + 3] = -st[o + 3]; }
      if (st[o + 1] > half) { st[o + 1] = 2 * half - st[o + 1]; st[o + 4] = -st[o + 4]; }
      else if (st[o + 1] < -half) { st[o + 1] = -2 * half - st[o + 1]; st[o + 4] = -st[o + 4]; }
    }
    this.computeAccel(p);
    for (let i = 0; i < n; i++) {
      const o = i * DIM, ai = i * 2;
      st[o + 3] += 0.5 * acc[ai] * dt;
      st[o + 4] += 0.5 * acc[ai + 1] * dt;
    }
    // Berendsen thermostat: rescale velocities toward the target temperature (kB=1, 2 dof → T=KE/n)
    let ke = 0;
    for (let i = 0; i < n; i++) { const o = i * DIM; ke += 0.5 * (st[o + 3] * st[o + 3] + st[o + 4] * st[o + 4]); }
    const T = ke / n;
    const Ttarget = p.temperature ?? 0.5;
    if (T > 1e-12) {
      let lam2 = 1 + (dt / TAU) * (Ttarget / T - 1);
      lam2 = lam2 < 0.25 ? 0.25 : lam2 > 4 ? 4 : lam2; // clamp = a second guard against energy spikes
      const lam = Math.sqrt(lam2);
      for (let i = 0; i < n; i++) { const o = i * DIM; st[o + 3] *= lam; st[o + 4] *= lam; }
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const st = this.state;
    const pos = this.positions;
    const col = this.colors;
    const n = this.particleCount;
    const k = RENDER_HALF / this.half; // map the physical ±HALF box to a fixed ±RENDER_HALF on screen
    for (let i = 0; i < n; i++) {
      const o = i * DIM, po = i * 3;
      let x = st[o], y = st[o + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) { x = 0; y = 0; st[o] = 0; st[o + 1] = 0; st[o + 3] = 0; st[o + 4] = 0; }
      pos[po] = x * k;
      pos[po + 1] = y * k;
      pos[po + 2] = 0; // strictly the z=0 plane
      const spd = Math.hypot(st[o + 3], st[o + 4]);
      const hue = Math.max(0, Math.min(0.62, 0.62 - spd * 0.5)); // cool-blue crystal → warm-red gas
      hslToRgb(hue, 0.85, 0.55, col, po);
    }
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return this.state; }
  loadState(s: Float64Array): void { this.state.set(s.subarray(0, this.state.length)); this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Crystal (${this.particleCount})`, stateOffset: 0, stateLength: this.state.length, particleStart: 0, particleCount: this.particleCount }];
  }
  renderHint(): RenderHint {
    // positions are normalised to ±RENDER_HALF, so a fixed small dot reads as a crisp lattice point
    // (WebGPU clamps to ~1px regardless; this sizes the WebGL2 fallback sensibly).
    return { geometry: 'points', pointSize: 0.02 };
  }
  dispose(): void { /* buffers GC with the instance */ }
}

// Box boundary as a closed square guide loop — drawn at the FIXED render extent (positions are
// normalised to ±RENDER_HALF), so the wall hugs the lattice regardless of atom count.
function boxGuide(): GuideSpec {
  const H = RENDER_HALF;
  return [{ points: [[-H, -H, 0], [H, -H, 0], [H, H, 0], [-H, H, 0]], color: 0x6fb7ff, closed: true }];
}

export const crystalFactory: ArchetypeFactory = {
  id: 'crystal',
  label: 'Crystallization',
  category: 'Matter',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 4000,
  particleCountOptions: [1024, 2048, 4000, 8000],
  defaultDt: 0.006,
  defaultTrail: 24, // short trails: glints of motion while the frozen lattice stays crisp
  guides: (): GuideSpec => boxGuide(),
  create: (config) => new CrystalArchetype(config),
};

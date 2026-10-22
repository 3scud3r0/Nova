import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';
import { mulberry32 } from '../state/rng';
import { SpatialGrid } from '../physics/spatialGrid';

// Particle Life: K species in a toroidal cube, governed by an ASYMMETRIC K×K interaction matrix
// (how species i feels species j). A universal short-range repulsion plus the per-pair coefficient
// produces emergent cells, membranes, chasers, and self-replicating blobs — life-like structure
// from a random matrix. O(n²) forces (CPU worker), overdamped/friction dynamics. Species are
// assigned in contiguous blocks so the hierarchy tree can spotlight each one.
const PARAM_SPEC: ParamSpec[] = [
  { key: 'radius', label: 'r_max', min: 0.15, max: 1.0, step: 0.01, default: 0.55 },
  { key: 'beta', label: 'β repel', min: 0.05, max: 0.6, step: 0.01, default: 0.3 },
  { key: 'friction', label: 'friction', min: 0.5, max: 0.97, step: 0.01, default: 0.86 },
  { key: 'force', label: 'force', min: 0.5, max: 10, step: 0.1, default: 4 },
  { key: 'species', label: 'species', min: 2, max: 7, step: 1, default: 5, options: { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 }, rebuild: true },
  { key: 'variant', label: 'ecosystem', min: 1, max: 60, step: 1, default: 1, rebuild: true },
];

const DIM = 6; // x,y,z, vx,vy,vz
const DOMAIN = 1.5; // half-extent of the cubic toroidal domain
const L = DOMAIN * 2;

class ParticleLifeArchetype implements Archetype {
  readonly id = 'particleLife';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly K: number;
  private readonly state: Float64Array; // pos3 + vel3
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly species: Uint8Array;
  private readonly A: Float64Array; // K×K interaction coefficients in [-1,1]
  private readonly starts: number[] = []; // contiguous species ranges
  private readonly counts: number[] = [];
  private readonly grid: SpatialGrid;

  constructor(config: ArchetypeConfig) {
    this.particleCount = config.particleCount;
    const n = this.particleCount;
    this.K = Math.max(2, Math.min(7, Math.round(config.params.species ?? 5)));
    const K = this.K;
    this.state = new Float64Array(n * DIM);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.species = new Uint8Array(n);
    this.grid = new SpatialGrid(n, DOMAIN);

    const variant = Math.round(config.params.variant ?? 1);
    const rng = mulberry32(config.seed * 1000 + variant);
    this.A = new Float64Array(K * K);
    for (let i = 0; i < K * K; i++) this.A[i] = rng() * 2 - 1;

    for (let s = 0; s < K; s++) this.counts[s] = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.floor((i * K) / n);
      this.species[i] = s;
      this.counts[s]++;
      const o = i * DIM;
      this.state[o] = (rng() * 2 - 1) * DOMAIN;
      this.state[o + 1] = (rng() * 2 - 1) * DOMAIN;
      this.state[o + 2] = (rng() * 2 - 1) * DOMAIN;
      hslToRgb((s / K) * 0.85, 0.85, 0.62, this.colors, i * 3);
    }
    this.starts[0] = 0;
    for (let s = 1; s < K; s++) this.starts[s] = this.starts[s - 1] + this.counts[s - 1];

    this.syncPositions();
  }

  step(dt: number, p: ResolvedParams): void {
    const n = this.particleCount;
    const st = this.state;
    const sp = this.species;
    const A = this.A;
    const K = this.K;
    const rMax = p.radius ?? 0.55;
    const beta = p.beta ?? 0.3;
    const fr = p.friction ?? 0.86;
    const fs = p.force ?? 4;
    const rMax2 = rMax * rMax;
    const invBeta1 = 1 / (1 - beta);
    const grid = this.grid;

    // Pass 1: accumulate forces via the spatial grid (positions read-only here; forces depend only
    // on positions + species, so updating each velocity in place is order-independent).
    grid.build(st, DIM, 0, n, rMax);
    const gx = grid.gx;
    const cstart = grid.cellStart;
    const order = grid.order;

    for (let i = 0; i < n; i++) {
      const oi = i * DIM;
      const xi = st[oi];
      const yi = st[oi + 1];
      const zi = st[oi + 2];
      const rowi = sp[i] * K;
      let fx = 0;
      let fy = 0;
      let fz = 0;
      const cx = grid.coord(xi);
      const cy = grid.coord(yi);
      const cz = grid.coord(zi);
      for (let cdz = -1; cdz <= 1; cdz++) {
        const ncz = (cz + cdz + gx) % gx;
        for (let cdy = -1; cdy <= 1; cdy++) {
          const ncy = (cy + cdy + gx) % gx;
          for (let cdx = -1; cdx <= 1; cdx++) {
            const ncx = (cx + cdx + gx) % gx;
            const c = (ncz * gx + ncy) * gx + ncx;
            for (let k = cstart[c]; k < cstart[c + 1]; k++) {
              const j = order[k];
              if (j === i) continue;
              const oj = j * DIM;
              let dx = st[oj] - xi;
              let dy = st[oj + 1] - yi;
              let dz = st[oj + 2] - zi;
              if (dx > DOMAIN) dx -= L; else if (dx < -DOMAIN) dx += L; // toroidal min-image
              if (dy > DOMAIN) dy -= L; else if (dy < -DOMAIN) dy += L;
              if (dz > DOMAIN) dz -= L; else if (dz < -DOMAIN) dz += L;
              const r2 = dx * dx + dy * dy + dz * dz;
              if (r2 >= rMax2 || r2 < 1e-10) continue;
              const r = Math.sqrt(r2);
              const rn = r / rMax;
              const F = rn < beta ? rn / beta - 1 : A[rowi + sp[j]] * (1 - Math.abs(2 * rn - 1 - beta) * invBeta1);
              const g = F / r;
              fx += dx * g;
              fy += dy * g;
              fz += dz * g;
            }
          }
        }
      }
      st[oi + 3] = (st[oi + 3] + fx * fs * dt) * fr;
      st[oi + 4] = (st[oi + 4] + fy * fs * dt) * fr;
      st[oi + 5] = (st[oi + 5] + fz * fs * dt) * fr;
    }

    // Pass 2: advect + toroidal wrap.
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      let x = st[o] + st[o + 3] * dt;
      let y = st[o + 1] + st[o + 4] * dt;
      let z = st[o + 2] + st[o + 5] * dt;
      if (x > DOMAIN) x -= L; else if (x < -DOMAIN) x += L;
      if (y > DOMAIN) y -= L; else if (y < -DOMAIN) y += L;
      if (z > DOMAIN) z -= L; else if (z < -DOMAIN) z += L;
      st[o] = x;
      st[o + 1] = y;
      st[o + 2] = z;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const n = this.particleCount;
    const st = this.state;
    const pos = this.positions;
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const po = i * 3;
      if (!Number.isFinite(st[o])) {
        st[o] = 0;
        st[o + 1] = 0;
        st[o + 2] = 0;
        st[o + 3] = 0;
        st[o + 4] = 0;
        st[o + 5] = 0;
      }
      pos[po] = st[o];
      pos[po + 1] = st[o + 1];
      pos[po + 2] = st[o + 2];
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }

  readColors(): Float32Array {
    return this.colors;
  }

  readState(): Float64Array {
    return this.state;
  }

  loadState(s: Float64Array): void {
    this.state.set(s.subarray(0, this.state.length));
    this.syncPositions();
  }

  getHierarchy(): NodeSpec[] {
    const nodes: NodeSpec[] = [
      { id: 'root', parentId: null, label: `Ecosystem (${this.K} species)`, stateOffset: 0, stateLength: this.state.length, particleStart: 0, particleCount: this.particleCount },
    ];
    for (let s = 0; s < this.K; s++) {
      nodes.push({ id: `species${s}`, parentId: 'root', label: `Species ${s} (${this.counts[s]})`, stateOffset: this.starts[s] * DIM, stateLength: this.counts[s] * DIM, particleStart: this.starts[s], particleCount: this.counts[s] });
    }
    return nodes;
  }

  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.02 };
  }

  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const particleLifeFactory: ArchetypeFactory = {
  id: 'particleLife',
  label: 'Particle Life',
  category: 'Life',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 8000,
  particleCountOptions: [2000, 4000, 8000, 16000],
  defaultDt: 0.015,
  create: (config) => new ParticleLifeArchetype(config),
};

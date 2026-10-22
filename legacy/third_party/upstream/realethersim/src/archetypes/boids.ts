import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { spectralGradient } from '../core/color';
import { mulberry32 } from '../state/rng';
import { SpatialGrid } from '../physics/spatialGrid';

// Boids (Reynolds flocking): separation + alignment + cohesion within a perception radius, in a
// toroidal cube. Neighbour queries go through the shared SpatialGrid, so flocks scale to tens of
// thousands. Two passes: steering is accumulated from the previous step's positions/velocities
// (so alignment is order-independent), then velocities integrate with a speed clamp.
const PARAM_SPEC: ParamSpec[] = [
  { key: 'radius', label: 'perception', min: 0.15, max: 1.0, step: 0.01, default: 0.4 },
  { key: 'separation', label: 'separation', min: 0, max: 4, step: 0.05, default: 1.6 },
  { key: 'alignment', label: 'alignment', min: 0, max: 3, step: 0.05, default: 1.0 },
  { key: 'cohesion', label: 'cohesion', min: 0, max: 3, step: 0.05, default: 0.9 },
  { key: 'maxSpeed', label: 'max speed', min: 0.1, max: 1.5, step: 0.05, default: 0.6 },
];

const DIM = 6;
const DOMAIN = 1.5;
const L = DOMAIN * 2;
const SEP_FRAC = 0.45; // separation acts within SEP_FRAC × perception radius

class BoidsArchetype implements Archetype {
  readonly id = 'boids';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly state: Float64Array; // pos3 + vel3
  private readonly acc: Float64Array; // n × 3 steering, filled each step
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly grid: SpatialGrid;

  constructor(config: ArchetypeConfig) {
    this.particleCount = config.particleCount;
    const n = this.particleCount;
    this.state = new Float64Array(n * DIM);
    this.acc = new Float64Array(n * 3);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.grid = new SpatialGrid(n, DOMAIN);

    const rng = mulberry32(config.seed);
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      this.state[o] = (rng() * 2 - 1) * DOMAIN;
      this.state[o + 1] = (rng() * 2 - 1) * DOMAIN;
      this.state[o + 2] = (rng() * 2 - 1) * DOMAIN;
      this.state[o + 3] = (rng() * 2 - 1) * 0.3;
      this.state[o + 4] = (rng() * 2 - 1) * 0.3;
      this.state[o + 5] = (rng() * 2 - 1) * 0.3;
    }
    spectralGradient(n, this.colors);
    this.syncPositions();
  }

  step(dt: number, p: ResolvedParams): void {
    const n = this.particleCount;
    const st = this.state;
    const acc = this.acc;
    const grid = this.grid;
    const rMax = p.radius ?? 0.4;
    const wSep = p.separation ?? 1.6;
    const wAli = p.alignment ?? 1.0;
    const wCoh = p.cohesion ?? 0.9;
    const maxSpeed = p.maxSpeed ?? 0.6;
    const minSpeed = maxSpeed * 0.4;
    const rMax2 = rMax * rMax;
    const rSep2 = (rMax * SEP_FRAC) * (rMax * SEP_FRAC);

    grid.build(st, DIM, 0, n, rMax);
    const gx = grid.gx;
    const start = grid.cellStart;
    const order = grid.order;

    for (let i = 0; i < n; i++) {
      const oi = i * DIM;
      const xi = st[oi];
      const yi = st[oi + 1];
      const zi = st[oi + 2];
      let count = 0;
      let avx = 0; let avy = 0; let avz = 0; // neighbour velocity sum (alignment)
      let cox = 0; let coy = 0; let coz = 0; // neighbour offset sum (cohesion, min-image)
      let spx = 0; let spy = 0; let spz = 0; // separation push

      const cx = grid.coord(xi);
      const cy = grid.coord(yi);
      const cz = grid.coord(zi);
      for (let dz = -1; dz <= 1; dz++) {
        const ncz = (cz + dz + gx) % gx;
        for (let dy = -1; dy <= 1; dy++) {
          const ncy = (cy + dy + gx) % gx;
          for (let dx = -1; dx <= 1; dx++) {
            const ncx = (cx + dx + gx) % gx;
            const c = (ncz * gx + ncy) * gx + ncx;
            for (let k = start[c]; k < start[c + 1]; k++) {
              const j = order[k];
              if (j === i) continue;
              const oj = j * DIM;
              let ddx = st[oj] - xi;
              let ddy = st[oj + 1] - yi;
              let ddz = st[oj + 2] - zi;
              if (ddx > DOMAIN) ddx -= L; else if (ddx < -DOMAIN) ddx += L;
              if (ddy > DOMAIN) ddy -= L; else if (ddy < -DOMAIN) ddy += L;
              if (ddz > DOMAIN) ddz -= L; else if (ddz < -DOMAIN) ddz += L;
              const r2 = ddx * ddx + ddy * ddy + ddz * ddz;
              if (r2 >= rMax2 || r2 < 1e-12) continue;
              count++;
              avx += st[oj + 3]; avy += st[oj + 4]; avz += st[oj + 5];
              cox += ddx; coy += ddy; coz += ddz;
              if (r2 < rSep2) {
                const inv = 1 / r2;
                spx -= ddx * inv; spy -= ddy * inv; spz -= ddz * inv;
              }
            }
          }
        }
      }

      const ai = i * 3;
      if (count > 0) {
        const inv = 1 / count;
        acc[ai] = (avx * inv - st[oi + 3]) * wAli + cox * inv * wCoh + spx * wSep;
        acc[ai + 1] = (avy * inv - st[oi + 4]) * wAli + coy * inv * wCoh + spy * wSep;
        acc[ai + 2] = (avz * inv - st[oi + 5]) * wAli + coz * inv * wCoh + spz * wSep;
      } else {
        acc[ai] = 0; acc[ai + 1] = 0; acc[ai + 2] = 0;
      }
    }

    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const ai = i * 3;
      let vx = st[o + 3] + acc[ai] * dt;
      let vy = st[o + 4] + acc[ai + 1] * dt;
      let vz = st[o + 5] + acc[ai + 2] * dt;
      const sp = Math.hypot(vx, vy, vz) || 1e-9;
      const clamped = sp > maxSpeed ? maxSpeed : sp < minSpeed ? minSpeed : sp;
      const s = clamped / sp;
      vx *= s; vy *= s; vz *= s;
      st[o + 3] = vx; st[o + 4] = vy; st[o + 5] = vz;
      let x = st[o] + vx * dt;
      let y = st[o + 1] + vy * dt;
      let z = st[o + 2] + vz * dt;
      if (x > DOMAIN) x -= L; else if (x < -DOMAIN) x += L;
      if (y > DOMAIN) y -= L; else if (y < -DOMAIN) y += L;
      if (z > DOMAIN) z -= L; else if (z < -DOMAIN) z += L;
      st[o] = x; st[o + 1] = y; st[o + 2] = z;
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
    return [{ id: 'root', parentId: null, label: 'Flock', stateOffset: 0, stateLength: this.state.length, particleStart: 0, particleCount: this.particleCount }];
  }

  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.016 };
  }

  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const boidsFactory: ArchetypeFactory = {
  id: 'boids',
  label: 'Boids (flocking)',
  category: 'Life',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 8000,
  particleCountOptions: [2000, 4000, 8000, 16000],
  defaultDt: 0.02,
  create: (config) => new BoidsArchetype(config),
};

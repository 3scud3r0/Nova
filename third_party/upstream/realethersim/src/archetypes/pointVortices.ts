import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Point-vortex flow (2D ideal fluid): a handful of vortices with ± circulation induce a velocity
// field (softened Biot–Savart, toroidal min-image); the rest are massless tracers advected by that
// field, so the streamlines reveal the flow. Vortices pair, orbit, and shed — tracers trace the
// swirls. Bounded by softening + toroidal wrap (can't blow up). Render the points in the z=0 plane.
const PARAM_SPEC: ParamSpec[] = [
  { key: 'vortices', label: 'vortices', min: 2, max: 120, step: 1, default: 32, options: { '8': 8, '16': 16, '32': 32, '64': 64 }, rebuild: true },
  { key: 'strength', label: 'circulation', min: 0.05, max: 1.5, step: 0.05, default: 0.5 },
  { key: 'softening', label: 'softening', min: 0.02, max: 0.5, step: 0.01, default: 0.08 },
];

const DIM = 2;
const DOMAIN = 1.5;
const L = DOMAIN * 2;
const INV2PI = 1 / (2 * Math.PI);

class PointVorticesArchetype implements Archetype {
  readonly id = 'pointVortices';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly nv: number; // first nv particles are vortices
  private readonly state: Float64Array; // x, y
  private readonly vel: Float64Array; // n × 2 induced velocity (scratch per step)
  private readonly gamma: Float64Array; // circulation (0 for tracers)
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  constructor(config: ArchetypeConfig) {
    this.particleCount = config.particleCount;
    const n = this.particleCount;
    this.nv = Math.max(2, Math.min(n, Math.round(config.params.vortices ?? 32)));
    const strength = config.params.strength ?? 0.5;
    this.state = new Float64Array(n * DIM);
    this.vel = new Float64Array(n * 2);
    this.gamma = new Float64Array(n);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);

    const rng = mulberry32(config.seed);
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      this.state[o] = (rng() * 2 - 1) * DOMAIN;
      this.state[o + 1] = (rng() * 2 - 1) * DOMAIN;
      if (i < this.nv) {
        const g = (rng() < 0.5 ? 1 : -1) * strength;
        this.gamma[i] = g;
        // vortices coloured by sign (warm = +, cool = −)
        if (g > 0) { this.colors[i * 3] = 1.0; this.colors[i * 3 + 1] = 0.5; this.colors[i * 3 + 2] = 0.3; }
        else { this.colors[i * 3] = 0.3; this.colors[i * 3 + 1] = 0.6; this.colors[i * 3 + 2] = 1.0; }
      } else {
        const t = 0.45 + 0.4 * rng(); // faint tracers
        this.colors[i * 3] = t; this.colors[i * 3 + 1] = t; this.colors[i * 3 + 2] = t * 1.1;
      }
    }
    this.syncPositions();
  }

  step(dt: number, p: ResolvedParams): void {
    const n = this.particleCount;
    const nv = this.nv;
    const st = this.state;
    const gamma = this.gamma;
    const soft2 = (p.softening ?? 0.08) * (p.softening ?? 0.08);
    const vel = this.vel;

    // Pass 1: induced velocity for every particle from the (unchanged) vortex set.
    for (let i = 0; i < n; i++) {
      const oi = i * DIM;
      const xi = st[oi];
      const yi = st[oi + 1];
      let vx = 0;
      let vy = 0;
      for (let v = 0; v < nv; v++) {
        if (v === i) continue;
        const ov = v * DIM;
        let dx = xi - st[ov];
        let dy = yi - st[ov + 1];
        if (dx > DOMAIN) dx -= L; else if (dx < -DOMAIN) dx += L;
        if (dy > DOMAIN) dy -= L; else if (dy < -DOMAIN) dy += L;
        const inv = (gamma[v] * INV2PI) / (dx * dx + dy * dy + soft2);
        vx -= dy * inv; // perpendicular to the separation: (−dy, dx)
        vy += dx * inv;
      }
      vel[i * 2] = vx;
      vel[i * 2 + 1] = vy;
    }
    // Pass 2: advect + toroidal wrap.
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      let x = st[o] + vel[i * 2] * dt;
      let y = st[o + 1] + vel[i * 2 + 1] * dt;
      if (x > DOMAIN) x -= L; else if (x < -DOMAIN) x += L;
      if (y > DOMAIN) y -= L; else if (y < -DOMAIN) y += L;
      st[o] = x;
      st[o + 1] = y;
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
      pos[po + 1] = 0;
      pos[po + 2] = st[o + 1];
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
    return [{ id: 'root', parentId: null, label: `${this.nv} vortices`, stateOffset: 0, stateLength: this.state.length }];
  }

  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.012 };
  }

  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const pointVorticesFactory: ArchetypeFactory = {
  id: 'pointVortices',
  label: 'Point Vortices',
  category: 'Fluid',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 60_000,
  particleCountOptions: [20_000, 60_000, 120_000],
  defaultDt: 0.01,
  create: (config) => new PointVorticesArchetype(config),
};

import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Dandelion. The blowball is a near-perfect sphere of seeds, each on a thin stalk tipped with a
// pappus — a radial umbrella of fine bristles. It is a botanical lesson in spherical packing: the
// seed stalks point outward on a Fibonacci (golden-angle) sphere, so no two crowd, and each tip
// flares into a little burst of filaments. We grow that here: thin stalks from a small central
// receptacle out to a faintly ellipsoidal shell, each ending in a soft pappus puff, drawn in pale
// cream against the dark. A slow tumble shows the sphere. Bounded by construction.
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // golden angle → even spherical packing
const R0 = 0.16; // receptacle radius (where stalks begin)
const RSH = 1.2; // shell radius (where the pappus tips sit)

class DandelionArchetype implements Archetype {
  readonly id = 'dandelion';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly bx: Float64Array; // baked positions (pre-spin)
  private readonly by: Float64Array;
  private readonly bz: Float64Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private spin = 0.25;
  private t = 0;
  private buildKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    this.particleCount = Math.max(1, config.particleCount);
    this.bx = new Float64Array(this.particleCount);
    this.by = new Float64Array(this.particleCount);
    this.bz = new Float64Array(this.particleCount);
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.seed = config.seed;
    this.rebuild(config.params);
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round(p.seeds ?? 240)},${Math.round((p.puff ?? 0.13) * 100)},${Math.round((p.oblate ?? 1.08) * 100)}`;
  }

  private rebuild(p: ResolvedParams): void {
    const seeds = Math.max(16, Math.round(p.seeds ?? 240)); // number of stalks/seeds
    const puff = p.puff ?? 0.13; // pappus burst radius at each tip
    const oblate = p.oblate ?? 1.08; // vertical stretch → slightly ellipsoidal blowball
    this.spin = p.spin ?? 0.25;
    this.buildKey = this.keyOf(p);
    const rng = mulberry32((this.seed ^ 0xc2b2ae35) >>> 0);
    const N = this.particleCount;
    const col = this.colors;
    for (let i = 0; i < N; i++) {
      const k = i % seeds; // which stalk
      // Fibonacci-sphere direction for this stalk
      const yk = 1 - 2 * ((k + 0.5) / seeds);
      const rk = Math.sqrt(Math.max(0, 1 - yk * yk));
      const phi = k * GOLDEN;
      const dx = rk * Math.cos(phi);
      const dy = yk;
      const dz = rk * Math.sin(phi);
      const u = rng();
      let x: number;
      let y: number;
      let z: number;
      let r0 = 0;
      let g0 = 0;
      let b0 = 0;
      if (u < 0.45) {
        // stalk filament: a crisp radial line from the receptacle to the shell (these read as the spokes)
        const r = R0 + (RSH - R0) * rng();
        const j = (RSH - r) * 0.0025; // hairline jitter, tighter near the tip
        x = dx * r + (rng() - 0.5) * j;
        y = dy * r + (rng() - 0.5) * j;
        z = dz * r + (rng() - 0.5) * j;
        const sv = 0.45 + 0.4 * (r / RSH); // brighter toward the tip
        r0 = sv * 0.95;
        g0 = sv * 0.96;
        b0 = sv * 0.85;
      } else {
        // pappus puff: a soft burst of bristles around the tip (dir·RSH)
        const a = rng() * Math.PI * 2;
        const cz = rng() * 2 - 1;
        const sr = Math.sqrt(Math.max(0, 1 - cz * cz));
        const pr = puff * Math.cbrt(rng()); // dense near the tip, fading out
        x = dx * RSH + sr * Math.cos(a) * pr;
        y = dy * RSH + sr * Math.sin(a) * pr;
        z = dz * RSH + cz * pr;
        const v = 0.92 + 0.08 * (1 - pr / Math.max(1e-4, puff)); // bristle tips glow cream-white
        r0 = v;
        g0 = v * 0.98;
        b0 = v * 0.88;
      }
      // central receptacle tint (the seed cup) for the innermost points
      const rad = Math.hypot(x, y, z);
      if (rad < R0 * 1.5) {
        r0 = 0.5;
        g0 = 0.36;
        b0 = 0.22;
      }
      this.bx[i] = x;
      this.by[i] = y * oblate;
      this.bz[i] = z;
      col[i * 3] = r0;
      col[i * 3 + 1] = g0;
      col[i * 3 + 2] = b0;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const N = this.particleCount;
    const pos = this.positions;
    const th = this.spin * this.t; // slow tumble about the vertical axis
    const ct = Math.cos(th);
    const st = Math.sin(th);
    for (let i = 0; i < N; i++) {
      const x = this.bx[i];
      const z = this.bz[i];
      const o = i * 3;
      pos[o] = x * ct + z * st;
      pos[o + 1] = this.by[i];
      pos[o + 2] = -x * st + z * ct;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const key = this.keyOf(p);
    if (key !== this.buildKey) {
      this.rebuild(p);
      return;
    }
    this.spin = p.spin ?? 0.25;
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return new Float64Array([this.t]);
  }
  loadState(s: Float64Array): void {
    this.t = s[0] ?? 0;
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Dandelion blowball', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.011 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const dandelionFactory: ArchetypeFactory = {
  id: 'dandelion',
  label: 'Dandelion',
  category: 'Parametric',
  kind: 'flow',
  params: [
    { key: 'seeds', label: 'seeds', min: 60, max: 500, step: 10, default: 240, rebuild: true }, // stalk count
    { key: 'puff', label: 'pappus', min: 0.05, max: 0.25, step: 0.01, default: 0.13, rebuild: true }, // tip burst size
    { key: 'oblate', label: 'ellipsoid', min: 0.9, max: 1.3, step: 0.01, default: 1.08, rebuild: true }, // vertical stretch
    { key: 'spin', label: 'tumble', min: 0, max: 1.5, step: 0.05, default: 0.25 }, // rotation rate
  ],
  defaultParticleCount: 90_000,
  particleCountOptions: [40_000, 90_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the blowball IS the visual
  create: (config) => new DandelionArchetype(config),
};

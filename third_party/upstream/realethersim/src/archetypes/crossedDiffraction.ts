import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';
import { mulberry32 } from '../state/rng';

// Crossed Diffraction. Shine a white point source through crossed diffraction gratings and the light
// fans into a radiant lattice of spectral orders: a bright white zeroth order at the centre, and along
// each grating direction a row of higher orders at angles sin θ_m = m·λ/d. Because the deflection
// grows with wavelength, every order smears into a little spectrum — blue diffracts least (inner), red
// most (outer) — so each spoke becomes a string of rainbow blobs that spread farther apart at higher
// orders. We scatter points across that pattern (soft "bokeh" blobs), colour them by wavelength, and
// blaze the centre white. A flat optical figure; a gentle spin keeps it alive. Bounded by construction.
const TAU = Math.PI * 2;

class CrossedDiffractionArchetype implements Archetype {
  readonly id = 'crossedDiffraction';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly bx: Float64Array; // baked pattern x (pre-spin)
  private readonly by: Float64Array; // baked pattern y
  private readonly bz: Float64Array; // baked tiny depth (so orbiting reveals it isn't paper-flat)
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private spin = 0.15;
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
    return `${Math.round(p.arms ?? 18)},${Math.round(p.orders ?? 5)},${Math.round((p.spacing ?? 0.3) * 100)},${Math.round((p.spread ?? 0.55) * 100)}`;
  }

  private rebuild(p: ResolvedParams): void {
    const arms = Math.max(2, Math.round(p.arms ?? 18)); // grating-direction spokes
    const orders = Math.max(1, Math.round(p.orders ?? 5)); // diffraction orders per spoke
    const spacing = p.spacing ?? 0.3; // radial gap between orders (∝ 1/grating-constant)
    const spread = p.spread ?? 0.55; // chromatic spread within an order (grows with order)
    this.spin = p.spin ?? 0.15;
    this.buildKey = this.keyOf(p);
    const rng = mulberry32((this.seed ^ 0x85ebca6b) >>> 0);
    const N = this.particleCount;
    const nCore = Math.max(1, Math.floor(N * 0.04)); // bright white zeroth order
    const col = this.colors;
    for (let i = 0; i < N; i++) {
      let x: number;
      let y: number;
      let r: number;
      let lr = 0;
      let lg = 0;
      let lb = 0;
      if (i < nCore) {
        // zeroth order: a tight white-hot blob at the centre
        const a = rng() * TAU;
        r = Math.sqrt(rng()) * spacing * 0.32;
        x = r * Math.cos(a);
        y = r * Math.sin(a);
        const v = 0.85 + 0.15 * (1 - r / (spacing * 0.32));
        lr = v;
        lg = v;
        lb = v;
      } else {
        const arm = Math.floor(rng() * arms);
        const th = (arm / arms) * TAU;
        const m = 1 + Math.floor(rng() * orders); // order 1..orders
        const tt = rng(); // spectral fraction: 0 = blue (inner), 1 = red (outer)
        // order m sits near radius spacing·m, smeared by ± spread·m (dispersion grows with order)
        const along = spacing * (m + (tt - 0.5) * spread);
        const perp = (rng() - 0.5) * spacing * 0.26; // blob width across the spoke (tighter = brighter, purer)
        x = Math.cos(th) * along - Math.sin(th) * perp;
        y = Math.sin(th) * along + Math.cos(th) * perp;
        r = Math.hypot(x, y);
        const hue = 0.66 * (1 - tt); // blue (inner) → green → red (outer)
        const dim = 1 - 0.05 * m; // higher orders fade a little
        const tmp = new Float32Array(3);
        hslToRgb(hue, 1, 0.6 * Math.max(0.5, dim), tmp, 0);
        lr = tmp[0];
        lg = tmp[1];
        lb = tmp[2];
      }
      this.bx[i] = x;
      this.by[i] = y;
      this.bz[i] = (rng() - 0.5) * 0.05; // faint depth jitter
      col[i * 3] = lr;
      col[i * 3 + 1] = lg;
      col[i * 3 + 2] = lb;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const N = this.particleCount;
    const pos = this.positions;
    const th = this.spin * this.t; // gentle in-plane spin
    const ct = Math.cos(th);
    const st = Math.sin(th);
    for (let i = 0; i < N; i++) {
      const x = this.bx[i];
      const y = this.by[i];
      const o = i * 3;
      pos[o] = x * ct - y * st;
      pos[o + 1] = x * st + y * ct;
      pos[o + 2] = this.bz[i];
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const key = this.keyOf(p);
    if (key !== this.buildKey) {
      this.rebuild(p);
      return;
    }
    this.spin = p.spin ?? 0.15;
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
    return [{ id: 'root', parentId: null, label: 'Crossed diffraction grating', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.02 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const crossedDiffractionFactory: ArchetypeFactory = {
  id: 'crossedDiffraction',
  label: 'Crossed Diffraction',
  category: 'Spectral',
  kind: 'flow',
  params: [
    { key: 'arms', label: 'spokes', min: 4, max: 36, step: 1, default: 18, rebuild: true }, // grating directions
    { key: 'orders', label: 'orders', min: 1, max: 9, step: 1, default: 5, rebuild: true }, // diffraction orders
    { key: 'spacing', label: 'order gap', min: 0.15, max: 0.5, step: 0.01, default: 0.3, rebuild: true }, // ∝ 1/d
    { key: 'spread', label: 'dispersion', min: 0.1, max: 1.2, step: 0.02, default: 0.55, rebuild: true }, // spectral smear
    { key: 'spin', label: 'spin', min: 0, max: 1.5, step: 0.05, default: 0.15 }, // gentle rotation
  ],
  defaultParticleCount: 60_000,
  particleCountOptions: [30_000, 60_000, 120_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the diffraction figure IS the visual
  create: (config) => new CrossedDiffractionArchetype(config),
};

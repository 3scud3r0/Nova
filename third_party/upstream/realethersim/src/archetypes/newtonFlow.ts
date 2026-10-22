import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Newton Flow (moving roots). Newton's method for finding a root of a complex polynomial assigns
// every starting point in the plane to the root it converges to; the map from start to destination
// paints the famous Newton fractal, its basins meeting along an infinitely intricate boundary. Here
// the polynomial's roots DRIFT — P_t(z) = ∏(z − r_j(t)) — so the basins are never still. Each
// particle follows a softened, magnitude-limited Newton correction (the softening keeps the step
// finite near the critical points where |P′| vanishes, and the tanh limiter turns the runaway
// iteration into a bounded spray), streaming toward whichever moving root currently owns it. The
// colour of each particle is baked from the root it FIRST belonged to, so as the roots wander the
// fixed basin colours smear and interleave into filaments — Newton's method, made a fluid. Bounded.
const TAU = Math.PI * 2;
const BOUND = 2.5; // plane radius; particles past it respawn

// a fixed, legible 7-hue wheel for up to 7 roots
const ROOT_HUES: [number, number, number][] = [
  [1.0, 0.35, 0.32], [0.35, 0.75, 1.0], [1.0, 0.82, 0.3], [0.55, 1.0, 0.5],
  [0.85, 0.5, 1.0], [0.35, 1.0, 0.85], [1.0, 0.6, 0.85],
];

class NewtonFlowArchetype implements Archetype {
  readonly id = 'newtonFlow';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly zx: Float64Array;
  private readonly zy: Float64Array;
  private readonly rng: () => number;
  private nRoots = 5;
  private drift = 1;
  private gain = 1;
  private soften = 0.06;
  private t = 0;
  // baked root layout (drift centres / radii / phases)
  private rc!: Float64Array; // centre x,y interleaved
  private rr!: Float64Array; // orbit radius
  private rp!: Float64Array; // orbit phase
  private rw!: Float64Array; // orbit rate

  constructor(config: ArchetypeConfig) {
    const N = Math.max(1024, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.zx = new Float64Array(N);
    this.zy = new Float64Array(N);
    this.rng = mulberry32((config.seed ^ 0x85ebca6b) >>> 0);
    this.readParams(config.params);
    const rng = this.rng;
    const n = this.nRoots;
    this.rc = new Float64Array(n * 2);
    this.rr = new Float64Array(n);
    this.rp = new Float64Array(n);
    this.rw = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const ang = (j / n) * TAU + 0.3;
      this.rc[j * 2] = 1.05 * Math.cos(ang);
      this.rc[j * 2 + 1] = 1.05 * Math.sin(ang);
      this.rr[j] = 0.35 + 0.4 * rng();
      this.rp[j] = rng() * TAU;
      this.rw[j] = (0.5 + rng()) * (rng() < 0.5 ? -1 : 1);
    }
    // roots at t = 0, for baking basin colours
    const r0 = this.rootsAt(0);
    for (let i = 0; i < N; i++) {
      const x = (rng() * 2 - 1) * BOUND, y = (rng() * 2 - 1) * BOUND;
      this.zx[i] = x; this.zy[i] = y;
      const idx = this.classicBasin(x, y, r0);
      const o = i * 3;
      const c = idx >= 0 ? ROOT_HUES[idx % ROOT_HUES.length] : [0.4, 0.4, 0.45];
      const bri = 0.7 + 0.5 * rng();
      this.colors[o] = c[0] * bri; this.colors[o + 1] = c[1] * bri; this.colors[o + 2] = c[2] * bri;
    }
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.nRoots = Math.round(p.roots ?? 5);
    this.drift = p.drift ?? 1;
    this.gain = p.gain ?? 1;
    this.soften = p.soften ?? 0.06;
  }

  private rootsAt(t: number): Float64Array {
    const n = this.nRoots;
    const r = new Float64Array(n * 2);
    for (let j = 0; j < n; j++) {
      const ph = this.rp[j] + this.rw[j] * this.drift * 0.25 * t;
      r[j * 2] = this.rc[j * 2] + this.rr[j] * Math.cos(ph);
      r[j * 2 + 1] = this.rc[j * 2 + 1] + this.rr[j] * Math.sin(ph);
    }
    return r;
  }

  // classic Newton iteration (z − P/P′) to find the destination root of a seed
  private classicBasin(x0: number, y0: number, r: Float64Array): number {
    const n = this.nRoots;
    let x = x0, y = y0;
    for (let it = 0; it < 60; it++) {
      let pr = 1, pi = 0, dr = 0, di = 0;
      for (let j = 0; j < n; j++) {
        const ar = x - r[j * 2], ai = y - r[j * 2 + 1];
        const ndr = dr * ar - di * ai + pr, ndi = dr * ai + di * ar + pi;
        const npr = pr * ar - pi * ai, npi = pr * ai + pi * ar;
        dr = ndr; di = ndi; pr = npr; pi = npi;
      }
      const den = dr * dr + di * di;
      if (den < 1e-14) return -1;
      const qr = (pr * dr + pi * di) / den, qi = (pi * dr - pr * di) / den;
      x -= qr; y -= qi;
      if (qr * qr + qi * qi < 1e-12) break;
    }
    // nearest root
    let best = -1, bd = 0.04;
    for (let j = 0; j < n; j++) {
      const dx = x - r[j * 2], dy = y - r[j * 2 + 1], d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const s = 0.6;
    for (let i = 0; i < this.particleCount; i++) {
      const o = i * 3;
      pos[o] = this.zx[i] * s;
      pos[o + 1] = this.zy[i] * s;
      pos[o + 2] = 0;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt;
    const r = this.rootsAt(this.t);
    const n = this.nRoots;
    const sig2 = this.soften * this.soften;
    const zeta = this.gain;
    const flow = 0.003;
    const eps = 0.02;
    const zx = this.zx, zy = this.zy, rng = this.rng;
    for (let i = 0; i < this.particleCount; i++) {
      let x = zx[i], y = zy[i];
      // P and P′ via product accumulation
      let pr = 1, pi = 0, dr = 0, di = 0;
      for (let j = 0; j < n; j++) {
        const ar = x - r[j * 2], ai = y - r[j * 2 + 1];
        const ndr = dr * ar - di * ai + pr, ndi = dr * ai + di * ar + pi;
        const npr = pr * ar - pi * ai, npi = pr * ai + pi * ar;
        dr = ndr; di = ndi; pr = npr; pi = npi;
      }
      const pmag2 = pr * pr + pi * pi;
      // only respawn on actual arrival at a root or escape past the edge — points otherwise stay in
      // their (baked-colour) basin and drift gently, so the basin fractal stays legible and just
      // breathes as the roots wander (teleporting them would scramble colour away from position).
      if (pmag2 < 6e-6 || x * x + y * y > BOUND * BOUND * 1.4) {
        zx[i] = (rng() * 2 - 1) * BOUND; zy[i] = (rng() * 2 - 1) * BOUND;
        continue;
      }
      // softened Newton correction  u = ζ·P·conj(P′)/(|P′|²+σ²)
      const den = dr * dr + di * di + sig2;
      const ux = (zeta * (pr * dr + pi * di)) / den;
      const uy = (zeta * (pi * dr - pr * di)) / den;
      const umag = Math.hypot(ux, uy);
      // magnitude-limited step toward the root (the tanh "spray")
      const k = (flow * Math.tanh(umag)) / (umag + eps);
      zx[i] = x - ux * k; zy[i] = y - uy * k;
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const s = new Float64Array(1 + this.particleCount * 2);
    s[0] = this.t; s.set(this.zx, 1); s.set(this.zy, 1 + this.particleCount);
    return s;
  }
  loadState(s: Float64Array): void {
    this.t = s[0] ?? 0;
    const N = this.particleCount;
    if (s.length >= 1 + N * 2) { this.zx.set(s.subarray(1, 1 + N)); this.zy.set(s.subarray(1 + N, 1 + 2 * N)); }
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Newton basins (moving roots)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.011 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const newtonFlowFactory: ArchetypeFactory = {
  id: 'newtonFlow',
  label: 'Newton Flow',
  category: 'Field',
  kind: 'flow',
  params: [
    { key: 'roots', label: 'roots', min: 3, max: 7, step: 1, default: 5 }, // polynomial degree (rebuild)
    { key: 'drift', label: 'root drift', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'gain', label: 'step gain', min: 0.3, max: 2.5, step: 0.05, default: 1 }, // ζ
    { key: 'soften', label: 'softening', min: 0.01, max: 0.3, step: 0.01, default: 0.06 }, // σ
  ],
  defaultParticleCount: 240_000,
  particleCountOptions: [120_000, 240_000, 360_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new NewtonFlowArchetype(config),
};

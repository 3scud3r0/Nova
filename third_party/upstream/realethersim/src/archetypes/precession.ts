import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Perihelion Precession. In Newton's gravity a bound orbit is a closed ellipse: the planet returns
// to periapsis and retraces the very same path forever. In Einstein's, it does not. Near a mass the
// orbit still looks elliptical, but the ellipse's long axis slowly TURNS with every pass, so the
// path never closes — it fills out a rosette. The Schwarzschild orbit is r(φ) = p/(1 + e·cos kφ)
// with k = √(1 − 6M/p) < 1, so periapsis advances by Δϖ = 2π(1/k − 1) per revolution. This 43″ per
// century for Mercury was General Relativity's first triumph, and it is the visible consequence of
// the honest caveat under our Gravity Well ([[gravityWell]]): it is curved TIME, not a dented sheet,
// that steers the slow orbit. A few test bodies trace their non-closing rosettes around the dark
// hole (a bright photon ring at 3M marks its edge). Colours bake once; the orbits are exact
// closed-form geodesic shapes. Bounded (stable bound orbits need p > 6 + 2e).
const TAU = Math.PI * 2;
const SCALE = 1 / 7; // render units per M
const TURNS = 16; // radial periods traced into each rosette
const ORBIT_HUES: [number, number, number][] = [
  [1.0, 1.0, 1.0], [1.0, 0.72, 0.24], [0.34, 0.8, 1.0], [0.7, 1.0, 0.5], [1.0, 0.5, 0.85],
];
const BASE_P = [9.5, 13.5, 18, 24, 30];
const BASE_E = [0.55, 0.42, 0.6, 0.38, 0.5];

class PrecessionArchetype implements Archetype {
  readonly id = 'precession';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly orbit: Int32Array; // which orbit (>=0) or -1 ring / -2 disc
  private readonly role: Uint8Array; // 0 trail, 1 marker, 2 ring/disc
  private readonly ph: Float64Array; // trail φ / marker jitter angle / ring angle
  private readonly jr: Float64Array; // marker jitter radius / ring radius
  private readonly jy: Float64Array; // small vertical jitter
  private nOrbits = 3;
  private compact = 1;
  private ecc = 1;
  private speed = 1;
  private t = 0;
  // per-orbit geometry
  private op!: Float64Array; // semi-latus rectum p
  private oe!: Float64Array; // eccentricity e
  private ok!: Float64Array; // precession factor k = √(1−6/p)
  private ofp!: Float64Array; // marker true-anomaly φ (live)
  private buildKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(2048, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.orbit = new Int32Array(N);
    this.role = new Uint8Array(N);
    this.ph = new Float64Array(N);
    this.jr = new Float64Array(N);
    this.jy = new Float64Array(N);
    this.seed = config.seed;
    this.rebuild(config.params);
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round(p.orbits ?? 3)},${Math.round((p.compact ?? 1) * 100)},${Math.round((p.ecc ?? 1) * 100)}`;
  }

  private rebuild(p: ResolvedParams): void {
    this.nOrbits = Math.max(1, Math.min(5, Math.round(p.orbits ?? 3)));
    this.compact = p.compact ?? 1;
    this.ecc = p.ecc ?? 1;
    this.speed = p.speed ?? 1;
    this.buildKey = this.keyOf(p);
    const rng = mulberry32((this.seed ^ 0x1d2c6f) >>> 0);
    const K = this.nOrbits;
    const N = this.particleCount;
    this.op = new Float64Array(K); this.oe = new Float64Array(K);
    this.ok = new Float64Array(K); this.ofp = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const e = Math.min(0.75, Math.max(0.05, BASE_E[k] * this.ecc));
      // smaller p ⇒ closer to the hole ⇒ more precession; keep it a stable bound orbit (p > 6 + 2e)
      const p0 = Math.max(6.6 + 2 * e, BASE_P[k] * (2 - this.compact));
      this.op[k] = p0; this.oe[k] = e; this.ok[k] = Math.sqrt(Math.max(0.02, 1 - 6 / p0));
      this.ofp[k] = rng() * TAU;
    }
    const nRing = Math.floor(N * 0.04); // photon ring at 3M
    const nDisc = Math.floor(N * 0.08); // faint accretion glow
    const nMarkerEach = Math.floor(N * 0.03 / K);
    const nTrail = N - nRing - nDisc - nMarkerEach * K;
    const perTrail = Math.floor(nTrail / K);
    let idx = 0;
    const col = this.colors;
    // rosette trails
    for (let k = 0; k < K; k++) {
      const hue = ORBIT_HUES[k % ORBIT_HUES.length];
      const phiMax = TURNS * TAU / this.ok[k];
      for (let j = 0; j < perTrail && idx < N; j++, idx++) {
        this.orbit[idx] = k; this.role[idx] = 0;
        this.ph[idx] = (j / perTrail) * phiMax;
        this.jy[idx] = (rng() - 0.5) * 0.01;
        const b = 0.22 + 0.18 * rng(); // trails are dim; the moving body is bright
        col[idx * 3] = hue[0] * b; col[idx * 3 + 1] = hue[1] * b; col[idx * 3 + 2] = hue[2] * b;
      }
    }
    // moving bodies
    for (let k = 0; k < K; k++) {
      const hue = ORBIT_HUES[k % ORBIT_HUES.length];
      for (let j = 0; j < nMarkerEach && idx < N; j++, idx++) {
        this.orbit[idx] = k; this.role[idx] = 1;
        this.ph[idx] = rng() * TAU; this.jr[idx] = Math.cbrt(rng()) * 0.03;
        const b = 1.4 + 0.6 * rng();
        col[idx * 3] = hue[0] * b; col[idx * 3 + 1] = hue[1] * b; col[idx * 3 + 2] = hue[2] * b;
      }
    }
    // photon ring (the light-bending edge of the hole)
    for (let j = 0; j < nRing && idx < N; j++, idx++) {
      this.orbit[idx] = -1; this.role[idx] = 2;
      this.ph[idx] = rng() * TAU; this.jr[idx] = 3.0 + (rng() - 0.5) * 0.14; this.jy[idx] = (rng() - 0.5) * 0.02;
      const b = 1.2 + 0.7 * rng();
      col[idx * 3] = 1.0 * b; col[idx * 3 + 1] = 0.78 * b; col[idx * 3 + 2] = 0.5 * b;
    }
    // faint accretion glow ring
    for (; idx < N; idx++) {
      this.orbit[idx] = -2; this.role[idx] = 2;
      this.ph[idx] = rng() * TAU; this.jr[idx] = 4 + Math.pow(rng(), 1.5) * 7; this.jy[idx] = (rng() - 0.5) * 0.03;
      const v = Math.max(0, 1 - (this.jr[idx] - 4) / 7) * (0.1 + 0.14 * rng());
      col[idx * 3] = v * 1.0; col[idx * 3 + 1] = v * 0.55; col[idx * 3 + 2] = v * 0.28;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const k = this.orbit[i];
      if (k >= 0) {
        const e = this.oe[k], p = this.op[k], kk = this.ok[k];
        let phi: number, r: number;
        if (this.role[i] === 0) {
          phi = this.ph[i];
          r = p / (1 + e * Math.cos(kk * phi));
          pos[o] = r * Math.cos(phi) * SCALE;
          pos[o + 1] = this.jy[i];
          pos[o + 2] = r * Math.sin(phi) * SCALE;
        } else {
          phi = this.ofp[k];
          r = p / (1 + e * Math.cos(kk * phi));
          const jx = this.jr[i] * Math.cos(this.ph[i]), jz = this.jr[i] * Math.sin(this.ph[i]);
          pos[o] = (r * Math.cos(phi) + jx) * SCALE;
          pos[o + 1] = this.jr[i] * 0.5 * Math.sin(this.ph[i] * 1.7);
          pos[o + 2] = (r * Math.sin(phi) + jz) * SCALE;
        }
      } else {
        // ring / disc
        pos[o] = this.jr[i] * Math.cos(this.ph[i]) * SCALE;
        pos[o + 1] = this.jy[i];
        pos[o + 2] = this.jr[i] * Math.sin(this.ph[i]) * SCALE;
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const key = this.keyOf(p);
    if (key !== this.buildKey) { this.rebuild(p); return; }
    this.speed = p.speed ?? 1;
    this.t += dt;
    // advance each body along its geodesic: dφ/dt = L/r² (Kepler areal speed), L ≈ √(pM)
    for (let k = 0; k < this.nOrbits; k++) {
      const e = this.oe[k], p0 = this.op[k], kk = this.ok[k];
      const r = p0 / (1 + e * Math.cos(kk * this.ofp[k]));
      this.ofp[k] += dt * this.speed * 2.6 * Math.sqrt(p0) / (r * r);
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { const s = new Float64Array(1 + this.nOrbits); s[0] = this.t; s.set(this.ofp, 1); return s; }
  loadState(s: Float64Array): void {
    this.t = s[0] ?? 0;
    if (s.length >= 1 + this.nOrbits) this.ofp.set(s.subarray(1, 1 + this.nOrbits));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'precessing geodesics (Schwarzschild)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.006 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const precessionFactory: ArchetypeFactory = {
  id: 'precession',
  label: 'Perihelion Precession',
  category: 'Spacetime',
  kind: 'flow',
  params: [
    { key: 'compact', label: 'compactness', min: 0.6, max: 1.35, step: 0.02, default: 1 }, // ↑ = closer to the hole, more precession
    { key: 'ecc', label: 'eccentricity', min: 0.4, max: 1.5, step: 0.02, default: 1 },
    { key: 'orbits', label: 'bodies', min: 1, max: 5, step: 1, default: 3, rebuild: true },
    { key: 'speed', label: 'orbit speed', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 180_000,
  particleCountOptions: [100_000, 180_000, 300_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the baked rosette IS the trail
  bloom: 0.45,
  create: (config) => new PrecessionArchetype(config),
};

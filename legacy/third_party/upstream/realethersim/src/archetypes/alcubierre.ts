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

// Alcubierre Warp Bubble — what a warp drive actually does to space, drawn in the bubble's own frame.
// Alcubierre's metric (1994), ds² = −dt² + (dx − v_s f(r_s) dt)² + dy² + dz², keeps space flat and time
// ticking normally everywhere; its only ingredient is a SHIFT VECTOR — space inside the bubble (where the
// top-hat f = 1) is carried along at v_s relative to space outside. In the bubble's frame that means the
// outside streams past at v_s while the inside is still, and light moves at c relative to the local
// space: ẋ = c·n̂ − v_s(1 − f) x̂. Below light speed, flashes from the ship spread out lopsidedly. Above
// it (v_s > 1) a horizon appears where the stream reaches c: light sent forward piles up at the front
// wall (a white-hole horizon, blueshift) and light sent back is swept away (a black-hole horizon) —
// Hiscock (1997); the red ring marks it. The sheet underneath is York time, the expansion of space: squeezed ahead of the ship,
// stretched behind (Alcubierre's famous picture). The magenta ring is where the metric needs NEGATIVE
// energy density — a torus in the bubble wall around the line of motion — and the hierarchy panel gives
// the classical estimate of how much (Pfenning & Ford 1997), in Jupiter masses. Nothing here makes any
// of that exist: the drawing is of a geometry, not a machine.

const RB = 1.2; // bubble radius in render units
const G = 6.674e-11, C = 2.998e8, MJUP = 1.898e27;

const shape = (r: number, R: number, s: number): number => (Math.tanh(s * (r + R)) - Math.tanh(s * (r - R))) / (2 * Math.tanh(s * R));
const dshape = (r: number, R: number, s: number): number => {
  const a = Math.cosh(s * (r + R)), b = Math.cosh(s * (r - R));
  return (s / (2 * Math.tanh(s * R))) * (1 / (a * a) - 1 / (b * b));
};

class AlcubierreArchetype implements Archetype {
  readonly id = 'alcubierre';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sig: number; // wall sharpness in render units (σ·R / RB)
  private vs = 2;
  private Rm = 20;
  private sigmaR = 5;
  private period = 6;
  private speed = 1;
  private t = 0;
  private thetaMax = 1;
  // the wall shape depends only on radius: tabulate 1 − f(r) and f′(r) once (no tanh/cosh per point per step)
  private static readonly LUT_R = 16;
  private static readonly LUT_N = 8192;
  private readonly oneMinusF = new Float32Array(AlcubierreArchetype.LUT_N + 1);
  private readonly fPrime = new Float32Array(AlcubierreArchetype.LUT_N + 1);
  // light flashes
  private readonly E: number; private readonly M: number;
  private readonly ex: Float32Array; private readonly ez: Float32Array; private readonly phase: Float32Array;
  private readonly lx: Float32Array; private readonly lz: Float32Array; private readonly nx: Float32Array; private readonly nz: Float32Array;
  // static pieces (sheet, torus, ship) live at the start of the buffer; the horizon ring after the flashes
  private readonly sheet0: number; private readonly sheetN: number; private readonly sx: Float32Array; private readonly sz: Float32Array;
  private readonly flash0: number; private readonly ring0: number; private readonly ringN: number;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    this.readParams(config.params);
    this.sig = this.sigmaR / RB;
    for (let i = 0; i <= AlcubierreArchetype.LUT_N; i++) {
      const r = (i / AlcubierreArchetype.LUT_N) * AlcubierreArchetype.LUT_R;
      this.oneMinusF[i] = 1 - shape(r, RB, this.sig);
      this.fPrime[i] = dshape(r, RB, this.sig);
    }
    const col = this.colors, pos = this.positions;
    let p = 0;

    // York-time sheet: a lattice in the x–z plane; its height (set per frame) is θ, its colour the sign
    const sheetBudget = Math.floor(P * 0.32);
    const NX = Math.max(20, Math.floor(Math.sqrt(sheetBudget * 1.6))), NZ = Math.max(12, Math.floor(sheetBudget / NX));
    this.sheet0 = p; this.sheetN = NX * NZ;
    this.sx = new Float32Array(this.sheetN); this.sz = new Float32Array(this.sheetN);
    let tm = 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++, p++) {
      const x = (i / (NX - 1) - 0.5) * 7.2, z = (j / (NZ - 1) - 0.5) * 4.6, k = p - this.sheet0;
      this.sx[k] = x; this.sz[k] = z;
      const r = Math.hypot(x, z) || 1e-6, th = (x / r) * dshape(r, RB, this.sig);
      tm = Math.max(tm, Math.abs(th));
      // squeezed ahead (θ < 0, warm) · stretched behind (θ > 0, cool) · flat elsewhere (dim)
      const mag = Math.min(1, Math.abs(th) / (0.35 * this.sig));
      hslToRgb(th < 0 ? 0.07 : 0.58, 0.85, 0.07 + 0.55 * Math.pow(mag, 0.6), col, p * 3);
    }
    this.thetaMax = tm || 1;
    // negative-energy torus: density ∝ ρ²/r² (f′)² around the x axis (rejection-sampled, with the ρ Jacobian)
    const torusBudget = Math.floor(P * 0.14);
    const fmax = Math.abs(dshape(RB, RB, this.sig));
    for (let k = 0; k < torusBudget && p < P;) {
      const x = (rng() * 2 - 1) * (RB + 4 / this.sig), rho = rng() * (RB + 4 / this.sig);
      const r = Math.hypot(x, rho) || 1e-6;
      const w = ((rho * rho) / (r * r)) * (dshape(r, RB, this.sig) / fmax) ** 2 * (rho / (RB + 4 / this.sig));
      if (rng() > w) continue;
      const phi = rng() * Math.PI * 2;
      pos[p * 3] = x; pos[p * 3 + 1] = rho * Math.sin(phi); pos[p * 3 + 2] = rho * Math.cos(phi);
      hslToRgb(0.88, 0.9, 0.55, col, p * 3);
      k++; p++;
    }
    // the ship: a small gold marker at the centre
    for (let k = 0; k < Math.floor(P * 0.01) && p < P; k++, p++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2, rr = 0.06 * Math.cbrt(rng()), s = Math.sqrt(1 - u * u) * rr;
      pos[p * 3] = s * Math.cos(a) * 1.8; pos[p * 3 + 1] = u * rr * 0.6 + 0.02; pos[p * 3 + 2] = s * Math.sin(a);
      hslToRgb(0.12, 0.9, 0.7, col, p * 3);
    }
    // light: the ship flashes, plus sources ahead, behind and to the sides outside the bubble
    const sources: [number, number][] = [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.5], [2.4, 0], [3.1, 0.9], [-2.4, 0], [-3.1, -0.9], [0.4, 1.9], [-0.4, -1.9]];
    this.E = sources.length;
    this.ringN = Math.floor(P * 0.035);
    this.flash0 = p;
    this.M = Math.max(8, Math.floor((P - p - this.ringN) / this.E));
    this.ex = Float32Array.from(sources.map((s) => s[0])); this.ez = Float32Array.from(sources.map((s) => s[1]));
    this.phase = Float32Array.from(sources.map((_, e) => (e === 0 ? 0 : rng())));
    const nL = this.E * this.M;
    this.lx = new Float32Array(nL); this.lz = new Float32Array(nL); this.nx = new Float32Array(nL); this.nz = new Float32Array(nL);
    for (let e = 0; e < this.E; e++) for (let m = 0; m < this.M; m++, p++) {
      const q = e * this.M + m, a = (m / this.M) * Math.PI * 2;
      this.nx[q] = Math.cos(a); this.nz[q] = Math.sin(a);
      const inside = Math.hypot(this.ex[e], this.ez[e]) < RB;
      hslToRgb(inside ? 0.13 : 0.52, inside ? 0.9 : 0.85, inside ? 0.66 : 0.6, col, p * 3); // ship's light gold, outside light cyan
    }
    this.ring0 = p;
    for (let k = 0; k < this.ringN && p < P; k++, p++) hslToRgb(0.98, 0.9, 0.55, col, p * 3); // horizon: red, as in River of Space
    // static pieces drawn once (the torus and ship never move in the bubble frame)
    this.t = this.period * 0.98;
    for (let k = 0; k < 160; k++) this.advance(0.03);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.vs = p.vs ?? 2;
    this.Rm = p.radius ?? 20;
    this.sigmaR = p.sigmaR ?? 5;
    this.period = p.period ?? 6;
    this.speed = p.speed ?? 1;
  }

  private lut(table: Float32Array, r: number): number {
    const u = (r / AlcubierreArchetype.LUT_R) * AlcubierreArchetype.LUT_N;
    if (u >= AlcubierreArchetype.LUT_N) return table[AlcubierreArchetype.LUT_N];
    const i = u | 0, w = u - i;
    return table[i] + (table[i + 1] - table[i]) * w;
  }

  private flow(x: number, z: number): number { // x-velocity of space at (x, z), bubble frame
    return -this.vs * this.lut(this.oneMinusF, Math.sqrt(x * x + z * z));
  }

  private advance(h: number): void {
    const prev = this.t;
    this.t += h;
    for (let e = 0; e < this.E; e++) {
      const before = (prev / this.period + this.phase[e]) % 1, after = (this.t / this.period + this.phase[e]) % 1;
      if (after < before) for (let m = 0; m < this.M; m++) { const q = e * this.M + m; this.lx[q] = this.ex[e]; this.lz[q] = this.ez[e]; }
    }
    const sub = 3, dh = h / sub;
    for (let q = 0; q < this.E * this.M; q++) {
      let x = this.lx[q], z = this.lz[q];
      for (let s = 0; s < sub; s++) { x += (this.nx[q] + this.flow(x, z)) * dh; z += this.nz[q] * dh; }
      // keep runaway light in a box (it has left the picture anyway)
      this.lx[q] = Math.max(-12, Math.min(12, x)); this.lz[q] = Math.max(-12, Math.min(12, z));
    }
  }

  private height(x: number, z: number): number {
    const r = Math.sqrt(x * x + z * z) || 1e-6;
    return 0.55 * ((x / r) * this.lut(this.fPrime, r)) / this.thetaMax * Math.min(1.6, 0.5 + 0.5 * this.vs);
  }

  private horizonRadius(): number {
    if (this.vs <= 1) return -1;
    let a = 0, b = RB * 4; // 1 − f(r) = 1/v_s on the monotone wall
    for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (1 - shape(m, RB, this.sig) < 1 / this.vs) a = m; else b = m; }
    return (a + b) / 2;
  }

  private syncPositions(): void {
    const pos = this.positions;
    for (let k = 0; k < this.sheetN; k++) {
      const o = (this.sheet0 + k) * 3, x = this.sx[k], z = this.sz[k];
      pos[o] = x; pos[o + 1] = this.height(x, z) - 0.02; pos[o + 2] = z;
    }
    for (let q = 0; q < this.E * this.M; q++) {
      const o = (this.flash0 + q) * 3, x = this.lx[q], z = this.lz[q];
      pos[o] = x; pos[o + 1] = Math.abs(x) < 8 && Math.abs(z) < 8 ? this.height(x, z) + 0.015 : 0; pos[o + 2] = z;
    }
    // the horizon (v_s > 1): where space streams past at exactly c; otherwise the ring folds onto the bubble edge
    const rh = this.horizonRadius();
    for (let k = 0; k < this.ringN; k++) {
      const o = (this.ring0 + k) * 3, a = (k / this.ringN) * Math.PI * 2, r = (rh > 0 ? rh : RB) + ((k * 7) % 5 - 2) * 0.008; // a narrow band
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos[o] = x; pos[o + 1] = this.height(x, z) + 0.03; pos[o + 2] = z;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const h = dt * this.speed * 1.8;
    if (h > 0) this.advance(h);
    this.syncPositions();
  }

  /** Pfenning–Ford classical estimate of the (negative) energy, in Jupiter masses. */
  energyJupiters(): number {
    const R = this.Rm, sigma = this.sigmaR / R;
    const E = (1 / 12) * this.vs * this.vs * (C ** 4 / G) * R * R * sigma;
    return E / (C * C) / MJUP;
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const n = this.E * this.M, s = new Float64Array(1 + 2 * n);
    s[0] = this.t; s.set(this.lx, 1); s.set(this.lz, 1 + n);
    return s;
  }
  loadState(s: Float64Array): void {
    const n = this.E * this.M;
    if (s.length !== 1 + 2 * n) return;
    this.t = s[0]; this.lx.set(s.subarray(1, 1 + n)); this.lz.set(s.subarray(1 + n));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const mj = this.energyJupiters();
    const fmt = mj >= 1e4 || mj < 0.01 ? mj.toExponential(1) : mj.toPrecision(3);
    return [{
      id: 'root', parentId: null,
      label: `v = ${this.vs.toFixed(2)} c · R = ${this.Rm} m · ${this.vs > 1 ? 'horizons at front and back' : 'no horizon'} · needs ≈ −${fmt} Jupiter masses of negative energy (classical estimate)`,
      stateOffset: 0, stateLength: 1,
    }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const alcubierreFactory: ArchetypeFactory = {
  id: 'alcubierre',
  label: 'Alcubierre Warp Bubble',
  category: 'Spacetime',
  kind: 'flow',
  params: [
    { key: 'vs', label: 'bubble speed v (× c)', min: 0.1, max: 4, step: 0.05, default: 2 },
    { key: 'sigmaR', label: 'wall sharpness σR', min: 2, max: 12, step: 0.5, default: 5, rebuild: true },
    { key: 'radius', label: 'bubble radius (m, for the energy estimate)', min: 1, max: 200, step: 1, default: 20 },
    { key: 'period', label: 'time between flashes', min: 2, max: 14, step: 0.5, default: 6 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 140_000,
  particleCountOptions: [70_000, 140_000, 220_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new AlcubierreArchetype(config),
};

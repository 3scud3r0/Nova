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

// Phonons (Lattice Vibrations) — sound and heat in a crystal travel as waves of atoms jostling their
// neighbours. A row of atoms joined by springs can only vibrate in certain patterns (normal modes), and each
// pattern's frequency depends on its wavelength in a definite way — the dispersion relation, drawn below the
// chain. Long waves are ordinary sound; as the wavelength shrinks towards two atom spacings the frequency
// levels off, because the atoms can't wiggle any finer than they are spaced. With two kinds of atom (light
// cyan, heavy orange) the curve splits in two: an acoustic branch, where neighbours move together, and an
// optical branch, where they move against each other — with a forbidden band of frequencies (a band gap) in
// between that no vibration can have. Pick "wave packet" to send a short burst along a long chain: its
// crests run at the phase velocity, but the burst as a whole (and its energy) travels at the group velocity,
// the slope of the curve — which falls to zero at the edge of the zone, where waves stop carrying energy.
// The atoms' motion is drawn sideways, magnified, so it can be seen (in a crystal it can be either).

const SCENES = { 'single mode': 0, 'wave packet': 1 };
const BRANCH = { acoustic: 0, optical: 1 };
const CHAIN_Y = 0.75; // render height of the chain
const PLOT_Y = -1.35, PLOT_H = 1.4; // dispersion plot

class PhononsArchetype implements Archetype {
  readonly id = 'phonons';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  readonly scene: number; readonly ratio: number; readonly branch: number; readonly mode: number;
  readonly cells: number; readonly atoms: number;
  readonly u: Float64Array; readonly v: Float64Array; private readonly a: Float64Array; readonly m: Float64Array; // displacement, velocity, acceleration, mass
  readonly K = 1;
  private readonly blobPer: number; private readonly blob: Float32Array;
  private readonly curve0: number; private readonly curveN: number;
  private readonly mark0: number; private readonly markN: number;
  private speed = 1; t = 0;
  readonly k0: number; // wavenumber (radians per cell)

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    this.scene = Math.round(config.params.scene ?? 0);
    this.ratio = config.params.ratio ?? 3;
    this.branch = Math.round(config.params.branch ?? 0);
    this.mode = Math.round(config.params.mode ?? 4);
    this.readParams(config.params);
    const diatomic = this.ratio !== 1;
    this.cells = this.scene === 0 ? 24 : 240;
    this.atoms = diatomic ? 2 * this.cells : this.cells;
    const n = this.atoms;
    this.u = new Float64Array(n); this.v = new Float64Array(n); this.a = new Float64Array(n); this.m = new Float64Array(n);
    for (let i = 0; i < n; i++) this.m[i] = diatomic && i % 2 === 1 ? this.ratio : 1;
    // wavenumber per cell: single mode = mode·2π/cells; wave packet = mode as a fraction of the zone edge
    this.k0 = this.scene === 0 ? (2 * Math.PI * Math.min(this.mode, this.cells / 2)) / this.cells : Math.PI * Math.min(0.98, Math.max(0.05, this.mode / 12));
    this.initialise();

    // budget: atoms as blobs, dispersion curves, markers (current mode / packet speeds)
    this.markN = Math.floor(P * 0.05);
    const curveBudget = Math.floor(P * 0.25);
    this.blobPer = Math.max(1, Math.floor((P - this.markN - curveBudget) / n));
    this.blob = new Float32Array(this.blobPer * 2);
    for (let q = 0; q < this.blobPer; q++) { const r = Math.sqrt(rng()), th = rng() * Math.PI * 2; this.blob[q * 2] = r * Math.cos(th); this.blob[q * 2 + 1] = r * Math.sin(th); }
    const col = this.colors;
    let p = 0;
    for (let i = 0; i < n; i++) for (let q = 0; q < this.blobPer; q++, p++) hslToRgb(this.m[i] > 1 ? 0.08 : 0.52, 0.85, 0.62, col, p * 3);
    this.curve0 = p; this.curveN = P - p - this.markN;
    for (let q = 0; q < this.curveN; q++, p++) { const opt = diatomic && q >= this.curveN / 2; hslToRgb(opt ? 0.92 : 0.14, 0.6, 0.55, col, p * 3); }
    this.mark0 = p;
    for (; p < P; p++) hslToRgb(0.15, 0.2, 0.92, col, p * 3);
    this.drawCurves();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  /** ω(k) for branch b (k in radians per cell of length 1). */
  omega(k: number, b: number): number {
    const K = this.K, m1 = 1, m2 = this.ratio, s = Math.sin(k / 2) ** 2;
    if (this.ratio === 1) return 2 * Math.sqrt(K / m1) * Math.abs(Math.sin(k / 2)); // (cell = one atom)
    const A = K * (1 / m1 + 1 / m2), D = Math.sqrt(Math.max(0, A * A - (4 * K * K * s) / (m1 * m2)));
    return Math.sqrt(Math.max(0, b === 0 ? A - D : A + D));
  }
  /** Group velocity dω/dk (cells per unit time). */
  groupVelocity(k: number, b: number): number { const h = 1e-5; return (this.omega(k + h, b) - this.omega(k - h, b)) / (2 * h); }

  /** Normal-mode amplitudes (light A, heavy B) for motion e^{i(kn − ωt)}: light atom 2n, heavy 2n+1. */
  private eigen(k: number, b: number): { ar: number; ai: number; br: number; bi: number } {
    // (2K − m1 ω²) A = K (1 + e^{−ik}) B. At the zone edge (k = π) 1 + e^{−ik} = 0: one kind of atom stands still —
    // the light ones on the acoustic branch (ω² = 2K/m₂), the heavy ones on the optical branch (ω² = 2K/m₁).
    const w2 = this.omega(k, b) ** 2, num = 2 * this.K - w2;
    const dr = this.K * (1 + Math.cos(k)), di = -this.K * Math.sin(k), den = dr * dr + di * di;
    if (den < 1e-10) return b === 0 ? { ar: 0, ai: 0, br: 1, bi: 0 } : { ar: 1, ai: 0, br: 0, bi: 0 };
    return { ar: 1, ai: 0, br: (num * dr) / den, bi: (-num * di) / den };
  }

  private initialise(): void {
    const n = this.atoms, diatomic = this.ratio !== 1, k = this.k0, b = this.branch, w = this.omega(k, b);
    const E = diatomic ? this.eigen(k, b) : { ar: 1, ai: 0, br: 1, bi: 0 };
    for (let i = 0; i < n; i++) {
      const cell = diatomic ? i >> 1 : i, heavy = diatomic && i % 2 === 1;
      const env = this.scene === 0 ? 1 : Math.exp(-(((cell - this.cells * 0.25) / (this.cells * 0.05)) ** 2));
      // u = Re[c e^{i k cell}], v = Re[−iω c e^{i k cell}] with c = 1 (light) or R (heavy)
      const cr = heavy ? E.br : E.ar, ci = heavy ? E.bi : E.ai, ph = k * cell;
      const re = cr * Math.cos(ph) - ci * Math.sin(ph), im = cr * Math.sin(ph) + ci * Math.cos(ph);
      this.u[i] = env * re; this.v[i] = env * w * im;
    }
    this.t = 0;
  }

  private accel(): void {
    const n = this.atoms, u = this.u, a = this.a, K = this.K;
    for (let i = 0; i < n; i++) {
      const l = u[(i - 1 + n) % n], r = u[(i + 1) % n];
      a[i] = (K * (l + r - 2 * u[i])) / this.m[i];
    }
  }
  /** Velocity Verlet steps over time T (periodic chain). */
  advance(T: number): void {
    const n = this.atoms, steps = Math.max(1, Math.ceil(T / 0.05)), h = T / steps;
    this.accel();
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < n; i++) { this.v[i] += 0.5 * h * this.a[i]; this.u[i] += h * this.v[i]; }
      this.accel();
      for (let i = 0; i < n; i++) this.v[i] += 0.5 * h * this.a[i];
    }
    this.t += T;
  }

  private drawCurves(): void {
    const pos = this.positions, diatomic = this.ratio !== 1, branches = diatomic ? 2 : 1, per = Math.floor(this.curveN / branches);
    const wmax = diatomic ? this.omega(Math.PI, 1) : 2;
    let p = this.curve0;
    for (let b = 0; b < branches; b++) for (let q = 0; q < per; q++, p++) {
      const k = -Math.PI + (2 * Math.PI * q) / per, w = this.omega(k, b);
      pos[p * 3] = (k / Math.PI) * 1.6; pos[p * 3 + 1] = PLOT_Y + (w / wmax) * PLOT_H; pos[p * 3 + 2] = 0;
    }
    for (; p < this.mark0; p++) { pos[p * 3] = -1.6; pos[p * 3 + 1] = PLOT_Y; pos[p * 3 + 2] = 0; }
  }

  private syncPositions(): void {
    const pos = this.positions, n = this.atoms, diatomic = this.ratio !== 1;
    const span = 3.4, dx = span / n, r = Math.min(0.045, dx * 0.32);
    // magnify the motion so it reads: biggest swing ≈ 0.35 render units
    const sc = this.scene === 0 ? 0.32 : 0.35;
    let p = 0;
    for (let i = 0; i < n; i++) {
      const x = -span / 2 + (i + 0.5) * dx, y = CHAIN_Y + sc * this.u[i], rr = r * (this.m[i] > 1 ? 1.3 : 1);
      for (let q = 0; q < this.blobPer; q++, p++) { pos[p * 3] = x + this.blob[q * 2] * rr; pos[p * 3 + 1] = y + this.blob[q * 2 + 1] * rr; pos[p * 3 + 2] = 0; }
    }
    // markers: on the curve, the current (k, ω); for the packet, also where the group velocity predicts the burst
    const wmax = diatomic ? this.omega(Math.PI, 1) : 2, k = this.k0, w = this.omega(k, this.branch);
    const half = Math.floor(this.markN / 2);
    for (let q = 0; q < this.markN; q++) {
      const o = (this.mark0 + q) * 3, a = (q / half) * Math.PI * 2;
      if (q < half) { pos[o] = (k / Math.PI) * 1.6 + 0.045 * Math.cos(a); pos[o + 1] = PLOT_Y + (w / wmax) * PLOT_H + 0.045 * Math.sin(a); pos[o + 2] = 0; }
      else if (this.scene === 1) {
        const cellLen = span / this.cells, x0 = -span / 2 + this.cells * 0.25 * cellLen;
        let xg = x0 + this.groupVelocity(k, this.branch) * this.t * cellLen;
        xg = ((xg + span / 2) % span + span) % span - span / 2;
        const u = (q - half) / (this.markN - half);
        pos[o] = xg + (u - 0.5) * 0.02; pos[o + 1] = CHAIN_Y + 0.5 + u * 0.12; pos[o + 2] = 0; // a small mast over the predicted centre
      } else { pos[o] = (k / Math.PI) * 1.6; pos[o + 1] = PLOT_Y + (w / wmax) * PLOT_H; pos[o + 2] = 0; }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const w = Math.max(0.2, this.omega(this.k0, this.branch));
    // single mode: about one oscillation every 2 s; packet: a steady pace along the chain
    const T = this.scene === 0 ? dt * this.speed * (Math.PI / w) : dt * this.speed * 12;
    this.advance(T);
    if (this.scene === 1 && this.t * Math.abs(this.groupVelocity(this.k0, this.branch)) > this.cells * 0.9) this.initialise();
    if (this.scene === 1 && this.t > 4000) this.initialise();
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { const s = new Float64Array(1 + 2 * this.atoms); s[0] = this.t; s.set(this.u, 1); s.set(this.v, 1 + this.atoms); return s; }
  loadState(s: Float64Array): void {
    if (s.length !== 1 + 2 * this.atoms) return;
    this.t = s[0]; this.u.set(s.subarray(1, 1 + this.atoms)); this.v.set(s.subarray(1 + this.atoms)); this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const k = this.k0, b = this.branch, w = this.omega(k, b), vp = k > 0 ? w / k : 0, vg = this.groupVelocity(k, b);
    const gap = this.ratio !== 1 ? ` · band gap ω = ${this.omega(Math.PI, 0).toFixed(3)} … ${this.omega(Math.PI, 1).toFixed(3)}` : '';
    const label = `${this.ratio === 1 ? 'one kind of atom' : `masses 1 and ${this.ratio}`} · k = ${(k / Math.PI).toFixed(3)} π per cell, ${b === 0 || this.ratio === 1 ? 'acoustic' : 'optical'} branch · ω = ${w.toFixed(3)} · phase velocity ${vp.toFixed(3)}, group velocity ${vg.toFixed(3)} cells per unit time${gap}`;
    return [{ id: 'root', parentId: null, label, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const phononsFactory: ArchetypeFactory = {
  id: 'phonons',
  label: 'Phonons (Lattice Vibrations)',
  category: 'Matter',
  kind: 'flow',
  params: [
    { key: 'scene', label: 'show', min: 0, max: 1, step: 1, default: 0, options: SCENES, rebuild: true },
    { key: 'ratio', label: 'heavy / light mass (1 = one kind)', min: 1, max: 6, step: 0.5, default: 3, rebuild: true },
    { key: 'branch', label: 'branch', min: 0, max: 1, step: 1, default: 0, options: BRANCH, rebuild: true },
    { key: 'mode', label: 'wavenumber (mode)', min: 1, max: 12, step: 1, default: 4, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 60_000,
  particleCountOptions: [30_000, 60_000, 100_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new PhononsArchetype(config),
};

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

// Casimir Plates — empty space pushes two uncharged metal plates together. In quantum theory the vacuum is
// not still: every mode of the electromagnetic field keeps a zero-point jiggle with energy ½ħω. Between two
// parallel mirrors only the waves that fit — with a node on each plate, wavelengths 2d/n — can exist; outside,
// every wavelength can. Fewer modes inside than out means less vacuum energy inside, and the plates are pushed
// together. The strings show the zero-point field along lines through the plates (cyan between them, violet
// outside): between the plates only the allowed standing waves jiggle, and as the gap shrinks the long waves
// disappear. Below, the mode spectrum: allowed frequencies inside (bright ticks, spaced πc/d) against the
// continuum outside (dim). The total zero-point energy is infinite either way, but the difference is finite:
// the panel computes the regularised sum live. The pressure is tiny at a micrometre and about an atmosphere at
// ten nanometres — measured to a few percent since 1997, and a real force in micro-machines.

const HBARC = 3.16152677e-26; // ħc in J·m
const STRINGS = 36;
const XMAX = 2.3; // render half-length of the strings
const LAMBDA = 55; // render-space cutoff for the drawn modes (rad per unit length)

/** 1-D scalar field between Dirichlet plates (ħ = c = 1): the regulated zero-point sum Σ (nπ/2d) e^{−ε nπ/d}. */
export function regulatedModeSum(d: number, eps: number): number {
  let s = 0;
  for (let n = 1; n < 1e7; n++) { const w = (n * Math.PI) / d, t = 0.5 * w * Math.exp(-eps * w); s += t; if (n > 10 && t < 1e-18 * s) break; }
  return s;
}
/** Its finite part: subtract the term that grows with the volume (d/2πε²); exact limit −π/(24d). */
export function casimirFinitePart(d: number, eps: number): number { return regulatedModeSum(d, eps) - d / (2 * Math.PI * eps * eps); }

class CasimirPlatesArchetype implements Archetype {
  readonly id = 'casimirPlates';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  readonly dNm: number; readonly s: number; // physical gap (nm) and render gap
  private readonly perString: number; private readonly sy: Float32Array; private readonly sz: Float32Array;
  // inside: standing modes n = 1…nIn; outside: sampled continuum modes per string and side
  private readonly nIn: number; private readonly inPh: Float32Array;
  private readonly outK: Float32Array; private readonly outPh: Float32Array; private readonly outN = 22;
  private readonly plate0: number; private readonly plateN: number; private readonly plateDir: Float32Array;
  private readonly arrow0: number; private readonly arrowN: number;
  private readonly spec0: number; private readonly specN: number;
  private speed = 1; private t = 0;
  private readonly cin: Float32Array; private readonly cout: Float32Array; private readonly fbuf: Float32Array;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    this.dNm = Math.min(3000, Math.max(5, config.params.gap ?? 100));
    this.readParams(config.params);
    this.s = 0.3 + 0.48 * Math.log10(this.dNm / 10 + 1); // render gap grows with the physical gap (log)
    this.nIn = Math.max(1, Math.floor((LAMBDA * this.s) / Math.PI));
    this.inPh = new Float32Array(STRINGS * this.nIn);
    this.outK = new Float32Array(STRINGS * 2 * this.outN); this.outPh = new Float32Array(STRINGS * 2 * this.outN);
    for (let q = 0; q < this.inPh.length; q++) this.inPh[q] = rng() * Math.PI * 2;
    for (let q = 0; q < this.outK.length; q++) { this.outK[q] = 1.5 + (LAMBDA - 1.5) * rng(); this.outPh[q] = rng() * Math.PI * 2; }
    this.sy = new Float32Array(STRINGS); this.sz = new Float32Array(STRINGS);
    this.cin = new Float32Array(STRINGS * this.nIn); this.cout = new Float32Array(this.outK.length);
    for (let k = 0; k < STRINGS; k++) { this.sy[k] = (rng() * 2 - 1) * 0.85; this.sz[k] = (rng() * 2 - 1) * 0.85; }
    // budget
    this.plateN = Math.floor(P * 0.16); this.arrowN = Math.floor(P * 0.03); this.specN = Math.floor(P * 0.06);
    this.perString = Math.floor((P - this.plateN - this.arrowN - this.specN) / STRINGS);
    this.fbuf = new Float32Array(this.perString);
    const col = this.colors;
    let p = 0;
    for (let k = 0; k < STRINGS; k++) for (let q = 0; q < this.perString; q++, p++) {
      const x = -XMAX + (2 * XMAX * q) / (this.perString - 1), inside = Math.abs(x) < this.s / 2;
      hslToRgb(inside ? 0.5 : 0.76, 0.75, inside ? 0.6 : 0.5, col, p * 3);
      if (!inside) for (let c = 0; c < 3; c++) col[p * 3 + c] *= 0.75;
    }
    this.plate0 = p;
    this.plateDir = new Float32Array(this.plateN * 2);
    for (let q = 0; q < this.plateN; q++, p++) {
      this.plateDir[q * 2] = (rng() * 2 - 1) * 1.05; this.plateDir[q * 2 + 1] = (rng() * 2 - 1) * 1.05;
      hslToRgb(0.12, 0.35, 0.62, col, p * 3);
      for (let c = 0; c < 3; c++) col[p * 3 + c] *= 0.7;
    }
    this.arrow0 = p;
    for (let q = 0; q < this.arrowN; q++, p++) hslToRgb(0.02, 0.9, 0.6, col, p * 3);
    this.spec0 = p;
    for (let q = 0; q < this.specN; q++, p++) {
      const inside = q < this.specN * 0.55;
      hslToRgb(inside ? 0.5 : 0.76, inside ? 0.8 : 0.4, inside ? 0.65 : 0.35, col, p * 3);
    }
    for (; p < P; p++) col[p * 3] = col[p * 3 + 1] = col[p * 3 + 2] = 0;
    this.drawStatic();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  /** Plates, pressure arrows and the spectrum strip (they don't move). */
  private drawStatic(): void {
    const pos = this.positions, h = this.s / 2;
    for (let q = 0; q < this.plateN; q++) {
      const o = (this.plate0 + q) * 3, side = q % 2 ? 1 : -1;
      pos[o] = side * h + side * 0.012 * ((q >> 1) % 3); pos[o + 1] = this.plateDir[q * 2]; pos[o + 2] = this.plateDir[q * 2 + 1];
    }
    // arrows pushing the plates together; length grows with log(pressure)
    const Ppa = this.pressure(), len = Math.max(0.15, Math.min(0.9, 0.15 + 0.12 * (Math.log10(Ppa) + 3)));
    const per = Math.floor(this.arrowN / 8);
    for (let a = 0; a < 8; a++) {
      const side = a < 4 ? -1 : 1, yy = ((a % 4) - 1.5) * 0.45;
      for (let q = 0; q < per; q++) {
        const o = (this.arrow0 + a * per + q) * 3, u = q / per;
        if (u < 0.8) { pos[o] = side * (h + 0.06 + len * (1 - u / 0.8)); pos[o + 1] = yy; pos[o + 2] = 1.15; }
        else { const v = (u - 0.8) / 0.2, b = v < 0.5 ? 1 : -1; pos[o] = side * (h + 0.06 + 0.08 * (v < 0.5 ? v * 2 : (v - 0.5) * 2)); pos[o + 1] = yy + b * 0.06 * (v < 0.5 ? v * 2 : (v - 0.5) * 2); pos[o + 2] = 1.15; }
      }
    }
    for (let q = this.arrow0 + 8 * per; q < this.spec0; q++) { const o = q * 3; pos[o] = -h; pos[o + 1] = 0; pos[o + 2] = 1.15; }
    // spectrum: frequency across, from 0 to the cutoff — ticks at nπ/s (inside), a dim continuum (outside)
    const nTick = Math.floor(this.specN * 0.55), perTick = Math.max(1, Math.floor(nTick / this.nIn));
    for (let q = 0; q < this.specN; q++) {
      const o = (this.spec0 + q) * 3;
      if (q < nTick) {
        const n = Math.min(this.nIn, Math.floor(q / perTick) + 1), w = (n * Math.PI) / this.s, u = (q % perTick) / perTick;
        pos[o] = -XMAX + (2 * XMAX * w) / LAMBDA; pos[o + 1] = -1.55 + 0.28 * u; pos[o + 2] = 0;
      } else {
        const u = (q - nTick) / (this.specN - nTick);
        pos[o] = -XMAX + 2 * XMAX * u; pos[o + 1] = -1.6; pos[o + 2] = 0;
      }
    }
  }

  /** Casimir pressure between ideal parallel mirrors (Pa): π²ħc / (240 d⁴). */
  pressure(): number { const d = this.dNm * 1e-9; return (Math.PI ** 2 * HBARC) / (240 * d ** 4); }

  private syncPositions(): void {
    const pos = this.positions, h = this.s / 2, t = this.t;
    const amp = 0.055;
    // each mode's time factor, once per frame
    const cin = this.cin, cout = this.cout;
    for (let k = 0; k < STRINGS; k++) for (let n = 1; n <= this.nIn; n++) {
      const w = (n * Math.PI) / this.s;
      cin[k * this.nIn + n - 1] = Math.cos(w * t + this.inPh[k * this.nIn + n - 1]) / Math.sqrt(w * this.s);
    }
    for (let q = 0; q < this.outK.length; q++) cout[q] = Math.cos(this.outK[q] * t + this.outPh[q]);
    // the field along each string, built up mode by mode with a rotation recurrence (no trig per point)
    const n = this.perString, dx = (2 * XMAX) / (n - 1), fbuf = this.fbuf;
    const xOf = (q: number): number => -XMAX + dx * q;
    let qa = 0; while (qa < n && xOf(qa) <= -h) qa++; // first point inside
    let qb = qa; while (qb < n && xOf(qb) < h) qb++; // first point outside on the right
    const L = XMAX - h, outScale = Math.sqrt((2 * L * LAMBDA) / Math.PI / this.outN);
    const addModes = (q0: number, q1: number, step: number, d0: (q: number) => number, k: number, a: number): void => {
      // adds a·sin(k·d) along q0 → q1 (exclusive), where d grows by dx each point
      let sn = Math.sin(k * d0(q0)), cs = Math.cos(k * d0(q0));
      const cd = Math.cos(k * dx), sd = Math.sin(k * dx);
      for (let q = q0; q !== q1; q += step) { fbuf[q] += a * sn; const t2 = sn * cd + cs * sd; cs = cs * cd - sn * sd; sn = t2; }
    };
    let p = 0;
    for (let k = 0; k < STRINGS; k++) {
      fbuf.fill(0);
      // inside: standing modes with nodes on both plates (zero-point amplitude ∝ 1/√ω)
      for (let m = 1; m <= this.nIn; m++) if (qb > qa) addModes(qa, qb, 1, (q) => xOf(q) + h, (m * Math.PI) / this.s, Math.SQRT2 * cin[k * this.nIn + m - 1]);
      // outside: a node on the plate, then a sample of the continuum of all wavelengths
      for (let m = 0; m < this.outN; m++) {
        const iR = (k * 2 + 1) * this.outN + m, iL = (k * 2) * this.outN + m;
        if (qb < n) addModes(qb, n, 1, (q) => xOf(q) - h, this.outK[iR], (outScale * cout[iR]) / Math.sqrt(this.outK[iR] * L));
        if (qa > 0) addModes(qa - 1, -1, -1, (q) => -xOf(q) - h, this.outK[iL], (outScale * cout[iL]) / Math.sqrt(this.outK[iL] * L));
      }
      for (let q = 0; q < n; q++, p++) { pos[p * 3] = xOf(q); pos[p * 3 + 1] = this.sy[k] + amp * fbuf[q]; pos[p * 3 + 2] = this.sz[k]; }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt * this.speed * 0.15;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { if (s.length === 1) { this.t = s[0]; this.syncPositions(); } }
  getHierarchy(): NodeSpec[] {
    const Pa = this.pressure(), atm = Pa / 101325;
    const fin = casimirFinitePart(1, 0.004);
    const pStr = Pa >= 1 ? `${Pa.toPrecision(3)} Pa` : `${(Pa * 1000).toPrecision(3)} mPa`;
    return [{
      id: 'root', parentId: null,
      label: `gap ${this.dNm.toFixed(0)} nm → pressure ${pStr} (${atm >= 0.01 ? atm.toFixed(2) : atm.toExponential(1)} atm), energy ${(-((Math.PI ** 2) * HBARC) / (720 * (this.dNm * 1e-9) ** 3)).toExponential(2)} J/m² · 1-D check: mode sum minus its volume term = ${fin.toFixed(5)}/d (exact −π/24 = ${(-Math.PI / 24).toFixed(5)})`,
      stateOffset: 0, stateLength: 1,
    }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const casimirPlatesFactory: ArchetypeFactory = {
  id: 'casimirPlates',
  label: 'Casimir Plates',
  category: 'Quantum',
  kind: 'flow',
  params: [
    { key: 'gap', label: 'gap between the plates (nm)', min: 10, max: 2000, step: 10, default: 100, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new CasimirPlatesArchetype(config),
};

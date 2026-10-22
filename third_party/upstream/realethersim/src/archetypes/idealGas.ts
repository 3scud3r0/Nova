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

// Ideal Gas (Maxwell–Boltzmann) — temperature is molecules moving. A box of hard discs, light ones (cyan) and
// heavy ones four times the mass (orange), all launched at exactly the same speed. Collisions are perfectly
// elastic, yet within a few collision times the single speed spreads into the Maxwell–Boltzmann distribution:
// the histograms on the wall behind fill in under the theoretical curves (2-D: f(v) = (mv/kT) e^{−mv²/2kT}).
// At the same time energy flows from the heavy discs (which started with four times the kinetic energy) to the
// light ones until each kind has the same average energy — equipartition — so in equilibrium the light ones
// move twice as fast. The walls feel the impacts as pressure; the panel compares it with the ideal-gas law
// PA = NkT and with the hard-disc equation of state, which accounts for the room the discs themselves take up.
// Switch the walls to "hot" and they hand each disc that touches them a fresh random velocity at the wall's
// temperature, heating or cooling the gas.

const B = 1.3; // half-size of the box (render units)
const CX = -0.55; // box centre x (the histogram stands behind, to the right)
const NBIN = 36;
const HZ = -B - 0.18; // the histogram wall's z
const HX0 = -1.85, HX1 = 1.95; // histogram x range
const HH = 1.25; // histogram height scale

class IdealGasArchetype implements Archetype {
  readonly id = 'idealGas';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly rng: () => number;
  private readonly N: number; private readonly NL: number; // all / light
  private readonly a: number; // disc radius
  private readonly x: Float64Array; private readonly y: Float64Array; private readonly vx: Float64Array; private readonly vy: Float64Array;
  private readonly m: Float64Array;
  // collision grid
  private readonly G: number; private readonly head: Int32Array; private readonly next: Int32Array;
  // drawing
  private readonly blobPer: number; private readonly tailPer: number; private readonly blob: Float32Array;
  private readonly hist0: number; private readonly barPer: number; private readonly curvePer: number;
  private readonly hist = [new Float64Array(NBIN), new Float64Array(NBIN)]; // running average of the speed density
  private vmax = 3;
  private walls = 0; private tWall = 1; private speed = 1;
  private t = 0;
  private impulse = 0; private impulseT = 0; private pressure = 0; // wall momentum transfer → pressure
  private readonly box0: number; private readonly boxN: number;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    this.rng = mulberry32(config.seed);
    this.readParams(config.params);
    const rng = this.rng, col = this.colors;
    this.N = Math.max(40, Math.round(config.params.n ?? 1800));
    this.NL = Math.round(this.N * 0.6);
    this.a = 0.012 * Math.sqrt(1800 / this.N) * (config.params.size ?? 1);
    const N = this.N;
    this.x = new Float64Array(N); this.y = new Float64Array(N); this.vx = new Float64Array(N); this.vy = new Float64Array(N); this.m = new Float64Array(N);
    // place without overlaps (random sequential), all at speed 1 in random directions
    const minD = 2 * this.a * 1.05;
    for (let i = 0; i < N; i++) {
      for (let tries = 0; tries < 200; tries++) {
        const px = (rng() * 2 - 1) * (B - this.a), py = (rng() * 2 - 1) * (B - this.a);
        let ok = true;
        for (let j = 0; j < i && ok; j++) if ((this.x[j] - px) ** 2 + (this.y[j] - py) ** 2 < minD * minD) ok = false;
        if (ok || tries === 199) { this.x[i] = px; this.y[i] = py; break; }
      }
      const th = rng() * Math.PI * 2;
      this.vx[i] = Math.cos(th); this.vy[i] = Math.sin(th);
      this.m[i] = i < this.NL ? 1 : 4;
    }
    this.G = Math.max(4, Math.floor((2 * B) / (2 * this.a)));
    this.head = new Int32Array(this.G * this.G); this.next = new Int32Array(N);

    // budget: molecules (blob + velocity tail), histogram bars, theory curves, the box outline
    this.boxN = Math.floor(P * 0.02);
    const histBudget = Math.floor(P * 0.2);
    const molBudget = P - histBudget - this.boxN;
    const per = Math.max(3, Math.floor(molBudget / N));
    this.tailPer = Math.max(1, Math.floor(per * 0.4)); this.blobPer = per - this.tailPer;
    this.blob = new Float32Array(this.blobPer * 2);
    for (let q = 0; q < this.blobPer; q++) { const r = Math.sqrt(rng()), an = rng() * Math.PI * 2; this.blob[q * 2] = r * Math.cos(an); this.blob[q * 2 + 1] = r * Math.sin(an); }
    let p = 0;
    for (let i = 0; i < N; i++) {
      const light = i < this.NL;
      for (let q = 0; q < this.blobPer; q++, p++) hslToRgb(light ? 0.52 : 0.08, 0.85, 0.62, col, p * 3);
      for (let q = 0; q < this.tailPer; q++, p++) {
        const f = 1 - q / this.tailPer;
        hslToRgb(light ? 0.52 : 0.08, 0.8, 0.3 + 0.25 * f, col, p * 3);
        for (let c = 0; c < 3; c++) col[p * 3 + c] *= 0.3 + 0.6 * f;
      }
    }
    // histogram: two interleaved bar sets, plus the two theory curves
    this.hist0 = p;
    this.curvePer = Math.floor(histBudget * 0.18 / 2);
    this.barPer = Math.max(4, Math.floor((histBudget - 2 * this.curvePer) / (2 * NBIN)));
    for (let s = 0; s < 2; s++) for (let b = 0; b < NBIN; b++) for (let q = 0; q < this.barPer; q++, p++) {
      hslToRgb(s === 0 ? 0.52 : 0.08, 0.75, 0.5, col, p * 3);
    }
    for (let s = 0; s < 2; s++) for (let q = 0; q < this.curvePer; q++, p++) hslToRgb(s === 0 ? 0.5 : 0.1, 0.4, 0.88, col, p * 3);
    // the box outline (and the histogram's axis)
    this.box0 = p;
    for (; p < P; p++) hslToRgb(0.6, 0.15, 0.5, col, p * 3);
    this.buildBox();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.walls = Math.round(p.walls ?? 0);
    this.tWall = p.tWall ?? 1;
    this.speed = p.speed ?? 1;
  }

  private buildBox(): void {
    const pos = this.positions, n = this.particleCount - this.box0, perEdge = Math.floor(n / 6);
    let p = this.box0;
    const put = (x: number, y: number, z: number): void => { if (p < this.particleCount) { pos[p * 3] = x; pos[p * 3 + 1] = y; pos[p * 3 + 2] = z; p++; } };
    for (let e = 0; e < 4; e++) for (let k = 0; k < perEdge; k++) {
      const u = (k / perEdge) * 2 - 1;
      if (e === 0) put(CX + u * B, 0, -B); else if (e === 1) put(CX + u * B, 0, B); else if (e === 2) put(CX - B, 0, u * B); else put(CX + B, 0, u * B);
    }
    for (let k = 0; k < perEdge; k++) put(HX0 + (HX1 - HX0) * (k / perEdge), 0, HZ); // histogram baseline
    for (let k = 0; p < this.particleCount; k++) put(HX0, (k / perEdge) * HH * 1.1, HZ); // histogram axis
  }

  // --- dynamics: free flight, elastic disc–disc collisions (grid), walls ---
  private substep(h: number): void {
    const { N, x, y, vx, vy, m, a, G, head, next } = this;
    for (let i = 0; i < N; i++) { x[i] += vx[i] * h; y[i] += vy[i] * h; }
    // walls
    for (let i = 0; i < N; i++) {
      for (const ax of [0, 1]) {
        const pos = ax === 0 ? x : y, vel = ax === 0 ? vx : vy;
        if (pos[i] > B - a && vel[i] > 0) this.wallHit(i, ax, B - a, pos, vel, -1);
        else if (pos[i] < -B + a && vel[i] < 0) this.wallHit(i, ax, -B + a, pos, vel, 1);
      }
    }
    // collisions: bin into cells, test neighbours, resolve approaching overlapping pairs elastically
    head.fill(-1);
    const cs = (2 * B) / G;
    for (let i = 0; i < N; i++) {
      const cx = Math.min(G - 1, Math.max(0, Math.floor((x[i] + B) / cs))), cy = Math.min(G - 1, Math.max(0, Math.floor((y[i] + B) / cs)));
      const c = cy * G + cx; next[i] = head[c]; head[c] = i;
    }
    const d2min = 4 * a * a;
    for (let cy = 0; cy < G; cy++) for (let cx = 0; cx < G; cx++) {
      for (let i = head[cy * G + cx]; i >= 0; i = next[i]) {
        for (let oy = 0; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (oy === 0 && ox < 0) continue;
          const nx = cx + ox, ny = cy + oy;
          if (nx < 0 || nx >= G || ny >= G) continue;
          for (let j = oy === 0 && ox === 0 ? next[i] : head[ny * G + nx]; j >= 0; j = next[j]) {
            const dx = x[j] - x[i], dy = y[j] - y[i], d2 = dx * dx + dy * dy;
            if (d2 >= d2min || d2 === 0) continue;
            const dvx = vx[j] - vx[i], dvy = vy[j] - vy[i], vn = dvx * dx + dvy * dy;
            if (vn >= 0) continue; // already separating
            const k = (2 * vn) / ((m[i] + m[j]) * d2); // impulse along the line of centres
            vx[i] += k * m[j] * dx; vy[i] += k * m[j] * dy;
            vx[j] -= k * m[i] * dx; vy[j] -= k * m[i] * dy;
          }
        }
      }
    }
    this.impulseT += h;
  }

  private wallHit(i: number, ax: number, at: number, pos: Float64Array, vel: Float64Array, dir: number): void {
    const before = vel[i];
    pos[i] = at;
    if (this.walls === 1) {
      // a thermal wall: the disc leaves with a velocity drawn from the wall's temperature (flux-weighted normal part)
      const s = Math.sqrt(this.tWall / this.m[i]);
      const vn = s * Math.sqrt(-2 * Math.log(1 - this.rng() + 1e-12)), vt = s * this.gauss();
      vel[i] = dir * vn;
      if (ax === 0) this.vy[i] = vt; else this.vx[i] = vt;
    } else vel[i] = -before;
    this.impulse += this.m[i] * Math.abs(vel[i] - before);
  }
  private gauss(): number {
    const u = 1 - this.rng(), v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** kT of each species from its mean kinetic energy (2-D: ⟨½mv²⟩ = kT). */
  private kT(s: number): number {
    let e = 0, n = 0;
    for (let i = s === 0 ? 0 : this.NL; i < (s === 0 ? this.NL : this.N); i++) { e += 0.5 * this.m[i] * (this.vx[i] ** 2 + this.vy[i] ** 2); n++; }
    return e / Math.max(1, n);
  }

  private advance(dt: number): void {
    const T = dt * this.speed * 0.5;
    if (T <= 0) return;
    // keep every step's travel below a fifth of a radius
    let vm = 0;
    for (let i = 0; i < this.N; i++) vm = Math.max(vm, this.vx[i] ** 2 + this.vy[i] ** 2);
    const n = Math.max(1, Math.ceil(T / ((0.2 * this.a) / Math.sqrt(vm + 1e-9))));
    for (let k = 0; k < n; k++) this.substep(T / n);
    this.t += T;
    // pressure: momentum delivered to the walls per unit length per unit time, over ~0.5 time units
    if (this.impulseT > 0.5) { this.pressure = this.impulse / (8 * (B - this.a) * this.impulseT); this.impulse = 0; this.impulseT = 0; }
    // histogram of speeds (density per unit speed), smoothed in time
    const kTl = this.kT(0);
    this.vmax = 3.6 * Math.sqrt(Math.max(kTl, 0.05));
    const dv = this.vmax / NBIN;
    for (let s = 0; s < 2; s++) {
      const h = this.hist[s], cnt = new Float64Array(NBIN), i0 = s === 0 ? 0 : this.NL, i1 = s === 0 ? this.NL : this.N;
      for (let i = i0; i < i1; i++) { const b = Math.floor(Math.hypot(this.vx[i], this.vy[i]) / dv); if (b < NBIN) cnt[b]++; }
      for (let b = 0; b < NBIN; b++) h[b] += (cnt[b] / ((i1 - i0) * dv) - h[b]) * 0.08;
    }
  }

  private syncPositions(): void {
    const pos = this.positions, a = this.a;
    let p = 0;
    for (let i = 0; i < this.N; i++) {
      const X = CX + this.x[i], Z = this.y[i];
      for (let q = 0; q < this.blobPer; q++, p++) { pos[p * 3] = X + this.blob[q * 2] * a; pos[p * 3 + 1] = 0.004; pos[p * 3 + 2] = Z + this.blob[q * 2 + 1] * a; }
      for (let q = 0; q < this.tailPer; q++, p++) { const f = ((q + 1) / this.tailPer) * 0.035; pos[p * 3] = X - this.vx[i] * f; pos[p * 3 + 1] = 0.004; pos[p * 3 + 2] = Z - this.vy[i] * f; }
    }
    // bars: x maps speed, height maps density; the two species sit side by side in each bin
    const dv = this.vmax / NBIN, bw = (HX1 - HX0) / NBIN, peak = this.peak();
    p = this.hist0;
    for (let s = 0; s < 2; s++) for (let b = 0; b < NBIN; b++) {
      const hgt = (this.hist[s][b] / peak) * HH, xb = HX0 + (b + 0.25 + 0.45 * s) * bw;
      for (let q = 0; q < this.barPer; q++, p++) {
        const u = q / this.barPer;
        pos[p * 3] = xb + ((q * 7) % 5) / 5 * bw * 0.4; pos[p * 3 + 1] = u * hgt; pos[p * 3 + 2] = HZ - 0.01 * s;
      }
    }
    // theory: f(v) = (m v / kT) exp(−m v² / 2kT) with the measured kT of each species
    for (let s = 0; s < 2; s++) {
      const kT = Math.max(1e-6, this.kT(s)), mm = s === 0 ? 1 : 4;
      for (let q = 0; q < this.curvePer; q++, p++) {
        const v = (q / this.curvePer) * this.vmax, f = ((mm * v) / kT) * Math.exp((-mm * v * v) / (2 * kT));
        pos[p * 3] = HX0 + (v / dv) * bw; pos[p * 3 + 1] = (f / peak) * HH; pos[p * 3 + 2] = HZ + 0.01;
      }
    }
  }

  /** Scale for the histogram: the taller of the two theoretical peaks. */
  private peak(): number {
    let pk = 0;
    for (let s = 0; s < 2; s++) { const kT = Math.max(1e-6, this.kT(s)), mm = s === 0 ? 1 : 4; pk = Math.max(pk, Math.sqrt(mm / kT) * Math.exp(-0.5)); }
    return pk || 1;
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.advance(dt);
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const s = new Float64Array(1 + 4 * this.N);
    s[0] = this.t; s.set(this.x, 1); s.set(this.y, 1 + this.N); s.set(this.vx, 1 + 2 * this.N); s.set(this.vy, 1 + 3 * this.N);
    return s;
  }
  loadState(s: Float64Array): void {
    const N = this.N;
    if (s.length !== 1 + 4 * N) return;
    this.t = s[0]; this.x.set(s.subarray(1, 1 + N)); this.y.set(s.subarray(1 + N, 1 + 2 * N)); this.vx.set(s.subarray(1 + 2 * N, 1 + 3 * N)); this.vy.set(s.subarray(1 + 3 * N));
    this.syncPositions();
  }
  /** Measured compressibility Z = PA/(NkT) and the hard-disc prediction (Henderson 1975). */
  equationOfState(): { Z: number; henderson: number; phi: number } {
    const A = 4 * (B - this.a) ** 2, kT = (this.kT(0) * this.NL + this.kT(1) * (this.N - this.NL)) / this.N;
    const phi = (this.N * Math.PI * this.a * this.a) / (4 * B * B);
    return { Z: (this.pressure * A) / (this.N * kT), henderson: (1 + (phi * phi) / 8) / (1 - phi) ** 2, phi };
  }
  getHierarchy(): NodeSpec[] {
    const k0 = this.kT(0), k1 = this.kT(1), eos = this.equationOfState();
    const label = `kT light ${k0.toFixed(3)} · heavy ${k1.toFixed(3)} (equipartition → equal) · pressure: PA/NkT = ${this.pressure > 0 ? eos.Z.toFixed(3) : '…'} (ideal gas 1, hard discs at ${(100 * eos.phi).toFixed(1)}% packing ${eos.henderson.toFixed(3)})`;
    return [{ id: 'root', parentId: null, label, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const idealGasFactory: ArchetypeFactory = {
  id: 'idealGas',
  label: 'Ideal Gas (Maxwell–Boltzmann)',
  category: 'Matter',
  kind: 'flow',
  params: [
    { key: 'n', label: 'molecules', min: 200, max: 3000, step: 100, default: 1800, rebuild: true },
    { key: 'size', label: 'molecule size', min: 0.5, max: 2.5, step: 0.1, default: 1, rebuild: true },
    { key: 'walls', label: 'walls', min: 0, max: 1, step: 1, default: 0, options: { 'perfectly reflecting': 0, 'hot (thermal)': 1 } },
    { key: 'tWall', label: 'wall temperature kT', min: 0.2, max: 3, step: 0.05, default: 1.5 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 80_000,
  particleCountOptions: [40_000, 80_000, 150_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.4,
  create: (config) => new IdealGasArchetype(config),
};

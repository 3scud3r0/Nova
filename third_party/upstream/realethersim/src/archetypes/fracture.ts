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

// Fracture (Brittle Crack) — why glass shatters. A brittle plate is modelled as a triangular lattice of atoms
// joined by springs that snap when stretched past a critical length. The plate is pulled taut between clamped
// top and bottom edges, then a notch is cut into its left side. Stress piles up at the notch tip — a crack
// concentrates force there enormously, which is why a small scratch lets glass break — and if the stored
// elastic energy is enough to pay for the new surfaces (Griffith's criterion), bonds at the tip snap one after
// another and the crack runs (orange) across the plate, near the Rayleigh surface-wave speed — the continuum
// theory's speed limit (this idealised lattice runs a few percent past it). Pull harder and the crack becomes
// unstable and branches, like the forks in a broken windscreen. Pull too gently and the notch just sits there.
// The whole plate restarts every so often.

const NX = 150, NY = 86; // lattice nodes across / up (triangular rows)
const A = 1; // rest spacing
const PER = 3; // points per node

class FractureArchetype implements Archetype {
  readonly id = 'fracture';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  readonly N = NX * NY;
  readonly x: Float64Array; readonly y: Float64Array; readonly vx: Float64Array; readonly vy: Float64Array; private readonly fx: Float64Array; private readonly fy: Float64Array;
  readonly bi: Int32Array; readonly bj: Int32Array; readonly alive: Uint8Array; nb = 0;
  readonly fixed: Uint8Array;
  readonly strain: number; readonly epsC: number;
  private readonly x0: Float64Array; private readonly y0: Float64Array; // unstretched positions
  private readonly jit: Float32Array; private readonly crack0: number; private readonly crackN: number;
  private readonly crackBond: Int32Array; crackUsed = 0;
  readonly dt = 0.1;
  t = 0; broken = 0;
  tipX: number[] = []; tipT: number[] = [];
  private speed = 1; private runs = 0;
  readonly cR: number;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    this.strain = config.params.strain ?? 0.022;
    this.epsC = 0.035;
    this.readParams(config.params);
    const N = this.N;
    const f = (): Float64Array => new Float64Array(N);
    this.x = f(); this.y = f(); this.vx = f(); this.vy = f(); this.fx = f(); this.fy = f(); this.x0 = f(); this.y0 = f();
    this.fixed = new Uint8Array(N);
    const h = (Math.sqrt(3) / 2) * A;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      this.x0[k] = (i + (j % 2) * 0.5) * A; this.y0[k] = j * h;
      if (j < 2 || j >= NY - 2) this.fixed[k] = 1; // clamped grips
    }
    // bonds: right, up-left, up-right (triangular lattice)
    const bi: number[] = [], bj: number[] = [];
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      if (i + 1 < NX) { bi.push(k); bj.push(k + 1); }
      if (j + 1 < NY) {
        const odd = j % 2;
        const ul = odd ? i : i - 1, ur = odd ? i + 1 : i;
        if (ul >= 0) { bi.push(k); bj.push((j + 1) * NX + ul); }
        if (ur < NX) { bi.push(k); bj.push((j + 1) * NX + ur); }
      }
    }
    this.nb = bi.length;
    this.bi = Int32Array.from(bi); this.bj = Int32Array.from(bj); this.alive = new Uint8Array(this.nb);
    this.crackN = Math.min(Math.floor(P * 0.12), 12000);
    this.crackBond = new Int32Array(this.crackN);
    this.jit = new Float32Array(N * PER * 2);
    for (let q = 0; q < N * PER * 2; q++) this.jit[q] = (rng() - 0.5) * 0.55 * A;
    // Rayleigh speed of the lattice: λ = μ = (√3/4)k, ρ = 2m/(√3 a²) → c_s = √(3k a²/8m), c_R ≈ 0.9194 c_s
    this.cR = 0.9194 * Math.sqrt(3 / 8);
    // colours: the plate a cool steel blue (grips brighter), the crack bright orange
    const col = this.colors;
    let p = 0;
    for (let k = 0; k < N; k++) for (let q = 0; q < PER; q++, p++) {
      if (this.fixed[k]) hslToRgb(0.6, 0.15, 0.55, col, p * 3);
      else hslToRgb(0.58, 0.45, 0.32 + 0.06 * ((k * 7919) % 5) / 5, col, p * 3);
    }
    this.crack0 = p;
    for (let q = 0; q < this.crackN && p < P; q++, p++) hslToRgb(0.07, 0.95, 0.62, col, p * 3);
    for (; p < P; p++) { col[p * 3] = col[p * 3 + 1] = col[p * 3 + 2] = 0; }
    this.reset();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  /** Stretch the plate uniformly (grips pulled apart), let it settle, then cut the notch. */
  reset(): void {
    const N = this.N, ymid = this.y0[(NY >> 1) * NX];
    for (let k = 0; k < N; k++) {
      // uniform vertical strain with the matching Poisson contraction (ν = 1/3 for this lattice) — already balanced
      this.x[k] = this.x0[k] * (1 - this.strain / 3) + (NX * A * this.strain) / 6; this.y[k] = ymid + (this.y0[k] - ymid) * (1 + this.strain);
      this.vx[k] = 0; this.vy[k] = 0;
    }
    this.alive.fill(1);
    this.crackUsed = 0; this.broken = 0; this.t = 0; this.tipX = []; this.tipT = [];
    // the notch: cut every bond that crosses the middle line on the left 12% of the plate
    for (let b = 0; b < this.nb; b++) {
      const i = this.bi[b], j = this.bj[b], yi = this.y0[i], yj = this.y0[j];
      const crosses = (yi - ymid + 0.01) * (yj - ymid + 0.01) < 0 || (Math.min(yi, yj) < ymid + 0.01 && Math.max(yi, yj) > ymid + 0.01);
      if (crosses && Math.max(this.x0[i], this.x0[j]) < NX * A * 0.12) this.snap(b);
    }
  }

  private snap(b: number): void {
    this.alive[b] = 0; this.broken++;
    if (this.crackUsed < this.crackN) this.crackBond[this.crackUsed++] = b;
  }

  private forces(): void {
    const { N, x, y, fx, fy, bi, bj, alive, nb, epsC } = this;
    fx.fill(0); fy.fill(0);
    for (let b = 0; b < nb; b++) {
      if (!alive[b]) continue;
      const i = bi[b], j = bj[b], dx = x[j] - x[i], dy = y[j] - y[i], d = Math.hypot(dx, dy), s = d - A;
      if (s > epsC * A) { this.snap(b); continue; } // the bond breaks
      const f = s / d; // k = 1
      fx[i] += f * dx; fy[i] += f * dy; fx[j] -= f * dx; fy[j] -= f * dy;
    }
    void N;
  }

  /** Velocity Verlet with a little damping; the grips don't move. */
  advance(): void {
    const { N, x, y, vx, vy, fx, fy, fixed, dt } = this;
    for (let k = 0; k < N; k++) {
      if (fixed[k]) continue;
      vx[k] = (vx[k] + 0.5 * dt * fx[k]) * 0.9995; vy[k] = (vy[k] + 0.5 * dt * fy[k]) * 0.9995;
      x[k] += dt * vx[k]; y[k] += dt * vy[k];
    }
    this.forces();
    for (let k = 0; k < N; k++) { if (fixed[k]) continue; vx[k] += 0.5 * dt * fx[k]; vy[k] += 0.5 * dt * fy[k]; }
    this.t += dt;
    // the crack tip: the furthest-right broken bond
    if (this.crackUsed) {
      let tx = 0;
      for (let q = 0; q < this.crackUsed; q++) { const b = this.crackBond[q]; tx = Math.max(tx, this.x0[this.bi[b]]); }
      if (!this.tipX.length || tx > this.tipX[this.tipX.length - 1]) { this.tipX.push(tx); this.tipT.push(this.t); }
    }
  }

  private syncPositions(): void {
    const pos = this.positions, sc = 3.4 / (NX * A), cx = (NX * A) / 2, cy = this.y0[(NY >> 1) * NX];
    let p = 0;
    for (let k = 0; k < this.N; k++) for (let q = 0; q < PER; q++, p++) {
      pos[p * 3] = (this.x[k] - cx + this.jit[(k * PER + q) * 2]) * sc;
      pos[p * 3 + 1] = (this.y[k] - cy + this.jit[(k * PER + q) * 2 + 1]) * sc;
      pos[p * 3 + 2] = 0;
    }
    // broken bonds: bright points along each broken bond, all the marker points shared evenly among them
    for (let q = 0; q < this.crackN; q++) {
      const o = (this.crack0 + q) * 3;
      const b = this.crackBond[q % Math.max(1, this.crackUsed)];
      const i = this.bi[b], j = this.bj[b], u = ((q * 0.618) % 1) * 0.6 - 0.3;
      pos[o] = (0.5 * (this.x[i] + this.x[j]) + u * (this.x[j] - this.x[i]) - cx) * sc;
      pos[o + 1] = (0.5 * (this.y[i] + this.y[j]) + u * (this.y[j] - this.y[i]) - cy) * sc;
      pos[o + 2] = 0.002;
    }
  }

  step(_dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const steps = Math.round(6 * this.speed);
    for (let s = 0; s < steps; s++) this.advance();
    if (this.t > 900) { this.runs++; this.reset(); }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(): void { /* rebuilt, not restored */ }
  /** Crack-tip speed over its run (lattice spacings per unit time), from the tip positions. */
  tipSpeed(): number {
    const n = this.tipX.length;
    if (n < 6) return 0;
    const a = Math.floor(n * 0.3), b = n - 1;
    return (this.tipX[b] - this.tipX[a]) / Math.max(1e-9, this.tipT[b] - this.tipT[a]);
  }
  getHierarchy(): NodeSpec[] {
    const v = this.tipSpeed(), across = this.tipX.length ? this.tipX[this.tipX.length - 1] / (NX * A) : 0;
    return [{
      id: 'root', parentId: null,
      label: `stretched ${(100 * this.strain).toFixed(1)}%, bonds snap at ${(100 * this.epsC).toFixed(1)}% · crack ${(100 * across).toFixed(0)}% across, ${this.broken} bonds broken · tip speed ${v > 0 ? (v / this.cR).toFixed(2) : '—'} × the Rayleigh speed (the continuum limit) · t = ${this.t.toFixed(0)}`,
      stateOffset: 0, stateLength: 1,
    }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const fractureFactory: ArchetypeFactory = {
  id: 'fracture',
  label: 'Fracture (Brittle Crack)',
  category: 'Matter',
  kind: 'flow',
  params: [
    { key: 'strain', label: 'how hard it is pulled (strain)', min: 0.005, max: 0.034, step: 0.001, default: 0.022, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 50_000,
  particleCountOptions: [50_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new FractureArchetype(config),
};

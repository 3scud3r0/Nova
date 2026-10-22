import type { Archetype, ArchetypeConfig, ArchetypeFactory, GuideSpec, NodeSpec, ParamSpec, RenderHint, ResolvedParams } from '../core/archetype';
import { mulberry32 } from '../state/rng';
import { hslToRgb } from '../core/color';

// Hamiltonian Monte Carlo made visible. Each particle is an independent HMC sampler exploring a 2-D
// target density π(q) chosen by `distribution`. Its phase-space state is (q∈R², p∈R²). One step() =
// one LEAPFROG move of the Hamiltonian H(q,p)=U(q)+½|p|², U=−log π. Every L steps the momentum is
// RESAMPLED p~N(0,1) and a METROPOLIS accept/reject compares H before/after the L-window (revert q on
// reject). The cloud of q-positions converges to π; the guide overlay traces π's level sets.
const GAUSS = 0, BANANA = 1, BIMODAL = 2, DONUT = 3;
const DIM = 4; // [qx, qy, px, py]

// target-density constants (chosen so every cloud fits ~|q|<5 render units)
const GS2 = 0.81; // gaussian: U=½|q|²/σ², σ²=0.81 (σ=0.9)
const BA = 1.0, BB = 0.5; // banana (Rosenbrock): x~N(0,BA²), y~N(BB(x²−BA²),1)
const MU = 1.4, SG2 = 0.3025; // bimodal: two N(±MU,0) with var 0.3025 (σ=0.55)
const R0 = 1.2, W2 = 0.1225; // donut: U=(|q|−R0)²/(2w²), w=0.35
// per-distribution render scale: map each target's natural spread to ~±2 render units so the camera
// frames a dense, visible cloud (raw coords span ±5 for the banana → tiny dust otherwise). [G,Ba,Bi,Do]
const RSCALE = [0.7, 0.4, 0.8, 1.25];

const PARAM_SPEC: ParamSpec[] = [
  { key: 'distribution', label: 'target', min: 0, max: 3, step: 1, default: BANANA,
    options: { gaussian: GAUSS, banana: BANANA, bimodal: BIMODAL, donut: DONUT }, rebuild: true },
  { key: 'stepSize', label: 'ε (dt)', min: 0.02, max: 0.30, step: 0.005, default: 0.15 },
  { key: 'leapSteps', label: 'L', min: 1, max: 30, step: 1, default: 12 },
];

// U(q) and ∇U(q): the negative-log target and its gradient.
function potential(dist: number, x: number, y: number): number {
  if (dist === GAUSS) return (0.5 * (x * x + y * y)) / GS2;
  if (dist === BANANA) { const t = y - BB * (x * x - BA * BA); return (0.5 * x * x) / (BA * BA) + 0.5 * t * t; }
  if (dist === BIMODAL) {
    const d0 = (x - MU) * (x - MU) + y * y, d1 = (x + MU) * (x + MU) + y * y;
    return -Math.log(Math.exp(-d0 / (2 * SG2)) + Math.exp(-d1 / (2 * SG2)) + 1e-300);
  }
  const r = Math.hypot(x, y), d = r - R0; return (0.5 * d * d) / W2; // donut
}
function gradU(dist: number, x: number, y: number, out: { gx: number; gy: number }): void {
  if (dist === GAUSS) { out.gx = x / GS2; out.gy = y / GS2; return; }
  if (dist === BANANA) { const t = y - BB * (x * x - BA * BA); out.gx = x / (BA * BA) + t * (-2 * BB * x); out.gy = t; return; }
  if (dist === BIMODAL) {
    const ax = x - MU, bx = x + MU;
    const e0 = Math.exp(-(ax * ax + y * y) / (2 * SG2)), e1 = Math.exp(-(bx * bx + y * y) / (2 * SG2));
    const pp = e0 + e1 + 1e-300;
    out.gx = (e0 * ax + e1 * bx) / (SG2 * pp); out.gy = (e0 * y + e1 * y) / (SG2 * pp); return;
  }
  const r = Math.hypot(x, y) || 1e-9, d = r - R0, c = d / (W2 * r); out.gx = c * x; out.gy = c * y; // donut
}
// per-particle deterministic PRNG; distinct streams per resample window via the counter.
function prngFor(seed: number, i: number, counter: number): () => number {
  return mulberry32(((seed * 2654435761) ^ (i * 40503) ^ (counter * 2246822519)) >>> 0);
}
function nrand(rng: () => number): number { const u1 = Math.max(rng(), 1e-12), u2 = rng(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); }

class HMCArchetype implements Archetype {
  readonly id = 'hmc';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly dist: number;
  private readonly rscale: number; // render normalisation (maps the target's spread to ~±2 on screen)
  private readonly seed: number;
  private readonly state: Float64Array; // [qx,qy,px,py] × n
  private readonly q0: Float64Array; // q at start of current L-window (for reject-revert)
  private readonly H0: Float64Array; // H at window start
  private readonly stepInWin: Int32Array; // leapfrog steps taken in current window
  private readonly counter: Int32Array; // resample-window index (PRNG decorrelation)
  private readonly accept: Float32Array; // EMA of accept (drives colour)
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly g = { gx: 0, gy: 0 };

  constructor(config: ArchetypeConfig) {
    this.particleCount = config.particleCount;
    const n = this.particleCount;
    this.dist = Math.round(config.params.distribution ?? BANANA);
    this.rscale = RSCALE[this.dist] ?? 0.5;
    this.seed = config.seed >>> 0;
    this.state = new Float64Array(n * DIM);
    this.q0 = new Float64Array(n * 2);
    this.H0 = new Float64Array(n);
    this.stepInWin = new Int32Array(n);
    this.counter = new Int32Array(n);
    this.accept = new Float32Array(n);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    const rng = mulberry32(this.seed ^ 0x9e3779b9);
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      this.state[o] = (rng() - 0.5) * 4; // broad q seed (don't pre-bias toward π)
      this.state[o + 1] = (rng() - 0.5) * 4;
      this.openWindow(i); // initial momentum draw + window open
      this.accept[i] = 1;
    }
    this.recolor(); // init colours at build (the colour buffer is uploaded once at cloud creation)
    this.syncPositions();
  }

  // resample momentum p~N(0,1), snapshot q0/H0, reset window counter.
  private openWindow(i: number): void {
    const o = i * DIM;
    const r = prngFor(this.seed, i, this.counter[i] * 2); // even stream → momentum
    const px = nrand(r), py = nrand(r);
    this.state[o + 2] = px; this.state[o + 3] = py;
    this.q0[i * 2] = this.state[o]; this.q0[i * 2 + 1] = this.state[o + 1];
    this.H0[i] = potential(this.dist, this.state[o], this.state[o + 1]) + 0.5 * (px * px + py * py);
    this.stepInWin[i] = 0;
  }

  step(dt: number, p: ResolvedParams): void {
    const st = this.state, n = this.particleCount, dist = this.dist, g = this.g;
    const eps = p.stepSize ?? dt; // leapfrog uses ε (the system's own step), not the raw global dt
    const L = Math.max(1, Math.round(p.leapSteps ?? 12));
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      let x = st[o], y = st[o + 1], px = st[o + 2], py = st[o + 3];
      // LEAPFROG: ½-kick, drift, ½-kick (p += −½ε∇U; q += ε p; p += −½ε∇U)
      gradU(dist, x, y, g); px -= 0.5 * eps * g.gx; py -= 0.5 * eps * g.gy;
      x += eps * px; y += eps * py;
      gradU(dist, x, y, g); px -= 0.5 * eps * g.gx; py -= 0.5 * eps * g.gy;
      st[o] = x; st[o + 1] = y; st[o + 2] = px; st[o + 3] = py;
      this.stepInWin[i]++;
      if (this.stepInWin[i] >= L) {
        // METROPOLIS over the whole L-window: accept w.p. min(1, exp(H0−H1)); else revert q.
        const H1 = potential(dist, x, y) + 0.5 * (px * px + py * py);
        const ar = prngFor(this.seed, i, this.counter[i] * 2 + 1); // odd stream → accept draw
        let a = 1; const dH = this.H0[i] - H1;
        if (dH < 0) a = Math.exp(dH);
        if (ar() < a) { this.accept[i] = this.accept[i] * 0.9 + 0.1; }
        else { st[o] = this.q0[i * 2]; st[o + 1] = this.q0[i * 2 + 1]; this.accept[i] = this.accept[i] * 0.9; }
        this.counter[i]++;
        this.openWindow(i);
      }
    }
    this.recolor(); this.syncPositions();
  }

  // colour: hue by target-density "shell" (low U=core→warm, high U=tail→cool), brightness by accept.
  private recolor(): void {
    const st = this.state, n = this.particleCount, dist = this.dist;
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const u = potential(dist, st[o], st[o + 1]);
      const hue = 0.62 - Math.min(1, u / 4) * 0.62; // 0.62 (blue tail) → 0 (red core)
      hslToRgb(hue, 0.85, 0.45 + 0.25 * this.accept[i], this.colors, i * 3);
    }
  }
  private syncPositions(): void {
    const st = this.state, n = this.particleCount, pos = this.positions, k = this.rscale;
    for (let i = 0; i < n; i++) {
      const o = i * DIM, po = i * 3;
      let x = st[o], y = st[o + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) { x = 0; y = 0; st[o] = 0; st[o + 1] = 0; }
      pos[po] = x * k; pos[po + 1] = y * k; pos[po + 2] = 0; // normalise to ~±2 render units
    }
  }
  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return this.state; }
  loadState(s: Float64Array): void { this.state.set(s.subarray(0, this.state.length)); this.syncPositions(); }
  getHierarchy(): NodeSpec[] { return [{ id: 'root', parentId: null, label: `HMC (${this.particleCount})`, stateOffset: 0, stateLength: this.state.length, particleStart: 0, particleCount: this.particleCount }]; }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.012 }; }
  dispose(): void { /* GC with instance */ }
}

// ── guide overlay: closed level-set loops of the chosen target π ──
function rayLoop(dist: number, cx: number, cy: number, level: number, rmax: number, K = 72): Array<[number, number, number]> | null {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < K; i++) {
    const th = (i / K) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
    if (potential(dist, cx + ct * rmax, cy + st * rmax) < level) return null;
    let lo = 0, hi = rmax;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (potential(dist, cx + ct * m, cy + st * m) < level) lo = m; else hi = m; }
    const r = (lo + hi) / 2; pts.push([cx + ct * r, cy + st * r, 0]);
  }
  return pts;
}
function distributionGuide(dist: number): GuideSpec {
  const color = 0x6fb7ff; const out: GuideSpec = [];
  if (dist === GAUSS) {
    for (const lv of [0.5, 1.5, 3.0]) { const lp = rayLoop(GAUSS, 0, 0, lv, 6); if (lp) out.push({ points: lp, color, closed: true }); }
  } else if (dist === BIMODAL) {
    for (const cx of [MU, -MU]) for (const lv of [0.8, 1.4]) { const lp = rayLoop(BIMODAL, cx, 0, lv, 5); if (lp) out.push({ points: lp, color, closed: true }); }
  } else if (dist === DONUT) {
    for (const rr of [R0 - 0.35, R0, R0 + 0.35]) { const pts: Array<[number, number, number]> = []; for (let i = 0; i < 96; i++) { const t = (i / 96) * Math.PI * 2; pts.push([Math.cos(t) * rr, Math.sin(t) * rr, 0]); } out.push({ points: pts, color, closed: true }); }
  } else {
    // banana: closed ribbon at ±1 std about the curve
    const X = 2.4, pts: Array<[number, number, number]> = [];
    for (let i = 0; i <= 40; i++) { const x = -X + (i / 40) * 2 * X; pts.push([x, BB * (x * x - BA * BA) + 1.0, 0]); }
    for (let i = 0; i <= 40; i++) { const x = X - (i / 40) * 2 * X; pts.push([x, BB * (x * x - BA * BA) - 1.0, 0]); }
    out.push({ points: pts, color, closed: true });
  }
  const k = RSCALE[dist] ?? 0.5; // scale the overlay to match the render normalisation
  for (const gl of out) for (const p of gl.points) { p[0] *= k; p[1] *= k; }
  return out;
}

export const hmcFactory: ArchetypeFactory = {
  id: 'hmc',
  label: 'Hamiltonian Monte Carlo',
  category: 'Sampler',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 5000,
  particleCountOptions: [1500, 5000, 12_000, 30_000],
  defaultDt: 0.15, // global dt; step() reads p.stepSize (defaults to dt) for the leapfrog ε
  defaultTrail: 120, // trails paint each sampler's recent walk through phase space
  guides: (): GuideSpec => distributionGuide(BANANA), // reflects the default target
  create: (config) => new HMCArchetype(config),
};

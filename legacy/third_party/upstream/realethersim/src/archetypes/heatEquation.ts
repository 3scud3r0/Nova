import type { Archetype, ArchetypeConfig, ArchetypeFactory, NodeSpec, RenderHint, ResolvedParams } from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Heat Equation — how heat spreads. Temperature obeys ∂T/∂t = ∇·(D∇T): heat flows from hot to cold at a rate
// proportional to the temperature gradient (Fourier's law), so sharp differences smooth out fast and broad ones
// slowly. Three set-ups on a square plate. Hot and cold drops: spots of heat and cold fall on an insulated
// plate and spread as widening, fading bell curves — the width grows like √t, and the total heat stays exactly
// the same, because the edges let none out. Two metals: a copper half and a steel half (heat moves through
// steel about ten times more slowly) between a hot left edge and a cold right edge; the temperature settles into
// two straight ramps with a kink at the join, because the heat flow must be the same on both sides. Steady
// state: one edge held hot and three held cold; the plate relaxes to the solution of Laplace's equation, in
// which every point is the average of its neighbours — and the centre ends up at exactly a quarter of the way
// from cold to hot. Orange is warmer, blue colder, with a dark isotherm every 0.1; the steel half is tinted.

const SCENES = { 'hot and cold drops': 0, 'two metals': 1, 'steady state': 2 };
const DMAX = 0.24; // diffusivity in grid units (stable explicit step needs D·dt ≤ 1/4 with dt = 1)

class HeatEquationArchetype implements Archetype {
  readonly id = 'heatEquation';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly W: number;
  private T: Float64Array; private Tn: Float64Array;
  private readonly Dx: Float64Array; private readonly Dy: Float64Array; // face diffusivities (east, north faces)
  private readonly fixed: Uint8Array; // Dirichlet cells
  private readonly mask: Float32Array;
  private readonly show: Float64Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly scene: number;
  private readonly ratio: number;
  private readonly rng: () => number;
  private speed = 1;
  private n = 0;
  private nextDrop = 0;

  constructor(config: ArchetypeConfig) {
    const w = Math.max(64, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    const N = w * w;
    this.T = new Float64Array(N); this.Tn = new Float64Array(N);
    this.Dx = new Float64Array(N); this.Dy = new Float64Array(N);
    this.fixed = new Uint8Array(N); this.mask = new Float32Array(N); this.show = new Float64Array(N);
    this.positions = new Float32Array(N * 3); this.colors = new Float32Array(N * 3);
    this.rng = mulberry32(config.seed);
    this.scene = Math.round(config.params.scene ?? 0);
    this.ratio = config.params.ratio ?? 0.11;
    this.readParams(config.params);
    // per-cell diffusivity, then harmonic means on the faces (continuity of heat flux across a join)
    const D = new Float64Array(N);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, steel = this.scene === 1 && i >= w / 2;
      D[k] = steel ? DMAX * this.ratio : DMAX;
      this.mask[k] = steel ? 0.35 : 0;
    }
    const hm = (a: number, b: number): number => (2 * a * b) / (a + b);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      this.Dx[k] = i < w - 1 ? hm(D[k], D[k + 1]) : 0; // insulated outer edges: no flux
      this.Dy[k] = j < w - 1 ? hm(D[k], D[k + w]) : 0;
    }
    if (this.scene === 1) for (let j = 0; j < w; j++) { this.fix(j * w, 1); this.fix(j * w + w - 1, 0); }
    if (this.scene === 2) for (let q = 0; q < w; q++) { this.fix(q, 0); this.fix(q * w, 0); this.fix(q * w + w - 1, 0); this.fix((w - 1) * w + q, 1); }
    if (this.scene === 0) { this.drop(w * 0.35, w * 0.4, 1); this.drop(w * 0.66, w * 0.62, -1); }
    const cell = 3.4 / (w - 1);
    for (let k = 0; k < N; k++) { this.positions[k * 3] = (k % w) * cell - 1.7; this.positions[k * 3 + 2] = ((k / w) | 0) * cell - 1.7; this.colors[k * 3] = this.colors[k * 3 + 1] = this.colors[k * 3 + 2] = 0.3; }
    this.syncPositions();
  }

  private fix(k: number, v: number): void { this.fixed[k] = 1; this.T[k] = v; }
  /** A Gaussian spot of heat (sign +1) or cold (−1), width 4% of the plate. */
  private drop(cx: number, cy: number, sign: number): void {
    const w = this.W, s = w * 0.04;
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) this.T[j * w + i] += sign * Math.exp(-((i - cx) ** 2 + (j - cy) ** 2) / (2 * s * s));
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  /** One explicit, conservative step (dt = 1 grid unit): T += Σ faces D_face (T_nb − T). */
  advance(): void {
    const w = this.W, T = this.T, Tn = this.Tn, Dx = this.Dx, Dy = this.Dy, fx = this.fixed;
    Tn.set(T);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (i < w - 1) { const f = Dx[k] * (T[k + 1] - T[k]); Tn[k] += f; Tn[k + 1] -= f; }
      if (j < w - 1) { const f = Dy[k] * (T[k + w] - T[k]); Tn[k] += f; Tn[k + w] -= f; }
    }
    for (let k = 0; k < w * w; k++) if (fx[k]) Tn[k] = T[k];
    this.T = Tn; this.Tn = T;
    this.n++;
  }

  private syncPositions(): void {
    const N = this.particleCount, T = this.T, out = this.show;
    const ref = this.scene === 0 ? 0 : 0.5; // drops: the plate starts at 0; the others run from 0 (cold) to 1 (hot)
    for (let k = 0; k < N; k++) {
      // isotherms: a thin dark line every 0.1 in temperature
      const u = T[k] * 10, d = Math.abs(u - Math.round(u)), line = Math.exp(-((d / 0.07) ** 2));
      out[k] = (T[k] - ref) * (1 - 0.8 * line);
      this.positions[k * 3 + 1] = (T[k] - ref) * 0.4;
    }
  }

  step(_dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const steps = Math.round(60 * this.speed);
    for (let s = 0; s < steps; s++) {
      this.advance();
      if (this.scene === 0 && this.n >= this.nextDrop) { // a new drop every ~2,500 steps, hot or cold
        if (this.n > 0) this.drop((0.2 + 0.6 * this.rng()) * this.W, (0.2 + 0.6 * this.rng()) * this.W, this.rng() < 0.5 ? 1 : -1);
        this.nextDrop = this.n + 2500;
      }
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { const s = new Float64Array(1 + this.particleCount); s[0] = this.n; s.set(this.T, 1); return s; }
  loadState(s: Float64Array): void {
    if (s.length !== 1 + this.particleCount) return;
    this.n = s[0]; this.T.set(s.subarray(1)); this.syncPositions();
  }
  /** Total heat (sum of T) — conserved on the insulated plate. */
  totalHeat(): number { let s = 0; for (const v of this.T) s += v; return s; }
  getHierarchy(): NodeSpec[] {
    const w = this.W;
    let label: string;
    if (this.scene === 0) label = `insulated plate: total heat ${this.totalHeat().toFixed(2)} (conserved; drops add to it) · each drop's width grows as √(σ₀² + 2Dt)`;
    else if (this.scene === 1) {
      const j = w >> 1, a = this.T[j * w + Math.round(w * 0.25)], b = this.T[j * w + Math.round(w * 0.75)];
      const sl1 = (this.T[j * w + Math.round(w * 0.3)] - this.T[j * w + Math.round(w * 0.2)]) / (w * 0.1), sl2 = (this.T[j * w + Math.round(w * 0.8)] - this.T[j * w + Math.round(w * 0.7)]) / (w * 0.1);
      label = `copper | steel (diffusivity ratio ${this.ratio.toFixed(2)}) · T at ¼ ${a.toFixed(3)}, at ¾ ${b.toFixed(3)} · in steady state the slopes differ by 1/ratio = ${(1 / this.ratio).toFixed(2)}×; now ${sl1 !== 0 ? (sl2 / sl1).toFixed(2) : '…'}`;
    } else label = `edges: top 1, others 0 → Laplace's equation · centre T = ${this.T[(w >> 1) * w + (w >> 1)].toFixed(4)} (continuum steady value exactly 0.25; this grid's 0.252)`;
    return [{ id: 'root', parentId: null, label, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', exposesField: true, pointSize: 0.02 }; }
  readField(): { texture: unknown; width: number; height: number; mask: ArrayLike<number>; scale: number } {
    return { texture: this.show, width: this.W, height: this.W, mask: this.mask, scale: 0.5 };
  }
  dispose(): void { /* buffers GC with the instance */ }
}

export const heatEquationFactory: ArchetypeFactory = {
  id: 'heatEquation',
  label: 'Heat Equation',
  category: 'Field',
  kind: 'flow',
  mainThread: true,
  fieldRender: true,
  params: [
    { key: 'scene', label: 'set-up', min: 0, max: 2, step: 1, default: 1, options: SCENES, rebuild: true },
    { key: 'ratio', label: 'steel / copper diffusivity', min: 0.02, max: 1, step: 0.01, default: 0.11, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 5, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 40_000, // W = 200
  particleCountOptions: [22_500, 40_000, 62_500],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.3,
  create: (config) => new HeatEquationArchetype(config),
};

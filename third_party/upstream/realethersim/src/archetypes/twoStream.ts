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

// Two-Stream Instability (Plasma PIC) — two beams of electrons passing through each other, over a background of
// ions. A tiny bunching in one beam pulls on the other and makes it bunch too, which pulls back harder: the
// ripple grows exponentially, then traps the electrons in a row of whirling vortices. This is the simplest way
// a plasma turns the energy of flowing particles into electric fields, and it is why beams of particles in
// space (solar wind, jets, the beams in a fusion device) don't stay beams for long. The picture is phase space:
// position across, velocity up — each dot is an electron (the two beams in cyan and orange). Below: the electric
// field (white), and the log of the field's energy against time (gold) — a straight climb while the ripple
// grows exponentially, with the slope that the theory of cold beams predicts drawn faintly for comparison.
// This is particle-in-cell simulation, the workhorse method of plasma physics.

const NG = 256; // grid cells
const PX = 3.2, PY = 1.1; // phase-space panel half-width / half-height in render units (centred at y = 0.35)
const PY0 = 0.35;
const TRACE_MAX = 900; // time-trace samples (fewer on tiny budgets)

/** Cold symmetric two-stream dispersion (ωp = 1, beams ±v0, each half the density): growth rate at wavenumber k. */
export function twoStreamGrowth(k: number, v0: number): number {
  // 1 = ½/(ω − kv)² + ½/(ω + kv)²  →  with a = kv: ω⁴ − (2a² + 1) ω² + a⁴ − a² = 0  →  ω² = [(2a²+1) − √(8a²+1)] / 2
  const a2 = (k * v0) ** 2, w2 = ((2 * a2 + 1) - Math.sqrt(8 * a2 + 1)) / 2;
  return w2 < 0 ? Math.sqrt(-w2) : 0;
}

class TwoStreamArchetype implements Archetype {
  readonly id = 'twoStream';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  readonly Ne: number; readonly L: number; readonly v0: number; readonly mode: number; readonly vth: number;
  readonly x: Float64Array; readonly v: Float64Array;
  readonly E: Float64Array; private readonly rho: Float64Array;
  private readonly field0: number; private readonly fieldN: number; private readonly trace0: number; private readonly theory0: number; private readonly theoryN: number;
  private readonly logW: Float64Array; private traceLen = 0; private readonly TRACE: number;
  readonly dt = 0.1;
  private readonly rng: () => number;
  private speed = 1;
  t = 0;
  private w0 = 0; // log field energy at the start (for the theory line)

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    this.rng = mulberry32(config.seed);
    this.v0 = config.params.v0 ?? 1;
    this.vth = config.params.vth ?? 0.02;
    this.mode = Math.round(config.params.mode ?? 3);
    this.readParams(config.params);
    // box: the chosen number of wavelengths of the fastest-growing ripple (k v0 = √(3/8)·ωp for cold beams)
    const kBest = Math.sqrt(3 / 8) / this.v0;
    this.L = (2 * Math.PI * this.mode) / kBest;
    this.fieldN = Math.floor(P * 0.03); this.theoryN = Math.floor(P * 0.01); this.TRACE = Math.min(TRACE_MAX, Math.floor(P * 0.1));
    this.Ne = Math.max(2, P - this.fieldN - this.TRACE - this.theoryN);
    this.x = new Float64Array(this.Ne); this.v = new Float64Array(this.Ne);
    this.E = new Float64Array(NG); this.rho = new Float64Array(NG);
    this.logW = new Float64Array(this.TRACE);
    const col = this.colors;
    let p = 0;
    for (let i = 0; i < this.Ne; i++, p++) hslToRgb(i % 2 === 0 ? 0.52 : 0.08, 0.85, 0.6, col, p * 3);
    this.field0 = p;
    for (let q = 0; q < this.fieldN; q++, p++) hslToRgb(0.6, 0.1, 0.85, col, p * 3);
    this.trace0 = p;
    for (let q = 0; q < this.TRACE; q++, p++) hslToRgb(0.13, 0.9, 0.62, col, p * 3);
    this.theory0 = p;
    for (; p < P; p++) { hslToRgb(0.13, 0.4, 0.45, col, p * 3); for (let c = 0; c < 3; c++) col[p * 3 + c] *= 0.5; }
    this.start();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  /** Quiet start: each beam evenly spaced, a whisper of the chosen ripple, a small thermal spread. */
  start(): void {
    const { Ne, L } = this, half = Ne / 2, k = (2 * Math.PI * this.mode) / L;
    for (let i = 0; i < Ne; i++) {
      const beam = i % 2, j = i >> 1;
      const x0 = ((j + 0.5) / half) * L;
      this.x[i] = (x0 + 1e-4 * L * Math.sin(k * x0) + L) % L;
      this.v[i] = (beam === 0 ? this.v0 : -this.v0) + this.vth * this.gauss();
    }
    this.t = 0; this.traceLen = 0;
    this.field();
    // leapfrog: velocities live half a step behind
    for (let i = 0; i < Ne; i++) this.v[i] -= 0.5 * this.dt * -this.eAt(this.x[i]);
    this.w0 = Math.log(this.fieldEnergy() + 1e-300);
  }
  private gauss(): number { const u = 1 - this.rng(), w = this.rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); }

  /** Charge density by cloud-in-cell, then E from Gauss's law (dE/dx = ρ, zero mean). Units: ωp = 1, n0 = 1. */
  private field(): void {
    const { Ne, L, rho, E } = this, dx = L / NG, w = L / Ne / dx; // each electron carries density L/(Ne dx)
    rho.fill(1); // the ions
    for (let i = 0; i < Ne; i++) {
      const g = this.x[i] / dx - 0.5, j = Math.floor(g), f = g - j;
      rho[(j + NG) % NG] -= w * (1 - f); rho[(j + 1) % NG] -= w * f;
    }
    let acc = 0;
    for (let j = 0; j < NG; j++) { acc += rho[j] * dx; E[j] = acc; }
    let mean = 0; for (let j = 0; j < NG; j++) mean += E[j]; mean /= NG;
    for (let j = 0; j < NG; j++) E[j] -= mean;
  }
  private eAt(x: number): number {
    const dx = this.L / NG, g = x / dx - 0.5, j = Math.floor(g), f = g - j;
    // E[j] sits at the right edge of cell j (x = (j+1)dx); interpolate to particle (CIC, consistent with deposition)
    const jl = ((j - 0) + NG) % NG, jr = (j + 1) % NG;
    return (1 - f) * 0.5 * (this.E[jl] + this.E[(jl - 1 + NG) % NG]) + f * 0.5 * (this.E[jr] + this.E[(jr - 1 + NG) % NG]);
  }
  fieldEnergy(): number { let s = 0; for (const e of this.E) s += e * e; return 0.5 * s * (this.L / NG); }
  /** Amplitude of the field's Fourier component m (for measuring growth). */
  modeAmp(m: number): number { let c = 0, s = 0; for (let j = 0; j < NG; j++) { const a = (2 * Math.PI * m * j) / NG; c += this.E[j] * Math.cos(a); s += this.E[j] * Math.sin(a); } return Math.hypot(c, s) * 2 / NG; }

  advance(): void {
    const { Ne, L, dt } = this;
    for (let i = 0; i < Ne; i++) {
      this.v[i] += dt * -this.eAt(this.x[i]); // electrons: a = −E
      let x = this.x[i] + dt * this.v[i];
      x %= L; if (x < 0) x += L;
      this.x[i] = x;
    }
    this.field();
    this.t += dt;
  }

  private syncPositions(): void {
    const pos = this.positions, { Ne, L } = this, vmax = 2.6 * this.v0;
    for (let i = 0; i < Ne; i++) {
      pos[i * 3] = (this.x[i] / L - 0.5) * PX;
      pos[i * 3 + 1] = PY0 + (this.v[i] / vmax) * PY;
      pos[i * 3 + 2] = 0;
    }
    // the electric field along the bottom of the phase-space panel
    let emax = 1e-6; for (const e of this.E) emax = Math.max(emax, Math.abs(e));
    const escale = Math.max(emax, 0.15);
    for (let q = 0; q < this.fieldN; q++) {
      const u = q / this.fieldN, j = Math.min(NG - 1, Math.floor(u * NG)), o = (this.field0 + q) * 3;
      pos[o] = (u - 0.5) * PX; pos[o + 1] = PY0 - PY - 0.3 + (this.E[j] / escale) * 0.16; pos[o + 2] = 0;
    }
    // ln(field energy) against time, and the theory slope 2γ from the start
    const g = twoStreamGrowth((2 * Math.PI * this.mode) / L, this.v0), T = this.TRACE * this.sampleEvery();
    const yOf = (lw: number): number => -1.85 + ((lw - this.w0) / 16) * 0.6; // ln(field energy), 16 e-folds tall
    for (let q = 0; q < this.TRACE; q++) {
      const o = (this.trace0 + q) * 3, k = Math.min(q, this.traceLen - 1);
      pos[o] = -PX / 2 + (k / this.TRACE) * PX; pos[o + 1] = k >= 0 ? Math.min(-1.25, yOf(this.logW[k])) : -1.85; pos[o + 2] = 0;
    }
    for (let q = 0; q < this.theoryN; q++) {
      const o = (this.theory0 + q) * 3, u = q / this.theoryN, tt = u * T;
      pos[o] = -PX / 2 + u * PX; pos[o + 1] = Math.min(-1.25, yOf(this.w0 + 2 * g * tt)); pos[o + 2] = 0;
    }
  }
  private sampleEvery(): number { return 0.1; }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const steps = Math.max(0, Math.round(dt * this.speed * 60 * 1.5)); // ~1.5 steps per frame at speed 1
    for (let s = 0; s < steps; s++) {
      this.advance();
      if (this.traceLen < this.TRACE) this.logW[this.traceLen++] = Math.log(this.fieldEnergy() + 1e-300);
      if (this.t > this.TRACE * this.dt) this.start(); // the trace is full: begin again
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(): void { /* rebuilt, not restored */ }
  getHierarchy(): NodeSpec[] {
    const k = (2 * Math.PI * this.mode) / this.L, g = twoStreamGrowth(k, this.v0);
    return [{
      id: 'root', parentId: null,
      label: `two cold-ish beams at ±${this.v0} (spread ${this.vth}), ${this.Ne} electrons, ${NG} cells · ripple k v₀ = ${(k * this.v0).toFixed(3)} ωp → cold-beam growth rate γ = ${g.toFixed(3)} ωp (the fastest possible, ${(1 / (2 * Math.SQRT2)).toFixed(3)} ωp) · t = ${this.t.toFixed(1)} / ωp`,
      stateOffset: 0, stateLength: 1,
    }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const twoStreamFactory: ArchetypeFactory = {
  id: 'twoStream',
  label: 'Two-Stream Instability (Plasma PIC)',
  category: 'Plasma',
  kind: 'flow',
  params: [
    { key: 'mode', label: 'ripples across the box', min: 1, max: 6, step: 1, default: 3, rebuild: true },
    { key: 'vth', label: 'beam temperature (spread)', min: 0, max: 0.4, step: 0.01, default: 0.02, rebuild: true },
    { key: 'v0', label: 'beam speed v₀', min: 0.5, max: 2, step: 0.1, default: 1, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 100_000,
  particleCountOptions: [50_000, 100_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.4,
  create: (config) => new TwoStreamArchetype(config),
};

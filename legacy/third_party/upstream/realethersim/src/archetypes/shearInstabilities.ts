import type { Archetype, ArchetypeConfig, ArchetypeFactory, NodeSpec, RenderHint, ResolvedParams } from '../core/archetype';
import { mulberry32 } from '../state/rng';
import { Boussinesq2D } from './spectral2d';

// Kelvin–Helmholtz and Rayleigh–Taylor — two ways a smooth boundary between fluids tears itself apart.
// Kelvin–Helmholtz: two streams sliding past each other. Any ripple on the boundary is lifted by lower
// pressure over its crest, so it grows, rolls up into a row of spiral billows, and the billows merge and
// mix — the "cat's-eye" clouds on a windy day, Jupiter's belts, and the reason wind raises waves. Dye marks
// the middle stream (orange) and the outer one (blue). Rayleigh–Taylor: heavy fluid resting on light fluid,
// under gravity. It is in balance, but an unstable one: the heavy fluid falls in fingers, the light fluid
// rises in mushroom-capped plumes, and the two mix — water falling out of an upturned glass, the fingers of a
// supernova remnant, the mixing in fusion capsules. Light fluid is orange, heavy blue; the boundary below,
// with light fluid on top, stays calm. Both run in a box that wraps round at its edges, and start again once
// they have mixed.

const SCENES = { 'Kelvin–Helmholtz (shear)': 0, 'Rayleigh–Taylor (heavy on light)': 1 };
const N = 128;
const DELTA_KH = 0.025, DELTA_RT = 0.01;

class ShearInstabilitiesArchetype implements Archetype {
  readonly id = 'shearInstabilities';
  readonly kind = 'flow' as const;
  readonly particleCount = N * N;
  sim!: Boussinesq2D;
  readonly scene: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly show: Float64Array;
  private readonly rng: () => number;
  private readonly visc: number;
  private speed = 1;
  private debt = 0;
  private runs = 0;

  constructor(config: ArchetypeConfig) {
    this.scene = Math.round(config.params.scene ?? 0);
    this.visc = config.params.visc ?? 1.5;
    this.readParams(config.params);
    this.rng = mulberry32(config.seed);
    this.positions = new Float32Array(N * N * 3);
    this.colors = new Float32Array(N * N * 3).fill(0.3);
    this.show = new Float64Array(N * N);
    for (let k = 0; k < N * N; k++) { this.positions[k * 3] = ((k % N) / N - 0.5) * 3.4; this.positions[k * 3 + 1] = (Math.floor(k / N) / N - 0.5) * 3.4; }
    this.start();
    this.syncPositions();
  }

  /** A fresh run: the base state plus a small random disturbance. */
  start(modes?: { n: number; amp: number }[]): void {
    const nu = this.visc * 1e-4;
    this.sim = new Boussinesq2D(N, N, 1, 1, { nu, kappa: nu, G: this.scene === 1 ? 1 : 0, S: 0, oddZ: false });
    const om = new Float64Array(N * N), b = new Float64Array(N * N), rng = this.rng;
    const pert = modes ?? Array.from({ length: 6 }, (_, i) => ({ n: i + 1, amp: 0.02 * rng() }));
    const ph = pert.map(() => rng() * Math.PI * 2);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i / N, z = j / N, k = j * N + i;
      if (this.scene === 0) {
        // shear layers at z = ¼ and ¾: u = tanh((z−¼)/δ) − tanh((z−¾)/δ) − 1, so ω = −du/dz; dye follows the same profile
        const s1 = 1 / Math.cosh((z - 0.25) / DELTA_KH) ** 2, s2 = 1 / Math.cosh((z - 0.75) / DELTA_KH) ** 2;
        om[k] = -(s1 - s2) / DELTA_KH;
        b[k] = Math.tanh((z - 0.25) / DELTA_KH) - Math.tanh((z - 0.75) / DELTA_KH) - 1;
        // disturb the interfaces: vertical velocity bumps, written as vorticity
        let d = 0;
        pert.forEach((p, q) => { d += p.amp * Math.cos(2 * Math.PI * p.n * x + ph[q]); });
        om[k] += d * 2 * Math.PI * (Math.exp(-(((z - 0.25) / 0.05) ** 2)) - Math.exp(-(((z - 0.75) / 0.05) ** 2))) * 10;
      } else {
        // light (b > 0) below z = ¼, heavy above it up to ¾ (unstable); the wrap at z = ¾ puts light over heavy (stable)
        const zz = z + 0.004 * pert.reduce((s, p, q) => s + (p.amp / 0.02) * Math.cos(2 * Math.PI * p.n * x + ph[q]), 0);
        b[k] = Math.tanh(Math.cos(2 * Math.PI * zz) / (2 * Math.PI * DELTA_RT));
      }
    }
    this.sim.setFields(om, b);
    this.debt = 0;
    // skip the slow, invisible start: run until the ripples are about to roll up
    if (!modes) { const t0 = this.scene === 0 ? 0.45 : 0.55; for (let k = 0; k < 400 && this.sim.t < t0; k++) this.advance(); }
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  /** One CFL-limited step. */
  advance(): number {
    const s = this.sim;
    if (s.t === 0) s.toGrid(); // afterwards each step leaves the velocities of the state it started from
    let dt = Math.min(4e-3, (0.35 / N) / (s.maxSpeed() + 1e-9));
    dt = Math.pow(2, Math.floor(Math.log2(dt / 1e-6))) * 1e-6;
    s.step(dt);
    return dt;
  }

  private syncPositions(): void {
    const s = this.sim;
    s.scalarsToGrid();
    this.show.set(s.b); // the dye (KH) or the buoyancy (RT): orange positive, blue negative
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.debt += dt * this.speed * (this.scene === 0 ? 0.18 : 0.25);
    let guard = 0;
    while (this.debt > 0 && guard++ < 6) this.debt -= this.advance();
    if (this.debt > 0) this.debt = 0;
    if (this.sim.t > (this.scene === 0 ? 4 : 3)) { this.runs++; this.start(); }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.sim.t]); }
  loadState(): void { /* the spectral state is rebuilt, not restored */ }
  getHierarchy(): NodeSpec[] {
    const t = this.sim.t;
    const label = this.scene === 0
      ? `shear layer: velocity jump 2U across thickness ≈ ${2 * DELTA_KH}; fastest growth ≈ 0.19 U/δ = ${(0.19 / DELTA_KH).toFixed(1)} per unit time (Michalke 1964) at wavelength ≈ 14δ · t = ${t.toFixed(2)} · run ${this.runs + 1}`
      : `heavy on light, buoyancy jump 2 · a ripple of wavenumber k grows like e^{√(k)t} (sharp, inviscid limit), shortest ones slowed by viscosity and the interface's thickness · t = ${t.toFixed(2)} · run ${this.runs + 1}`;
    return [{ id: 'root', parentId: null, label, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', exposesField: true, pointSize: 0.02 }; }
  readField(): { texture: unknown; width: number; height: number; scale: number; aspect: number; upright: boolean } {
    return { texture: this.show, width: N, height: N, scale: 1.3, aspect: 1, upright: true };
  }
  dispose(): void { /* buffers GC with the instance */ }
}

export const shearInstabilitiesFactory: ArchetypeFactory = {
  id: 'shearInstabilities',
  label: 'Kelvin–Helmholtz & Rayleigh–Taylor',
  category: 'Fluid',
  kind: 'flow',
  mainThread: true,
  fieldRender: true,
  params: [
    { key: 'scene', label: 'instability', min: 0, max: 1, step: 1, default: 0, options: SCENES, rebuild: true },
    { key: 'visc', label: 'viscosity (×10⁻⁴)', min: 0.8, max: 6, step: 0.1, default: 1.5, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 16384,
  particleCountOptions: [16384],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.3,
  create: (config) => new ShearInstabilitiesArchetype(config),
};

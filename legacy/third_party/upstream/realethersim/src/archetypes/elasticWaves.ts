import type { Archetype, ArchetypeConfig, ArchetypeFactory, NodeSpec, RenderHint, ResolvedParams } from '../core/archetype';

// Elastic Waves (Earthquake) — a solid carries two kinds of wave. P waves (primary) squeeze and stretch the
// rock along their direction of travel, like sound; S waves (secondary) shear it sideways, and travel about
// 1.7 times slower. Along a free surface the two combine into a Rayleigh wave that rolls the ground like an
// ocean swell and arrives last — and does most of the damage. Seismologists read those arrival times to find
// how far away a quake was, and the P–S gap is why phones can warn of shaking seconds before it arrives. This
// solves the equations of linear elasticity on a grid (a slice through the ground, surface at the top): pick
// what to show — the vertical ground motion, or the P part (compression) and S part (shear) separately.
// Set-ups: a quake below the surface; the same under a soft layer of sediment, which traps and amplifies the
// waves (why basins shake hardest); and a source deep in the rock with no surface, where P and S separate
// cleanly into two rings.

const SCENES = { 'quake below the surface': 0, 'soft layer over rock': 1, 'deep in the rock (no surface)': 2 };
const VIEWS = { 'vertical ground motion': 0, 'P waves (compression)': 1, 'S waves (shear)': 2 };
const SPONGE = 40; // absorbing border (Cerjan et al. 1985 taper)

class ElasticWavesArchetype implements Archetype {
  readonly id = 'elasticWaves';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  readonly W: number;
  readonly vx: Float64Array; readonly vz: Float64Array; readonly sxx: Float64Array; readonly szz: Float64Array; readonly sxz: Float64Array;
  readonly lam: Float64Array; readonly mu: Float64Array; readonly rho: Float64Array; private readonly damp: Float64Array;
  private readonly mask: Float32Array; private readonly show: Float64Array;
  private readonly positions: Float32Array; private readonly colors: Float32Array;
  readonly scene: number; readonly surface: boolean; readonly dt: number; readonly srcI: number; readonly srcJ: number;
  private view = 0; private speed = 1;
  private peak = 1e-9; // a slowly fading memory of the strongest motion, for a steady colour scale
  n = 0; // steps taken since the last quake
  private readonly period: number; // steps between quakes

  constructor(config: ArchetypeConfig) {
    const w = Math.max(96, Math.round(Math.sqrt(config.particleCount)));
    this.W = w; this.particleCount = w * w;
    const N = w * w;
    const f = (): Float64Array => new Float64Array(N);
    this.vx = f(); this.vz = f(); this.sxx = f(); this.szz = f(); this.sxz = f();
    this.lam = f(); this.mu = f(); this.rho = f(); this.damp = f(); this.show = f();
    this.mask = new Float32Array(N);
    this.positions = new Float32Array(N * 3); this.colors = new Float32Array(N * 3).fill(0.3);
    this.scene = Math.round(config.params.scene ?? 0);
    this.surface = this.scene !== 2;
    this.readParams(config.params);
    // rock: P speed α = 1, S speed β = α/√3 (a "Poisson solid", λ = μ — close to typical crustal rock); row 0 = the surface
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let a = 1, b = 1 / Math.sqrt(3), r = 1;
      if (this.scene === 1 && j < w * 0.16) { a = 0.5; b = 0.5 / Math.sqrt(3); r = 0.8; this.mask[(w - 1 - j) * w + i] = 0.35; } // sediment: half the speed (mask drawn flipped)
      this.rho[k] = r; this.mu[k] = r * b * b; this.lam[k] = r * a * a - 2 * this.mu[k];
      const d = this.surface ? Math.min(i, w - 1 - i, w - 1 - j) : Math.min(i, j, w - 1 - i, w - 1 - j);
      this.damp[k] = d < SPONGE ? 1 - Math.exp(-((0.015 * (SPONGE - d)) ** 2)) : 0;
    }
    this.dt = 0.5; // grid units: α·dt/dx = 0.5 (stable below 1/√2)
    this.srcI = Math.round(w * (this.scene === 2 ? 0.5 : 0.42));
    this.srcJ = Math.round(w * (this.scene === 2 ? 0.5 : 0.3));
    this.period = Math.round((w * 1.32) / this.dt); // long enough for P, S and the Rayleigh wave to cross; short of the late dispersive tails
    for (let k = 0; k < N; k++) { this.positions[k * 3] = ((k % w) / w - 0.5) * 3.4; this.positions[k * 3 + 1] = (0.5 - Math.floor(k / w) / w) * 3.4; }
    // start a little after the quake, so the waves are already on their way
    for (let s = 0; s < Math.round(w * 0.45 / this.dt); s++) this.advance();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void { this.view = Math.round(p.view ?? 0); this.speed = p.speed ?? 1; }

  /** Ricker wavelet at time τ (peak frequency f0: a P wavelength of about 20 cells, S about 12 — enough to keep grid dispersion small). */
  private source(tau: number): number {
    const f0 = 1 / 20, t0 = 1.2 / f0, a = (Math.PI * f0 * (tau - t0)) ** 2;
    return (1 - 2 * a) * Math.exp(-a);
  }

  /** One step of Virieux's staggered-grid velocity–stress scheme (dx = 1). */
  advance(): void {
    const { W: w, vx, vz, sxx, szz, sxz, lam, mu, rho, damp } = this, dt = this.dt;
    // velocities from the stress divergence
    for (let j = 1; j < w - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      vx[k] += (dt / rho[k]) * (sxx[k + 1] - sxx[k] + sxz[k] - sxz[k - w]);
      vz[k] += (dt / rho[k]) * (sxz[k] - sxz[k - 1] + szz[k + w] - szz[k]);
    }
    // stresses from the velocity gradients
    for (let j = 1; j < w - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i, l = lam[k], m = mu[k];
      const dvx = vx[k] - vx[k - 1];
      // at the free surface (row 1) σzz = 0 fixes ∂vz/∂z = −λ/(λ+2μ) ∂vx/∂x
      const dvz = this.surface && j === 1 ? (-l / (l + 2 * m)) * dvx : vz[k] - vz[k - w];
      sxx[k] += dt * ((l + 2 * m) * dvx + l * dvz);
      szz[k] += dt * (l * dvx + (l + 2 * m) * dvz);
      sxz[k] += dt * m * (vx[k + w] - vx[k] + vz[k + 1] - vz[k]);
    }
    // free surface at row 1: the ground can't push on the air — σzz = 0 there, and σxz is mirrored (odd) about it
    if (this.surface) for (let i = 0; i < w; i++) { szz[w + i] = 0; sxz[i] = -sxz[w + i]; }
    // the quake: an explosive-like source (equal push in all directions) at the hypocentre
    const s = this.source(this.n * dt) * dt, ks = this.srcJ * w + this.srcI;
    sxx[ks] += s; szz[ks] += s;
    // shear-heavy second source so S waves are strong too (a double couple, like a slipping fault)
    sxz[ks] += 0.8 * s;
    // absorbing sponge on the sides and bottom (and the top too when there is no surface)
    for (let k = 0; k < w * w; k++) { const d = 1 - damp[k]; if (d < 1) { vx[k] *= d; vz[k] *= d; sxx[k] *= d; szz[k] *= d; sxz[k] *= d; } }
    this.n++;
  }

  private syncPositions(): void {
    const { W: w, vx, vz, show } = this;
    for (let j = 1; j < w - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i, o = (w - 1 - j) * w + i; // the panel's row 0 is at the bottom; our row 0 is the surface
      if (this.view === 1) show[o] = vx[k] - vx[k - 1] + vz[k] - vz[k - w]; // divergence: compression (P)
      else if (this.view === 2) show[o] = vz[k + 1] - vz[k] - (vx[k + w] - vx[k]); // curl: shear (S)
      else show[o] = -vz[k]; // upward ground motion
    }
    let m = 0;
    for (let k = 0; k < w * w; k++) m = Math.max(m, Math.abs(show[k]));
    this.peak = Math.max(m, this.peak * 0.9985);
  }

  step(_dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const steps = Math.round(4 * this.speed);
    for (let s = 0; s < steps; s++) {
      this.advance();
      if (this.n > this.period) { // the waves have gone; another quake
        this.vx.fill(0); this.vz.fill(0); this.sxx.fill(0); this.szz.fill(0); this.sxz.fill(0); this.n = 0; this.peak = 1e-9;
      }
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.n]); }
  loadState(): void { /* rebuilt, not restored */ }
  getHierarchy(): NodeSpec[] {
    const t = this.n * this.dt;
    return [{
      id: 'root', parentId: null,
      label: `P speed α, S speed β = α/√3 ≈ 0.577α${this.surface ? ', Rayleigh surface wave ≈ 0.919β ≈ 0.531α' : ''}${this.scene === 1 ? ' · sediment layer at half speed' : ''} · t = ${t.toFixed(0)} (grid cells per unit α)`,
      stateOffset: 0, stateLength: 1,
    }];
  }
  renderHint(): RenderHint { return { geometry: 'points', exposesField: true, pointSize: 0.02 }; }
  readField(): { texture: unknown; width: number; height: number; mask: ArrayLike<number>; upright: boolean; aspect: number; scale: number } {
    // colour scale follows the recent strongest motion, so faint leftovers stay faint instead of being amplified
    return { texture: this.show, width: this.W, height: this.W, mask: this.mask, upright: true, aspect: 1, scale: 0.35 * this.peak };
  }
  dispose(): void { /* buffers GC with the instance */ }
}

export const elasticWavesFactory: ArchetypeFactory = {
  id: 'elasticWaves',
  label: 'Elastic Waves (Earthquake)',
  category: 'Field',
  kind: 'flow',
  mainThread: true,
  fieldRender: true,
  params: [
    { key: 'scene', label: 'set-up', min: 0, max: 2, step: 1, default: 0, options: SCENES, rebuild: true },
    { key: 'view', label: 'show', min: 0, max: 2, step: 1, default: 0, options: VIEWS },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 62_500, // 250 × 250
  particleCountOptions: [40_000, 62_500, 90_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.3,
  create: (config) => new ElasticWavesArchetype(config),
};

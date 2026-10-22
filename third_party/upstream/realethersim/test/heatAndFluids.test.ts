import { describe, expect, it } from 'vitest';
import { idealGasFactory } from '../src/archetypes/idealGas';
import { heatEquationFactory } from '../src/archetypes/heatEquation';
import { percolationFactory } from '../src/archetypes/percolation';
import { shallowWaterFactory, stokerDepth } from '../src/archetypes/shallowWater';
import { Boussinesq2D } from '../src/archetypes/spectral2d';
import { shearInstabilitiesFactory } from '../src/archetypes/shearInstabilities';
import type { ArchetypeFactory } from '../src/core/archetype';

// Physics checks for the v0.1.103 heat-and-fluids systems: each pins a result the Learn notes quote.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const make = (f: ArchetypeFactory, params: Record<string, number>, n: number, seed = 1): any => f.create({ particleCount: n, seed, params: { dt: 0.016, ...params } });

describe('ideal gas', () => {
  it('conserves energy and relaxes to Maxwell–Boltzmann with equipartition', () => {
    const p = { n: 1800, size: 1, walls: 0, tWall: 1.5, speed: 1 };
    const a = make(idealGasFactory, p, 40000, 3);
    const E = (): number => { let e = 0; for (let i = 0; i < a.N; i++) e += 0.5 * a.m[i] * (a.vx[i] ** 2 + a.vy[i] ** 2); return e; };
    const e0 = E();
    for (let f = 0; f < 400; f++) a.step(0.016, { dt: 0.016, ...p });
    expect(Math.abs(E() / e0 - 1)).toBeLessThan(1e-9);
    const kT = a.kT(0), v: number[] = [];
    for (let i = 0; i < a.NL; i++) v.push(Math.hypot(a.vx[i], a.vy[i]));
    v.sort((x, y) => x - y);
    let ks = 0;
    v.forEach((s, k) => { ks = Math.max(ks, Math.abs(1 - Math.exp((-s * s) / (2 * kT)) - (k + 1) / v.length)); });
    expect(ks).toBeLessThan(1.63 / Math.sqrt(v.length)); // KS at 1%
    expect(Math.abs(a.kT(0) / a.kT(1) - 1)).toBeLessThan(0.15);
  });
});

describe('heat equation', () => {
  it('a drop spreads with σ² growing by 2Dt, and heat is conserved', () => {
    const a = make(heatEquationFactory, { scene: 0, ratio: 0.11, speed: 1 }, 40000);
    const w = a.W;
    a.T.fill(0); a.drop(w / 2, w / 2, 1);
    const mom = (): [number, number] => { let s = 0, m = 0; for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) { const t = a.T[j * w + i]; s += t; m += t * (i - w / 2) ** 2; } return [s, m / s]; };
    const [s0, v0] = mom();
    for (let n = 0; n < 1000; n++) a.advance();
    const [s1, v1] = mom();
    expect(v1 - v0).toBeCloseTo(2 * 0.24 * 1000, 1);
    expect(s1).toBeCloseTo(s0, 8);
  });
});

describe('percolation', () => {
  it('spans above the threshold and not below it', () => {
    for (let seed = 1; seed <= 4; seed++) {
      expect(make(percolationFactory, { p: 0.54, speed: 1 }, 160000, seed).stats().spans).toBe(false);
      expect(make(percolationFactory, { p: 0.66, speed: 1 }, 160000, seed).stats().spans).toBe(true);
    }
  });
});

describe('shallow water', () => {
  it('matches Stoker’s dam-break solution and conserves water', () => {
    const a = make(shallowWaterFactory, { scene: 0, ratio: 0.2, speed: 1 }, 36000);
    const v0 = a.volume();
    while (a.t < 0.8) a.advance(0.8 - a.t);
    const W = a.W, j = W >> 1, xd = -1.6 + 0.35 * 3.2;
    let err = 0;
    for (let i = 0; i < W; i++) err += Math.abs(a.h[j * W + i] - stokerDepth((i + 0.5) * a.dx - 1.6 - xd, a.t, 1, 0.2));
    expect(err / W).toBeLessThan(0.005);
    expect(Math.abs(a.volume() / v0 - 1)).toBeLessThan(1e-10);
  });
});

describe('Rayleigh–Bénard', () => {
  it('a roll grows at the linear-theory rate just above onset, and decays just below', () => {
    for (const [ra, theory] of [[830, 0.547], [700, -0.505]] as const) {
      const s = new Boussinesq2D(128, 64, 4, 2, { nu: 1, kappa: 1, G: ra, S: 1, oddZ: true });
      const th = new Float64Array(128 * 64);
      for (let jj = 0; jj < 64; jj++) for (let i = 0; i < 128; i++) th[jj * 128 + i] = 1e-6 * Math.sin((Math.PI * jj * 2) / 64) * Math.cos((2 * Math.PI * i) / 128);
      s.setFields(new Float64Array(128 * 64), th);
      const amp = (): number => { s.toGrid(); let m = 0; for (const v of s.b) m = Math.max(m, Math.abs(v)); return m; };
      for (let n = 0; n < 1000; n++) s.step(1e-3);
      const a1 = amp();
      for (let n = 0; n < 1000; n++) s.step(1e-3);
      expect(Math.log(amp() / a1)).toBeCloseTo(theory, 1);
    }
  }, 60_000);
});

describe('Rayleigh–Taylor', () => {
  it('a long ripple grows at nearly the sharp-interface rate √(k)', () => {
    const a = make(shearInstabilitiesFactory, { scene: 1, visc: 1.5, speed: 1 }, 16384);
    a.start([{ n: 2, amp: 1e-3 }]);
    const amp = (): number => { a.sim.toGrid(); let c = 0, s = 0; for (let i = 0; i < 128; i++) { const w = a.sim.w[32 * 128 + i]; c += w * Math.cos((4 * Math.PI * i) / 128); s += w * Math.sin((4 * Math.PI * i) / 128); } return Math.hypot(c, s); };
    while (a.sim.t < 0.4) a.sim.step(1e-3);
    const a1 = amp();
    while (a.sim.t < 0.9) a.sim.step(1e-3);
    const sigma = Math.log(amp() / a1) / 0.5;
    expect(sigma).toBeGreaterThan(3.0);
    expect(sigma).toBeLessThan(Math.sqrt(4 * Math.PI));
  }, 60_000);
});

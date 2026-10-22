import { describe, expect, it } from 'vitest';
import { elasticWavesFactory } from '../src/archetypes/elasticWaves';
import { phononsFactory } from '../src/archetypes/phonons';
import { twoStreamFactory, twoStreamGrowth } from '../src/archetypes/twoStream';
import { stellarCollapseFactory, laneEmden } from '../src/archetypes/stellarCollapse';
import { fractureFactory } from '../src/archetypes/fracture';
import type { ArchetypeFactory } from '../src/core/archetype';

// Physics checks for the v0.1.104 solids, plasma and stars systems: each pins a result the Learn notes quote.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const make = (f: ArchetypeFactory, params: Record<string, number>, n: number): any => f.create({ particleCount: n, seed: 1, params: { dt: 0.016, ...params } });

describe('elastic waves', () => {
  it('P waves travel at α = 1 in the rock', () => {
    const a = make(elasticWavesFactory, { scene: 2, view: 0, speed: 1 }, 62500);
    for (const f of [a.vx, a.vz, a.sxx, a.szz, a.sxz]) f.fill(0);
    a.n = 0;
    const w = a.W;
    const ring = (): number => {
      let best = 0, br = 0;
      for (let r = 5; r < 100; r += 0.5) {
        let s = 0;
        for (let q = 0; q < 64; q++) {
          const th = (q / 64) * 2 * Math.PI, k = Math.round(a.srcJ + r * Math.sin(th)) * w + Math.round(a.srcI + r * Math.cos(th));
          s += (a.vx[k] - a.vx[k - 1] + a.vz[k] - a.vz[k - w]) ** 2;
        }
        if (s > best) { best = s; br = r; }
      }
      return br;
    };
    while (a.n * a.dt < 60) a.advance();
    const r1 = ring();
    while (a.n * a.dt < 100) a.advance();
    expect((ring() - r1) / 40).toBeCloseTo(1, 1);
  }, 60_000);
});

describe('phonons', () => {
  it('a normal mode of the two-mass chain oscillates at the dispersion-relation frequency', () => {
    for (const branch of [0, 1]) {
      const a = make(phononsFactory, { scene: 0, ratio: 3, branch, mode: 4, speed: 1 }, 20000);
      let prev = a.u[0], t = 0;
      const z: number[] = [];
      while (z.length < 9 && t < 2000) { a.advance(0.01); t += 0.01; if ((prev < 0) !== (a.u[0] < 0)) z.push(t); prev = a.u[0]; }
      expect((2 * Math.PI) / ((2 * (z[8] - z[0])) / 8)).toBeCloseTo(a.omega(a.k0, branch), 2);
    }
  });
});

describe('two-stream instability', () => {
  it('the fastest cold-beam growth is 1/(2√2) at k v₀ = √(3/8), and the PIC code grows close to it', () => {
    expect(twoStreamGrowth(Math.sqrt(3 / 8), 1)).toBeCloseTo(1 / (2 * Math.SQRT2), 6);
    const a = make(twoStreamFactory, { v0: 1, speed: 1, mode: 1, vth: 0 }, 100000);
    const amps: number[] = [];
    for (let n = 0; n < 220; n++) { a.advance(); amps.push(Math.log(a.modeAmp(1))); }
    const xs: number[] = [], ys: number[] = [];
    amps.forEach((v, i) => { const t = (i + 1) * a.dt; if (t > 8 && t < 20) { xs.push(t); ys.push(v); } });
    const mx = xs.reduce((p, c) => p + c) / xs.length, my = ys.reduce((p, c) => p + c) / ys.length;
    const g = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    expect(Math.abs(g / twoStreamGrowth((2 * Math.PI) / a.L, 1) - 1)).toBeLessThan(0.08);
  }, 60_000);
});

describe('stars', () => {
  it('Lane–Emden constants match the textbook values', () => {
    const l = laneEmden(3);
    expect(l.xi1).toBeCloseTo(6.89685, 4);
    expect(l.mass).toBeCloseTo(2.01824, 4);
  });
  it('the balanced star stays put, and its breathing period scales as R^{3/2}', () => {
    const period = (R: number): number => {
      const a = make(stellarCollapseFactory, { scene: 0, gamma: 1.3, radius: R, speed: 1 }, 4000);
      const rs: number[] = [], ts: number[] = [];
      while (a.t < 10 * a.dynTime) { a.advance(0.02 * a.dynTime); rs.push(a.r[160]); ts.push(a.t); }
      const peaks: number[] = [];
      for (let i = 1; i < rs.length - 1; i++) if (rs[i] > rs[i - 1] && rs[i] >= rs[i + 1]) peaks.push(ts[i]);
      return (peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1);
    };
    expect(period(1.5) / period(1)).toBeCloseTo(1.5 ** 1.5, 1);
  }, 60_000);
});

describe('fracture', () => {
  it('a gentle pull leaves the notch alone; a firm one sends a crack across', () => {
    const across = (strain: number): number => {
      const a = make(fractureFactory, { strain, speed: 1 }, 50000);
      while (a.t < 400) a.advance();
      return a.tipX.length ? a.tipX[a.tipX.length - 1] / 150 : 0;
    };
    expect(across(0.008)).toBeLessThan(0.2);
    expect(across(0.016)).toBeGreaterThan(0.95);
  }, 60_000);
});

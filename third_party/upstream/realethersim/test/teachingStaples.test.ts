import { describe, expect, it } from 'vitest';
import { specialRelativityFactory } from '../src/archetypes/specialRelativity';
import { lightConesFactory } from '../src/archetypes/lightCones';
import { kerrDraggingFactory } from '../src/archetypes/kerrDragging';
import { maxwellFdtdFactory } from '../src/archetypes/maxwellFdtd';
import { chargedParticlesFactory } from '../src/archetypes/chargedParticles';
import { threeBodyFactory } from '../src/archetypes/threeBody';
import type { ArchetypeFactory } from '../src/core/archetype';

// Physics checks for the v0.1.102 teaching systems: each pins a result the Learn notes quote, so a refactor
// that breaks the physics (not just the bounds the smoke test checks) fails here.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const make = (f: ArchetypeFactory, params: Record<string, number>, n = 4000): any => f.create({ particleCount: n, seed: 1, params: { dt: 0.016, ...params } });

const bounded = (pos: Float32Array): boolean => pos.every((x) => Number.isFinite(x) && Math.abs(x) < 50);

describe('special relativity', () => {
  it('the train observer sees the front flash vL/c² earlier, in every frame', () => {
    for (const frame of [0, 1, 2]) {
      const a = make(specialRelativityFactory, { v: 0.6, frame, speed: 1 }, 20000);
      const w = a.frameVel(), g = w.map((x: number) => 1 / Math.sqrt(1 - x * x));
      const seen = [NaN, NaN], n3 = Math.floor(a.obsN / 3), half = a.loopHalf();
      for (let t = -half; t < half; t += 0.002) {
        a.t = t; a.syncPositions();
        for (let f = 0; f < 2; f++) if (Number.isNaN(seen[f]) && a.positions[(a.obs0[1] + n3 * (f + 1)) * 3 + 1] >= 0.5) seen[f] = t / g[1];
      }
      expect(seen[0] - seen[1]).toBeCloseTo(0.6 * 3.2, 1);
    }
  });
});

describe('light cones', () => {
  it('a boost keeps every event on its hyperbola (the interval is invariant)', () => {
    const a = make(lightConesFactory, { sweep: 0, vmax: 0.8, v: 0, speed: 1 }, 20000);
    const b = make(lightConesFactory, { sweep: 0, vmax: 0.8, v: 0.7, speed: 1 }, 20000);
    const s2 = (q: Float32Array, k: number): number => q[k * 3 + 1] ** 2 - q[k * 3] ** 2 - q[k * 3 + 2] ** 2;
    for (let k = 0; k < a.dustN; k += 7) expect(Math.abs(s2(a.positions, k) - s2(b.positions, k))).toBeLessThan(1e-4);
  });
  it('the spacelike event B changes order with E as the frame sweeps', () => {
    const a = make(lightConesFactory, { sweep: 1, vmax: 0.8, v: 0.5, speed: 1 }, 2000);
    const seen = new Set<boolean>();
    for (let i = 0; i < 1200; i++) { a.step(0.016, { sweep: 1, vmax: 0.8, v: 0.5, speed: 1 }); seen.add(a.getHierarchy()[0].label.includes('BEFORE')); }
    expect(seen.size).toBe(2);
  });
});

describe('Kerr frame dragging', () => {
  it('zero-angular-momentum rain turns at the frame-dragging rate ω', () => {
    const a = make(kerrDraggingFactory, { a: 0.95, speed: 1 }, 20000), spin = 0.95;
    for (const r of [5, 3, 2.2]) {
      const k = a.rT.findIndex((x: number) => x <= r), rr = a.rT[k], D = rr * rr - 2 * rr + spin * spin;
      const dphidr = (a.ph[k + 1] - a.ph[k - 1]) / (a.rT[k + 1] - a.rT[k - 1]);
      const dTdr = (a.g0[k + 1] - a.g0[k - 1] + (a.g1[k + 1] - a.g1[k - 1])) / (a.rT[k + 1] - a.rT[k - 1]);
      const omegaBL = (dphidr - spin / D) / (dTdr - (2 * rr) / D); // back to Boyer–Lindquist
      const omega = (2 * spin * rr) / ((rr * rr + spin * spin) ** 2 - spin * spin * D);
      expect(omegaBL).toBeCloseTo(omega, 5);
    }
  });
  it('the backward light beam stalls at the static limit r = 2M', () => {
    const a = make(kerrDraggingFactory, { a: 0.95, speed: 1 }, 20000);
    const label: string = a.getHierarchy()[0].label;
    expect(label).toContain('2.40M: backward');
    expect(label).toContain('1.85M: forward');
    expect(a.isco(true)).toBeCloseTo(1.937, 2); // Bardeen–Press–Teukolsky
  });
});

describe('Maxwell FDTD', () => {
  it('every set-up stays finite and bounded', () => {
    for (const scene of [0, 1, 2, 3]) {
      const a = make(maxwellFdtdFactory, { scene, wavelength: 22, phase: 90, n: 1.5, angle: 30, view: 0, speed: 2 }, 14400);
      for (let i = 0; i < 20; i++) a.step(0.016, { scene, wavelength: 22, phase: 90, n: 1.5, angle: 30, view: 2, speed: 2 });
      expect(bounded(a.readPositions())).toBe(true);
      expect(a.readField().texture.every((x: number) => Number.isFinite(x))).toBe(true);
    }
  });
});

describe('charged particles', () => {
  it('cyclotron: the period is 2πm/(qB) at any speed, and the Boris push keeps |v| exact', () => {
    const a = make(chargedParticlesFactory, { scene: 0, B: 1, E: 0.4, speed: 1 });
    for (const i of [0, 2]) { // a light and a heavy ion
      a.spawn(i, false);
      const o = i * 3, x0 = Array.from(a.x.slice(o, o + 3)) as number[], v0 = Math.hypot(...(Array.from(a.v.slice(o, o + 3)) as number[]));
      const s = a.species[a.sp[i]], T = (2 * Math.PI * s.m) / Math.abs(s.q);
      let t = 0, best = 1e9, tBest = 0;
      while (t < T * 1.2) {
        a.push(i, 0.002); t += 0.002;
        if (t > T / 2) { const d = Math.hypot(a.x[o] - x0[0], a.x[o + 1] - x0[1], a.x[o + 2] - x0[2]); if (d < best) { best = d; tBest = t; } }
      }
      expect(tBest).toBeCloseTo(T, 1);
      expect(Math.hypot(a.v[o], a.v[o + 1], a.v[o + 2]) / v0).toBeCloseTo(1, 12);
    }
  });
  it('E × B: both charges drift at E/B', () => {
    const a = make(chargedParticlesFactory, { scene: 1, B: 1, E: 0.4, speed: 1 });
    for (const i of [0, 1]) {
      a.spawn(i, false); const o = i * 3; a.v[o] = 0; a.v[o + 2] = 0;
      let t = 0, z = 0, last = a.x[o + 2];
      while (t < 10 * Math.PI) { a.push(i, 0.002); t += 0.002; z += a.x[o + 2] - last; last = a.x[o + 2]; }
      expect(z / t).toBeCloseTo(0.4, 2);
    }
  });
  it('radiation belt: positive ions drift westward, negative charges eastward', () => {
    const a = make(chargedParticlesFactory, { scene: 3, B: 1, E: 0.4, speed: 1 }, 20000);
    for (const i of [0, 1]) {
      const o = i * 3; let acc = 0, last = Math.atan2(a.x[o + 2], a.x[o]);
      for (let t = 0; t < 60; t += 0.002) {
        a.push(i, 0.002);
        const ph = Math.atan2(a.x[o + 2], a.x[o]); let d = ph - last;
        if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
        acc += d; last = ph;
      }
      expect(Math.sign(acc)).toBe(a.species[a.sp[i]].q > 0 ? 1 : -1); // atan2(z, x) increasing = westward here
    }
  });
});

describe('three-body problem', () => {
  it('the figure-eight is periodic', () => {
    const a = make(threeBodyFactory, { scene: 1, mu: 0.01, speed: 1 }, 2000);
    a.s.set(a.s0); a.hAd = 1e-3;
    a.stepBodies(6.32591398);
    for (let i = 0; i < 12; i++) expect(Math.abs(a.s[i] - a.s0[i])).toBeLessThan(1e-6);
  });
  it('Pythagorean: the lightest body escapes, leaving 4 + 5 bound, with energy −769/60 kept', () => {
    const a = make(threeBodyFactory, { scene: 2, mu: 0.01, speed: 1 }, 2000);
    a.s.set(a.s0); a.hAd = 1e-3;
    let t = 0, who = -1;
    while (t < 90 && who < 0) { a.stepBodies(0.1); t += 0.1; for (let i = 0; i < 3; i++) if (a.relativeEnergy(i) > 0) who = i; }
    expect(a.m[who]).toBe(3);
    expect(t).toBeGreaterThan(55); expect(t).toBeLessThan(65);
    expect(a.energy()).toBeCloseTo(-769 / 60, 5);
  });
  it('Lagrange: L-points balance exactly, and L4 holds a Trojan only below Routh’s limit', () => {
    for (const [mu, stable] of [[0.01, true], [0.05, false]] as const) {
      const a = make(threeBodyFactory, { scene: 0, mu, speed: 1 }, 4000);
      const g = new Float64Array(4);
      for (let l = 0; l < 5; l++) { a.deriv(a.lx[l], a.ly[l], 0, 0, g); expect(Math.hypot(g[2], g[3])).toBeLessThan(1e-12); }
      a.NT = 1; a.ts[0] = a.lx[3] + 0.01; a.ts[1] = a.ly[3]; a.ts[2] = 0; a.ts[3] = 0;
      let far = 0;
      for (let k = 0; k < 400; k++) {
        a.stepTests(0.5);
        if (a.ts[0] === a.lx[3] + 0.01) break; // (respawned: it left)
        far = Math.max(far, Math.hypot(a.ts[0] - a.lx[3], a.ts[1] - a.ly[3]));
      }
      if (stable) expect(far).toBeLessThan(0.3); else expect(far).toBeGreaterThan(0.3);
    }
  });
});

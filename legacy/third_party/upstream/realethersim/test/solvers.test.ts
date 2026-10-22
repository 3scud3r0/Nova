import { describe, expect, it } from 'vitest';
import { rk4Step } from '../src/physics/integrators/rk4';
import type { Derivative, ResolvedParams } from '../src/core/archetype';

const P: ResolvedParams = { eps: 0, gamma: 0, freqScale: 1, ampScale: 1, dt: 0 };

describe('rk4Step', () => {
  it('integrates dx/dt = x to e^t within RK4 truncation error', () => {
    const exp: Derivative = (o, x) => {
      o[0] = x[0];
    };
    const s = new Float64Array([1]);
    const dt = 0.01;
    for (let i = 0; i < 100; i++) rk4Step(s, 0, 1, exp, P, dt); // t = 1
    expect(s[0]).toBeCloseTo(Math.E, 5);
  });

  it('conserves energy for a harmonic oscillator over many steps', () => {
    // x' = v, v' = -x  =>  E = x^2 + v^2 is conserved
    const sho: Derivative = (o, x) => {
      o[0] = x[1];
      o[1] = -x[0];
    };
    const s = new Float64Array([1, 0]);
    const e0 = s[0] * s[0] + s[1] * s[1];
    const dt = 0.01;
    for (let i = 0; i < 10_000; i++) rk4Step(s, 0, 2, sho, P, dt); // ~16 periods
    const e1 = s[0] * s[0] + s[1] * s[1];
    expect(Math.abs(e1 - e0)).toBeLessThan(1e-6);
  });

  it('steps a sub-range at an offset without touching neighbours', () => {
    const exp: Derivative = (o, x) => {
      o[0] = x[0];
    };
    const s = new Float64Array([42, 1, 99]);
    rk4Step(s, 1, 1, exp, P, 0.1);
    expect(s[0]).toBe(42);
    expect(s[2]).toBe(99);
    expect(s[1]).toBeGreaterThan(1);
  });
});

import { describe, expect, it } from 'vitest';
import { aharonovBohmFactory } from '../src/archetypes/aharonovBohm';
import { casimirPlatesFactory, casimirFinitePart } from '../src/archetypes/casimirPlates';
import type { ArchetypeFactory } from '../src/core/archetype';

// Physics checks for the v0.1.105 Quantum systems: each pins a result the Learn notes quote.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const make = (f: ArchetypeFactory, params: Record<string, number>, n = 1): any => f.create({ particleCount: n, seed: 1, params: { dt: 0.016, ...params } });

describe('Aharonov–Bohm', () => {
  it('the fringes shift by the flux in flux quanta, and a whole quantum changes nothing', () => {
    const run = (flux: number): { shift: number; dose: number } => {
      const a = make(aharonovBohmFactory, { flux, speed: 1 });
      while (a.t < 420) a.advance();
      let dose = 0; for (const v of a.screen[0]) dose += v;
      return { shift: a.fringeShift().shift, dose };
    };
    expect(run(0.25).shift).toBeCloseTo(0.25, 2);
    expect(Math.abs(run(0.5).shift)).toBeCloseTo(0.5, 2);
    const zero = run(0), one = run(1);
    expect(one.shift).toBeCloseTo(0, 3);
    expect(one.dose).toBeCloseTo(zero.dose, 6);
  }, 120_000);
  it('the leapfrog keeps the norm', () => {
    const a = make(aharonovBohmFactory, { flux: 0.5, speed: 1 });
    a.absorb.fill(1);
    const n0 = a.norm(0);
    for (let i = 0; i < 300; i++) a.advance();
    expect(Math.abs(a.norm(0) / n0 - 1)).toBeLessThan(1e-4);
  }, 60_000);
});

describe('Casimir plates', () => {
  it('the regularised 1-D mode sum leaves exactly −π/(24d), whatever the gap', () => {
    for (const d of [1, 2, 0.5]) expect(d * casimirFinitePart(d, 0.004)).toBeCloseTo(-Math.PI / 24, 5);
  });
  it('the pressure is π²ħc/240d⁴: 13 Pa at 100 nm', () => {
    expect(make(casimirPlatesFactory, { gap: 100, speed: 1 }, 4000).pressure()).toBeCloseTo(13.0, 1);
  });
});

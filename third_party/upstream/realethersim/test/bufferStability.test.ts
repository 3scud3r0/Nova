import { describe, expect, it } from 'vitest';
import { LORENZ, makeAttractorFactory } from '../src/archetypes/strangeAttractor';
import { resolveParams } from '../src/core/params';

// Proxy for the zero-allocation requirement (NFR-1.2): the hot loop must not reallocate.
// We assert the positions buffer identity is stable across steps — a deterministic invariant
// that catches accidental per-frame allocation without flaky heap profiling.
describe('ensemble buffer stability', () => {
  const factory = makeAttractorFactory(LORENZ);
  const params = resolveParams(LORENZ.defaults, 0.005);

  it('returns a stable positions reference across steps', () => {
    const a = factory.create({ particleCount: 2000, seed: 7, params });
    const ref = a.readPositions();
    expect(a.readPositions()).toBe(ref);
    a.step(0.005, params);
    expect(a.readPositions()).toBe(ref); // same array object, mutated in place
    expect(ref.length).toBe(2000 * 3);
  });

  it('evolves positions and keeps them finite', () => {
    const a = factory.create({ particleCount: 2000, seed: 7, params });
    const before = Float32Array.from(a.readPositions());
    for (let i = 0; i < 50; i++) a.step(0.005, params);
    const after = a.readPositions();

    let moved = 0;
    let finite = true;
    for (let i = 0; i < after.length; i++) {
      if (after[i] !== before[i]) moved++;
      if (!Number.isFinite(after[i])) finite = false;
    }
    expect(finite).toBe(true);
    expect(moved).toBeGreaterThan(after.length * 0.5);
  });
});

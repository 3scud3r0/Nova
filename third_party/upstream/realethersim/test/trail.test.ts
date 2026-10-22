import { describe, expect, it } from 'vitest';
import { TRAIL_SLOTS, TrailRing } from '../src/sim/trail';

describe('TrailRing', () => {
  const n = 2; // 2 particles → 6 floats per slot

  it('seeds every slot with the current positions', () => {
    const ring = new TrailRing(n);
    const p0 = Float32Array.from([1, 1, 1, 2, 2, 2]);
    ring.seed(p0);
    for (let s = 0; s < TRAIL_SLOTS; s++) {
      expect(Array.from(ring.ring.subarray(s * n * 3, (s + 1) * n * 3))).toEqual(Array.from(p0));
    }
    expect(ring.getHead()).toBe(0);
  });

  it('captures into the next slot only every `stride` steps', () => {
    const ring = new TrailRing(n);
    ring.setLength(TRAIL_SLOTS * 3); // stride = 3
    const p1 = Float32Array.from([9, 9, 9, 8, 8, 8]);
    ring.capture(p1);
    ring.capture(p1);
    expect(ring.getHead()).toBe(0); // not yet
    ring.capture(p1);
    expect(ring.getHead()).toBe(1); // advanced on the 3rd
    expect(Array.from(ring.ring.subarray(n * 3, 2 * n * 3))).toEqual(Array.from(p1));
  });

  it('never captures when length is 0 (trails off)', () => {
    const ring = new TrailRing(n);
    ring.setLength(0);
    const p = Float32Array.from([1, 2, 3, 4, 5, 6]);
    for (let i = 0; i < 100; i++) ring.capture(p);
    expect(ring.getHead()).toBe(0);
  });
});

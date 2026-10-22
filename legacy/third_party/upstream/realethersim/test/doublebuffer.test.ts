import { describe, expect, it } from 'vitest';
import { allocSharedBuffers, SlabReader, SlabWriter } from '../src/sim/doublebuffer';

// The Worker/main publishing protocol: writer fills the inactive slab and flips the control word;
// reader always sees the latest fully-written slab. Tested single-threaded (deterministic).
describe('double-buffer protocol', () => {
  it('publishes a slab and reads it back intact', () => {
    const b = allocSharedBuffers(4); // 4 particles => stride 12
    const writer = new SlabWriter(b);
    const reader = new SlabReader(b);

    const p0 = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    writer.publish(p0, 5, 2);
    expect(Array.from(reader.read())).toEqual(Array.from(p0));
    expect(reader.frameIndex()).toBe(5);
    expect(reader.substeps()).toBe(2);
  });

  it('flips to the other slab on the next publish', () => {
    const b = allocSharedBuffers(4);
    const writer = new SlabWriter(b);
    const reader = new SlabReader(b);

    const p0 = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const p1 = p0.map((x) => x * 10);
    writer.publish(p0, 1, 1);
    writer.publish(p1, 2, 4);
    expect(Array.from(reader.read())).toEqual(Array.from(p1));
    expect(reader.frameIndex()).toBe(2);
    expect(reader.substeps()).toBe(4);
  });
});

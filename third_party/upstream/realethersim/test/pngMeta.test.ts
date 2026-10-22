import { describe, expect, it } from 'vitest';
import { embedText, extractText } from '../src/state/pngMeta';

// A structurally-minimal PNG: 8-byte signature + an empty IEND chunk (len 0, type IEND, its
// well-known CRC). Enough to exercise the chunk walk / insert without a real encoder.
const minimalPng = (): Uint8Array =>
  new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

describe('PNG tEXt metadata', () => {
  it('round-trips embedded text (insert before IEND, read back)', () => {
    const payload = JSON.stringify({ archetypeId: 'lorenz', n: 100000, camera: [1.5, -2, 3] });
    const out = embedText(minimalPng(), 'ethersim', payload);
    expect(out.length).toBeGreaterThan(minimalPng().length);
    expect(extractText(out, 'ethersim')).toBe(payload);
  });

  it('returns null for the wrong keyword', () => {
    const out = embedText(minimalPng(), 'ethersim', 'hi');
    expect(extractText(out, 'nope')).toBeNull();
  });

  it('rejects non-PNG bytes', () => {
    expect(extractText(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 'ethersim')).toBeNull();
  });

  it('does not corrupt the trailing IEND chunk', () => {
    const out = embedText(minimalPng(), 'ethersim', 'data');
    const tail = out.subarray(out.length - 8); // IEND type + crc
    expect(Array.from(tail)).toEqual([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/state/schema';
import { encodeShareState, parseShareUrl } from '../src/app/shareLink';

const snap = {
  schemaVersion: 3,
  archetypeId: 'henon-heiles',
  particleCount: 80_000,
  global: { dt: 0.02, trailLength: 0 },
  archetypeParams: { lambda: 0.8 },
  hierarchy: [],
  matrices: {},
  initVectors: {},
  camera: { position: [1.1, 2.2, 3.3], target: [0, 0.5, -0.25], zoomDecade: 0, fov: 50, logarithmicDepth: false },
  rng: { seed: 1 },
  frameIndex: 0,
} as unknown as Snapshot;

describe('share-link URL encoding', () => {
  it('round-trips system + settings + camera through ?s=', () => {
    const url = 'https://ethersim.ai/index.html?s=' + encodeShareState(snap);
    const p = parseShareUrl(url);
    expect(p?.id).toBe('henon-heiles');
    expect(p?.p?.lambda).toBeCloseTo(0.8);
    expect(p?.n).toBe(80_000);
    expect(p?.dt).toBeCloseTo(0.02);
    expect(p?.tl).toBe(0);
    expect(p?.cam?.[0]).toBeCloseTo(1.1);
    expect(p?.cam?.[4]).toBeCloseTo(0.5);
    expect(p?.cam?.[5]).toBeCloseTo(-0.25);
  });

  it('produces a URL-safe payload (no +, /, = or spaces)', () => {
    const s = encodeShareState(snap);
    expect(s).not.toMatch(/[+/=\s]/);
  });

  it('parses an id-only ?sim= link', () => {
    expect(parseShareUrl('https://ethersim.ai/index.html?sim=lorenz')?.id).toBe('lorenz');
  });

  it('returns null for malformed or absent links', () => {
    expect(parseShareUrl('https://ethersim.ai/index.html?s=!!not-base64!!')).toBeNull();
    expect(parseShareUrl('https://ethersim.ai/index.html')).toBeNull();
  });
});

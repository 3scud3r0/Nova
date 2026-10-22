import { describe, expect, it } from 'vitest';
import { quantumFoamFactory } from '../src/archetypes/quantumFoam';
import { defaultParams } from '../src/core/archetype';
import { resolveParams } from '../src/core/params';

// Gray-Scott must stay bounded (concentrations in ~[0,1]) and actually develop structure from the
// seed blobs — and the field-native readField() path must surface the V grid.
describe('quantumFoam (Gray-Scott)', () => {
  const params = resolveParams(defaultParams(quantumFoamFactory.params), 1);

  it('snaps the particle count to a square grid', () => {
    const a = quantumFoamFactory.create({ particleCount: 40_000, seed: 1, params });
    expect(a.particleCount).toBe(40_000); // 200 × 200
    const field = a.readField?.();
    expect(field?.width).toBe(200);
    expect(field?.height).toBe(200);
  });

  it('stays bounded and evolves a non-trivial field', () => {
    const a = quantumFoamFactory.create({ particleCount: 16_384, seed: 2, params });
    for (let i = 0; i < 200; i++) a.step(1, params);
    const field = a.readField!();
    const v = field.texture as Float32Array;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < v.length; i++) {
      expect(Number.isFinite(v[i])).toBe(true);
      if (v[i] < min) min = v[i];
      if (v[i] > max) max = v[i];
    }
    expect(min).toBeGreaterThanOrEqual(-0.05);
    expect(max).toBeLessThanOrEqual(1.05);
    expect(max - min).toBeGreaterThan(0.1); // structure formed, not a flat field
  });
});

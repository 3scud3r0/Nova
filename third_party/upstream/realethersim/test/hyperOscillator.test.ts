import { describe, expect, it } from 'vitest';
import { hyperOscillatorFactory } from '../src/archetypes/hyperOscillator';
import { defaultParams } from '../src/core/archetype';
import { resolveParams } from '../src/core/params';

// The hyper-oscillator is bounded by construction (positions are cos/sin sums), so it must stay
// finite and within its amplitude envelope for any dt — unlike the attractors it cannot blow up.
describe('hyperOscillator', () => {
  const params = resolveParams(defaultParams(hyperOscillatorFactory.params), 0.006);

  it('exposes a nested parent→child hierarchy (FR-3.2)', () => {
    const a = hyperOscillatorFactory.create({ particleCount: 1000, seed: 3, params });
    const nodes = a.getHierarchy();
    expect(nodes.length).toBe(params.levels);
    expect(nodes[0].parentId).toBeNull();
    expect(nodes[1].parentId).toBe(nodes[0].id);
  });

  it('stays finite and bounded over many steps (even at a large dt)', () => {
    const a = hyperOscillatorFactory.create({ particleCount: 1000, seed: 3, params });
    for (let i = 0; i < 300; i++) a.step(0.05, params); // deliberately large dt
    const pos = a.readPositions();
    let maxAbs = 0;
    for (let i = 0; i < pos.length; i++) {
      expect(Number.isFinite(pos[i])).toBe(true);
      maxAbs = Math.max(maxAbs, Math.abs(pos[i]));
    }
    // Σ Aₖ (S_a=0.6, L=4) ≈ 2.18, × render scale 0.8 ≈ 1.74 — comfortably under 2.5.
    expect(maxAbs).toBeLessThan(2.5);
  });
});

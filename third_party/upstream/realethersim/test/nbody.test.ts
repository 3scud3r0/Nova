import { describe, expect, it } from 'vitest';
import { nbodyFactory } from '../src/archetypes/nbody';
import { defaultParams } from '../src/core/archetype';
import { resolveParams } from '../src/core/params';

const DIM = 6;
const G = 0.6;
const EPS = 0.1;

// Total energy of the softened N-body system (KE + Plummer PE), used to verify the integrator.
function totalEnergy(state: Float64Array, n: number): number {
  let ke = 0;
  for (let i = 0; i < n; i++) {
    const o = i * DIM;
    ke += 0.5 * (state[o + 3] ** 2 + state[o + 4] ** 2 + state[o + 5] ** 2);
  }
  let pe = 0;
  const eps2 = EPS * EPS;
  for (let i = 0; i < n; i++) {
    const oi = i * DIM;
    for (let j = i + 1; j < n; j++) {
      const oj = j * DIM;
      const dx = state[oj] - state[oi];
      const dy = state[oj + 1] - state[oi + 1];
      const dz = state[oj + 2] - state[oi + 2];
      pe -= G / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
    }
  }
  return ke + pe;
}

describe('nbody (velocity-Verlet)', () => {
  const params = resolveParams({ ...defaultParams(nbodyFactory.params), coupling: 0 }, 0.005);

  it('exposes a root → clusters hierarchy with particle ranges (FR-3.2)', () => {
    const a = nbodyFactory.create({ particleCount: 400, seed: 5, params });
    const nodes = a.getHierarchy();
    expect(nodes[0].parentId).toBeNull();
    const clusters = nodes.filter((n) => n.parentId === 'root');
    expect(clusters.length).toBe(params.clusters);
    // cluster particle ranges tile the whole population
    const total = clusters.reduce((s, c) => s + (c.particleCount ?? 0), 0);
    expect(total).toBe(400);
    expect(clusters[0].particleStart).toBe(0);
  });

  it('conserves energy within symplectic drift bounds', () => {
    const n = 120;
    const a = nbodyFactory.create({ particleCount: n, seed: 5, params });
    const state = a.readState();
    const e0 = totalEnergy(state, n);
    for (let i = 0; i < 600; i++) a.step(0.005, params);
    const e1 = totalEnergy(a.readState(), n);
    // Velocity-Verlet is symplectic: energy oscillates but does not drift away.
    expect(Math.abs((e1 - e0) / e0)).toBeLessThan(0.05);
    for (let i = 0; i < state.length; i++) expect(Number.isFinite(state[i])).toBe(true);
  });
});

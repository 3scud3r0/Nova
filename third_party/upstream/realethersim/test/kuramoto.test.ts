import { describe, expect, it } from 'vitest';
import { registerArchetypes } from '../src/archetypes';
import { getFactory } from '../src/core/registry';
import { resolveParams } from '../src/core/params';

registerArchetypes();

// |order parameter| r = |mean(e^{iθ})| ∈ [0,1]: 0 = total incoherence, 1 = perfect sync.
function orderParameter(theta: Float64Array): number {
  let c = 0;
  let s = 0;
  for (let i = 0; i < theta.length; i++) {
    c += Math.cos(theta[i]);
    s += Math.sin(theta[i]);
  }
  return Math.hypot(c / theta.length, s / theta.length);
}

// The defining behaviour of the Kuramoto model: spontaneous synchronisation past a critical
// coupling, and none without coupling. (The GPU twin integrates the identical mean-field update.)
describe('Kuramoto synchronisation', () => {
  const f = getFactory('kuramoto');
  const N = 3000;
  const dt = f.defaultDt;
  const P = (coupling: number) => resolveParams({ coupling, omega0: 1.0, spread: 0.5 }, dt);

  it('starts incoherent and synchronises under strong coupling', () => {
    const a = f.create({ particleCount: N, seed: 7, params: P(2.5) });
    const r0 = orderParameter(a.readState());
    for (let i = 0; i < 800; i++) a.step(dt, P(2.5));
    const r1 = orderParameter(a.readState());
    expect(r0).toBeLessThan(0.15); // random initial phases → ~0
    expect(r1).toBeGreaterThan(0.6); // K well above critical → locked
  });

  it('stays incoherent with zero coupling', () => {
    const a = f.create({ particleCount: N, seed: 7, params: P(0) });
    for (let i = 0; i < 800; i++) a.step(dt, P(0));
    expect(orderParameter(a.readState())).toBeLessThan(0.25); // free drift → no sync
  });
});

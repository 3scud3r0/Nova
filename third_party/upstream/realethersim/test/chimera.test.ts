import { describe, expect, it } from 'vitest';
import { registerArchetypes } from '../src/archetypes';
import { getFactory } from '../src/core/registry';
import { resolveParams } from '../src/core/params';

registerArchetypes();

// Local order parameter over a sliding window of the ring: |mean(e^{iθ})| within the window.
// A chimera = coexistence: some windows ≈ 1 (coherent arc) AND some windows low (incoherent arc).
function localOrder(theta: Float64Array, windows: number): { max: number; min: number } {
  const n = theta.length;
  const w = Math.floor(n / windows);
  let max = 0;
  let min = 1;
  for (let k = 0; k < windows; k++) {
    let c = 0;
    let s = 0;
    for (let j = k * w; j < (k + 1) * w; j++) {
      c += Math.cos(theta[j]);
      s += Math.sin(theta[j]);
    }
    const r = Math.hypot(c / w, s / w);
    if (r > max) max = r;
    if (r < min) min = r;
  }
  return { max, min };
}

// The defining property of a chimera: a coherent region and an incoherent region coexist on the
// same uniformly-coupled ring. (The GPU twin integrates the identical decomposed coupling.)
describe('Chimera states', () => {
  const f = getFactory('chimera');
  const N = 2400;
  const dt = f.defaultDt;
  const P = resolveParams({ alpha: 1.46, kernelA: 0.9, coupling: 1.0 }, dt);

  it('settles into coexisting coherent + incoherent arcs', () => {
    const a = f.create({ particleCount: N, seed: 3, params: P });
    for (let i = 0; i < 4000; i++) a.step(dt, P);
    const { max, min } = localOrder(a.readState(), 24);
    expect(max).toBeGreaterThan(0.9); // a locked (coherent) arc exists
    expect(min).toBeLessThan(0.6); // an incoherent arc coexists with it
  });
});

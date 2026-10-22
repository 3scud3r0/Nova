import { describe, expect, it } from 'vitest';
import { resolveParams } from '../src/core/params';
import { KarmanArchetype, karmanFactory } from '../src/archetypes/karman';

// The defining behaviour of a Kármán street: the wake is UNSTEADY (vortices shed periodically) and
// carries vorticity of BOTH signs (alternating rotation) — while the solver stays finite (stable).
describe('Kármán vortex street (LBM)', () => {
  const dt = karmanFactory.defaultDt;
  const P = resolveParams({ reynolds: 180, speed: 0.08 }, dt);

  it('sheds an unsteady, alternating-sign wake and stays stable', () => {
    const a = new KarmanArchetype({ particleCount: 16_384, seed: 1, params: P }); // 256×64
    const W = 256;
    const H = 64;
    // probe a point in the wake, a few diameters downstream of the cylinder, on the centreline
    const probe = Math.floor(H / 2) * W + Math.floor(W * 0.5);

    // warm up so the instability develops
    for (let i = 0; i < 4000; i++) a.step(dt, P);

    // record the wake vorticity over a stretch of steps
    let min = Infinity;
    let max = -Infinity;
    let finite = true;
    let wakePos = 0;
    let wakeNeg = 0;
    for (let i = 0; i < 1500; i++) {
      a.step(dt, P);
      const v = a.readState()[probe];
      if (!Number.isFinite(v)) finite = false;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // also sample the spatial wake at the final step for both-sign vorticity
    const field = a.readState();
    for (let x = Math.floor(W * 0.35); x < W * 0.9; x++) {
      const v = field[Math.floor(H / 2) * W + x];
      if (v > 1e-4) wakePos++;
      if (v < -1e-4) wakeNeg++;
    }

    expect(finite, 'solver stays finite (stable)').toBe(true);
    expect(max - min, 'wake oscillates over time (unsteady shedding)').toBeGreaterThan(2e-3);
    expect(wakePos, 'positive-vorticity vortices present').toBeGreaterThan(3);
    expect(wakeNeg, 'negative-vorticity vortices present').toBeGreaterThan(3);
  }, 30_000);
});

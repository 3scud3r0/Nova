import { describe, expect, it } from 'vitest';
import { largestLyapunov } from '../src/physics/lyapunov';
import { LORENZ, ROSSLER } from '../src/archetypes/strangeAttractor';
import type { ResolvedParams } from '../src/core/archetype';

// The objective correctness gate: a chaotic solver must reproduce the known largest
// Lyapunov exponent — "looks chaotic" is not proof (forward Euler looks chaotic too,
// while spuriously inflating the attractor).
describe('largestLyapunov (Benettin)', () => {
  it('reproduces the Lorenz exponent ≈ 0.9056', () => {
    const p: ResolvedParams = { eps: 0, gamma: 0, freqScale: 1, ampScale: 1, dt: 0.005, sigma: 10, rho: 28, beta: 8 / 3 };
    const lle = largestLyapunov(LORENZ, p, { dt: 0.005, tau: 0.5, transient: 2000, intervals: 2000 });
    // Finite-time Benettin lands within a few percent of the reference 0.9056.
    expect(lle).toBeGreaterThan(0.84);
    expect(lle).toBeLessThan(0.97);
  });

  it('finds a positive (chaotic) exponent for Rössler', () => {
    const p: ResolvedParams = { eps: 0, gamma: 0, freqScale: 1, ampScale: 1, dt: 0.01, a: 0.2, b: 0.2, c: 5.7 };
    const lle = largestLyapunov(ROSSLER, p, { dt: 0.01, tau: 1.0, transient: 4000, intervals: 4000 });
    // Reference ≈ 0.0714; weakly chaotic and noisy at finite time — assert sign + ballpark.
    expect(lle).toBeGreaterThan(0.02);
    expect(lle).toBeLessThan(0.15);
  });
});

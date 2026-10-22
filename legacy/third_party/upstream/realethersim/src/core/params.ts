import type { ResolvedParams } from './archetype';

// Global (cross-archetype) controls. Archetype-specific params live in a separate
// Record<string, number> keyed by the active factory's ParamSpec.
export interface GlobalParams {
  dt: number;
  particleCount: number;
  trailLength: number; // fading-trail depth in sim steps (0 = off), FR-2.2
  gpuCompute: boolean; // experimental: run attractor integration GPU-resident (TSL compute)
}

export const DEFAULT_GLOBAL: GlobalParams = {
  dt: 0.005,
  particleCount: 100_000,
  trailLength: 160,
  gpuCompute: false,
};

// Merge the active archetype's param values with the global dt into the flat ResolvedParams
// the physics reads. (Phase 1 folds NodeSpec.params in here per hierarchy level.)
export function resolveParams(archetypeParams: Record<string, number>, dt: number): ResolvedParams {
  return { ...archetypeParams, dt };
}

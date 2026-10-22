import type { ResolvedParams } from '../core/archetype';
import type { AttractorSystem } from '../archetypes/strangeAttractor';
import { rk4Step } from './integrators/rk4';

export interface LyapunovOptions {
  dt?: number;
  tau?: number; // renormalization interval (sim-time)
  transient?: number; // steps discarded before measuring
  intervals?: number; // number of τ measurement intervals
  d0?: number; // initial separation (f64 — f32 epsilon ~1.2e-7 would swamp it)
}

function distance(a: Float64Array, b: Float64Array, dim: number): number {
  let s = 0;
  for (let i = 0; i < dim; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

// Pull the perturbed trajectory back to separation d0 along the current separation vector.
function renormalize(ref: Float64Array, pert: Float64Array, dim: number, d0: number): void {
  const d = distance(ref, pert, dim);
  if (d === 0) {
    pert[0] = ref[0] + d0;
    return;
  }
  const k = d0 / d;
  for (let i = 0; i < dim; i++) pert[i] = ref[i] + (pert[i] - ref[i]) * k;
}

// Largest Lyapunov exponent via the Benettin two-trajectory method.
// Reference values: Lorenz ≈ 0.9056, Rössler ≈ 0.0714, Thomas ≈ 0.04.
export function largestLyapunov(
  system: AttractorSystem,
  p: ResolvedParams,
  opts: LyapunovOptions = {},
): number {
  const dim = system.dim;
  const dt = opts.dt ?? 0.005;
  const tau = opts.tau ?? 0.5;
  const stepsPerTau = Math.max(1, Math.round(tau / dt));
  const transient = opts.transient ?? 2000;
  const intervals = opts.intervals ?? 2000;
  const d0 = opts.d0 ?? 1e-8;

  const ref = new Float64Array(dim);
  const pert = new Float64Array(dim);
  for (let i = 0; i < dim; i++) ref[i] = system.seedPoint[i] ?? 0;

  // Discard transient so we start on the attractor.
  for (let s = 0; s < transient; s++) rk4Step(ref, 0, dim, system.deriv, p, dt);

  // Seed the perturbed trajectory at separation d0.
  pert.set(ref);
  pert[0] += d0;

  let sum = 0;
  for (let k = 0; k < intervals; k++) {
    for (let s = 0; s < stepsPerTau; s++) {
      rk4Step(ref, 0, dim, system.deriv, p, dt);
      rk4Step(pert, 0, dim, system.deriv, p, dt);
    }
    const d = distance(ref, pert, dim);
    sum += Math.log(d / d0);
    renormalize(ref, pert, dim, d0);
  }

  return sum / (intervals * stepsPerTau * dt);
}

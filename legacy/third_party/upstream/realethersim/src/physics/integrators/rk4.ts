import type { Derivative, ResolvedParams } from '../../core/archetype';

// Classic 4th-order Runge-Kutta, stepping a single dim-length state vector in place.
// Used both by the 100k-particle ensemble (called per particle) and by the Lyapunov
// gate (called on a single trajectory) — one source of truth.
//
// Zero allocation: module-scope scratch reused on every call. Not re-entrant, but every
// call site is sequential. MAX_DIM bounds the largest archetype state vector.
const MAX_DIM = 8;
const _x = new Float64Array(MAX_DIM);
const _tmp = new Float64Array(MAX_DIM);
const _k1 = new Float64Array(MAX_DIM);
const _k2 = new Float64Array(MAX_DIM);
const _k3 = new Float64Array(MAX_DIM);
const _k4 = new Float64Array(MAX_DIM);

export function rk4Step(
  state: Float64Array,
  off: number,
  dim: number,
  deriv: Derivative,
  p: ResolvedParams,
  dt: number,
): void {
  for (let i = 0; i < dim; i++) _x[i] = state[off + i];

  deriv(_k1, _x, p);
  for (let i = 0; i < dim; i++) _tmp[i] = _x[i] + 0.5 * dt * _k1[i];
  deriv(_k2, _tmp, p);
  for (let i = 0; i < dim; i++) _tmp[i] = _x[i] + 0.5 * dt * _k2[i];
  deriv(_k3, _tmp, p);
  for (let i = 0; i < dim; i++) _tmp[i] = _x[i] + dt * _k3[i];
  deriv(_k4, _tmp, p);

  const h = dt / 6;
  for (let i = 0; i < dim; i++) {
    state[off + i] = _x[i] + h * (_k1[i] + 2 * _k2[i] + 2 * _k3[i] + _k4[i]);
  }
}

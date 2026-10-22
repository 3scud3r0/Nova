import { compileExpr, type CompiledFn } from './expr';

// Live, shared state for the user-authored "Custom" parametric system. The editor UI writes the three
// coordinate expressions here; the customParametric archetype (main-thread only — compiled closures
// can't cross the worker boundary) reads the compiled functions each frame and re-syncs when the
// version bumps. Kept in core (not the UI layer) so the archetype never imports UI code.

export const CUSTOM_DEFAULTS = {
  x: 'sin(a*i/n*TAU + t)',
  y: 'sin(b*i/n*TAU)',
  z: 'sin(c*i/n*TAU - t)',
};

export interface CustomExprState {
  src: { x: string; y: string; z: string };
  fn: { x: CompiledFn; y: CompiledFn; z: CompiledFn };
  err: { x: string; y: string; z: string }; // '' when that axis compiled cleanly
  params: string[]; // union of free parameter names across the three axes (for the UI)
  version: number; // bumps on any successful change so the archetype re-syncs
}

const ZERO: CompiledFn = () => 0;

function build(src: { x: string; y: string; z: string }, prev?: CustomExprState): CustomExprState {
  const fn = { x: prev?.fn.x ?? ZERO, y: prev?.fn.y ?? ZERO, z: prev?.fn.z ?? ZERO };
  const err = { x: '', y: '', z: '' };
  const params = new Set<string>();
  for (const axis of ['x', 'y', 'z'] as const) {
    const r = compileExpr(src[axis]);
    if (r.ok) { fn[axis] = r.fn; for (const p of r.params) params.add(p); }
    else { err[axis] = r.error; } // keep the previous good fn for this axis on error
  }
  return { src: { ...src }, fn, err, params: [...params].sort(), version: (prev?.version ?? 0) + 1 };
}

let state: CustomExprState = build({ ...CUSTOM_DEFAULTS });

export function getCustomExpr(): CustomExprState { return state; }

// Update one axis's expression (called by the editor). Returns the new state (with any error text).
export function setCustomAxis(axis: 'x' | 'y' | 'z', src: string): CustomExprState {
  state = build({ ...state.src, [axis]: src }, state);
  return state;
}

// Replace all three at once (used when loading a saved/shared custom system).
export function setCustomExpr(src: { x: string; y: string; z: string }): CustomExprState {
  state = build(src, state);
  return state;
}

export function resetCustomExpr(): CustomExprState {
  state = build({ ...CUSTOM_DEFAULTS });
  return state;
}

// The one contract every simulation archetype plugs into.
// The Simulation Manager only ever calls this interface — it never inspects physics,
// which is what makes adding an archetype pure fan-out (one file + one registry import).

export type ArchetypeKind = 'flow' | 'map' | 'raymarch';

export interface NodeSpec {
  id: string;
  parentId: string | null;
  label: string;
  stateOffset: number; // start index into the flat SoA state buffer
  stateLength: number; // number of scalars this node owns
  params?: Record<string, number>; // local overrides merged over globals
  // For nodes that map to a contiguous group of particles (e.g. N-body clusters), the render
  // range used by the hierarchy tree to highlight the selection. Omitted when a node isn't a
  // particle group (e.g. a hyper-oscillator level).
  particleStart?: number;
  particleCount?: number;
}

// Flat resolved parameters the physics reads. `dt` is always present; everything else is
// archetype-specific (σ/ρ/β for Lorenz, omega0/eps/levels for the hyper-oscillator, …).
export type ResolvedParams = { dt: number } & Record<string, number>;

// Derivative writes dim values into `out`, reading the local dim-length state `x`.
// Mutates pre-allocated scratch — ZERO allocation in the hot loop.
export type Derivative = (out: Float64Array, x: Float64Array, p: ResolvedParams) => void;

// Declarative tunable parameter — the UI builds sliders from these, so archetypes own their
// own controls. `rebuild: true` means a change reallocates state (handled by tearing down the
// archetype), e.g. discrete structural params like `levels`.
export interface ParamSpec {
  key: string;
  label?: string;
  min: number;
  max: number;
  step?: number;
  default: number;
  options?: Record<string, number>; // discrete select instead of a slider
  rebuild?: boolean;
}

export interface RenderHint {
  geometry: 'points' | 'instancedSegments';
  exposesField?: boolean;
  pointSize?: number;
  // Graphics owns material creation from these hints, so Physics never imports three.
}

// Optional static "guide geometry" a system can draw over its cloud — an equipotential boundary, a
// reach circle, fixed points, an axis, a torus cell, etc. A general, opt-in overlay: ANY factory may
// provide it (most don't). Points are in RENDER space (already scaled/centred to match the cloud),
// so Physics still never imports three — Graphics just draws the line strips.
export interface GuideLine {
  points: Array<[number, number, number]>;
  color?: number;
  closed?: boolean; // connect the last point back to the first (a loop)
}
export type GuideSpec = GuideLine[];

export interface ArchetypeConfig {
  particleCount: number;
  seed: number;
  params: ResolvedParams;
}

export interface Archetype {
  readonly id: string;
  readonly kind: ArchetypeKind;
  readonly particleCount: number;

  step(dt: number, p: ResolvedParams): void; // mutates internal SoA, ZERO allocation

  readPositions(): Float32Array; // length particleCount*3, stable view (never a new array)
  readColors(): Float32Array | null; // per-particle rgb, computed once
  readState(): Float64Array; // authoritative f64 (snapshot / Lyapunov)
  loadState(s: Float64Array): void;

  getHierarchy(): NodeSpec[];
  renderHint(): RenderHint;
  dispose(): void;

  // optional: field-native archetypes (foam) expose a field in addition to positions
  // `mask` (optional, static, 0…1 per cell) tints materials — walls, glass — under the field; `mask` must be the same array object each frame
  // `scale` (optional) fixes the colour scale (value at full colour) instead of following the field's mean amplitude;
  // `aspect` is the panel's height/width (default: height/width in cells); `upright` stands the panel up facing +z (row 0 at the bottom)
  readField?(): { texture: unknown; width: number; height: number; mask?: ArrayLike<number>; scale?: number; aspect?: number; upright?: boolean };
}

export interface ArchetypeFactory {
  readonly id: string;
  readonly label: string;
  readonly category: string; // UI grouping bucket (e.g. 'Attractor', 'Map', 'N-Body')
  readonly kind: ArchetypeKind;
  readonly params: ParamSpec[];
  readonly defaultParticleCount: number;
  readonly defaultDt: number; // global dt applied when this system is selected (its stable step)
  readonly particleCountOptions?: number[]; // overrides the UI's default count choices (e.g. N-body caps lower)
  readonly defaultTrail?: number; // trail length applied on selection (0 for static systems — no motion)
  readonly guides?: () => GuideSpec; // optional static overlay geometry (render space); see GuideSpec
  readonly bloom?: number; // optional HDR bloom strength override for this system (default in bootstrap)
  readonly mainThread?: boolean; // force the main-thread driver (e.g. user-authored systems whose compiled closures can't cross to the sim worker)
  readonly fieldRender?: boolean; // render the system's readField() as a smooth colour-map panel instead of a point cloud (implies mainThread)
  // Physical sim-clock: when present, the UI shows "T + <modelTime × scale> <unit>". modelTime is
  // accumulated in bootstrap as Σ(fixed-step dt × current speed param) — exactly how time-calibrated
  // archetypes advance their own t — and wraps at `cycle` (model units) for systems that replay.
  readonly clock?: { scale: number; unit: string; cycle?: number; offset?: number }; // offset = model time the system starts at
  create(config: ArchetypeConfig): Archetype;
}

// Default parameter values derived from a factory's spec.
export function defaultParams(specs: ParamSpec[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of specs) out[s.key] = s.default;
  return out;
}

import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { spectralGradient } from '../core/color';
import { mulberry32 } from '../state/rng';

// Iterated maps (the `kind:'map'` path): each particle is a point repeatedly pushed through a
// discrete map x_{n+1}=f(x_n). 100k particles seeded near the basin all settle onto the attractor,
// so the cloud always renders the famous map image; trails add the connecting filaments. 2D maps
// render in the z=0 plane; some (Pickover) are 3D. No dt — `defaultDt` only paces the accumulator.

// out and x are dim-length; iterate writes the next state into out (may read all of x first).
type MapFn = (out: Float64Array, x: Float64Array, p: ResolvedParams) => void;

export interface MapSystem {
  id: string;
  label: string;
  dim: number; // 2 or 3
  iterate: MapFn;
  defaults: Record<string, number>;
  paramSpec: ParamSpec[];
  init: number[];
  spread: number; // initial cloud radius around init (must stay inside the basin of attraction)
  scale: number;
  center: [number, number, number];
  pointSize: number;
  dt: number; // accumulator pacing only
  depth?: number; // 2D maps only: opt-in 3D relief amplitude — drapes the attractor over a height field
  radialDepth?: number; // 2D icons: radial-only relief z=f(R) — adds depth while preserving N-fold symmetry
}

const DEPTH_FREQ = 1.7; // spatial frequency of the eggcrate relief the depth-maps drape over (render space)
const RADIAL_FREQ = 4.5; // concentric-ripple frequency for the radial relief (icons — keeps N-fold symmetry)
// Canonical phase portraits that MUST stay flat: their fractal banding / stochastic-web structure is
// only meaningful in the plane. Every other non-icon 2D map is an attractor-image that gets the eggcrate
// drape; the symmetric icons get a RADIAL relief instead (z=f(R) only ⇒ N-fold symmetry preserved).
const FLAT_MAPS = new Set(['tinkerbell', 'ikeda', 'henon', 'lozi', 'standard', 'zaslavsky']);
const RADIAL_MAPS = new Set([
  'icon-sanddollar', 'icon-trinity', 'icon-pentagram', 'icon-hexagon', 'icon-heptagon', 'icon-clamshell',
]);

function autoParams(defaults: Record<string, number>): ParamSpec[] {
  return Object.entries(defaults).map(([key, v]) => {
    const span = Math.max(Math.abs(v), 1);
    return { key, label: key, min: +(v - span).toFixed(4), max: +(v + span).toFixed(4), step: +(span / 100).toFixed(4), default: v };
  });
}

const mid = (r: [number, number]): number => (r[0] + r[1]) / 2;

interface MapSpec {
  id: string;
  label: string;
  dim?: number;
  iterate: MapFn;
  defaults: Record<string, number>;
  init: number[];
  bounds: { x: [number, number]; y: [number, number]; z?: [number, number] };
  spread?: number;
  pointSize?: number;
  depth?: number; // 2D maps: opt-in 3D relief (attractor-image maps get it; canonical phase portraits don't)
}

function makeMap(o: MapSpec): MapSystem {
  const dim = o.dim ?? 2;
  const zr = o.bounds.z ?? [0, 0];
  const range = Math.max(o.bounds.x[1] - o.bounds.x[0], o.bounds.y[1] - o.bounds.y[0], zr[1] - zr[0] || 0.0001);
  return {
    id: o.id,
    label: o.label,
    dim,
    iterate: o.iterate,
    defaults: o.defaults,
    paramSpec: autoParams(o.defaults),
    init: o.init,
    spread: o.spread ?? 0.1,
    scale: 3 / range,
    center: [mid(o.bounds.x), mid(o.bounds.y), o.bounds.z ? mid(o.bounds.z) : 0],
    pointSize: o.pointSize ?? 0.01,
    dt: 0.004,
    // attractor-image maps drape over the eggcrate; icons get a radial relief; canonical/3D stay flat
    depth: dim > 2 ? undefined : (o.depth ?? ((FLAT_MAPS.has(o.id) || RADIAL_MAPS.has(o.id)) ? 0 : 0.5)),
    radialDepth: dim > 2 ? undefined : (RADIAL_MAPS.has(o.id) ? 0.4 : undefined),
  };
}

const sign = Math.sign;
const gm = (a: number, v: number): number => a * v + (2 * (1 - a) * v * v) / (1 + v * v); // Gumowski–Mira f(x)

export const MAP_SYSTEMS: Record<string, MapSystem> = Object.fromEntries(
  [
    makeMap({ id: 'clifford', label: 'Clifford', defaults: { a: -1.4, b: 1.7, c: 1, d: 0.7 }, init: [0.1, 0.1], bounds: { x: [-2.4, 2.4], y: [-2.4, 2.4] },
      iterate: (o, x, p) => { o[0] = Math.sin(p.a * x[1]) + p.c * Math.cos(p.a * x[0]); o[1] = Math.sin(p.b * x[0]) + p.d * Math.cos(p.b * x[1]); } }),
    makeMap({ id: 'de-jong', label: 'de Jong', defaults: { a: 1.4, b: -2.3, c: 2.4, d: -2.1 }, init: [0.1, 0.1], bounds: { x: [-2, 2], y: [-2, 2] },
      iterate: (o, x, p) => { o[0] = Math.sin(p.a * x[1]) - Math.cos(p.b * x[0]); o[1] = Math.sin(p.c * x[0]) - Math.cos(p.d * x[1]); } }),
    makeMap({ id: 'svensson', label: 'Svensson', defaults: { a: 1.4, b: 1.56, c: 1.4, d: -6.56 }, init: [0.1, 0.1], bounds: { x: [-7.6, 7.6], y: [-2.5, 2.5] },
      iterate: (o, x, p) => { o[0] = p.d * Math.sin(p.a * x[0]) - Math.sin(p.b * x[1]); o[1] = p.c * Math.cos(p.a * x[0]) + Math.cos(p.b * x[1]); } }),
    makeMap({ id: 'hopalong', label: 'Hopalong', defaults: { a: 0.4, b: 1, c: 0 }, init: [0, 0], spread: 0.5, bounds: { x: [-30, 30], y: [-30, 30] },
      iterate: (o, x, p) => { o[0] = x[1] - sign(x[0]) * Math.sqrt(Math.abs(p.b * x[0] - p.c)); o[1] = p.a - x[0]; } }),
    makeMap({ id: 'gumowski-mira', label: 'Gumowski–Mira', defaults: { a: -0.2, b: 1 }, init: [1, 1], spread: 0.3, bounds: { x: [-20, 20], y: [-20, 20] },
      iterate: (o, x, p) => { o[0] = p.b * x[1] + gm(p.a, x[0]); o[1] = -x[0] + gm(p.a, o[0]); } }),
    makeMap({ id: 'tinkerbell', label: 'Tinkerbell', defaults: { a: 0.9, b: -0.6013, c: 2, d: 0.5 }, init: [-0.72, -0.64], spread: 0.02, bounds: { x: [-1.4, 0.6], y: [-1.8, 0.4] },
      iterate: (o, x, p) => { o[0] = x[0] * x[0] - x[1] * x[1] + p.a * x[0] + p.b * x[1]; o[1] = 2 * x[0] * x[1] + p.c * x[0] + p.d * x[1]; } }),
    makeMap({ id: 'ikeda', label: 'Ikeda', defaults: { u: 0.918 }, init: [0.1, 0.1], spread: 0.3, bounds: { x: [-0.6, 2.1], y: [-2.6, 1] },
      iterate: (o, x, p) => { const t = 0.4 - 6.0 / (1 + x[0] * x[0] + x[1] * x[1]); o[0] = 1 + p.u * (x[0] * Math.cos(t) - x[1] * Math.sin(t)); o[1] = p.u * (x[0] * Math.sin(t) + x[1] * Math.cos(t)); } }),
    makeMap({ id: 'henon', label: 'Hénon', defaults: { a: 1.4, b: 0.3 }, init: [0.1, 0.1], spread: 0.05, bounds: { x: [-1.5, 1.5], y: [-0.45, 0.45] },
      iterate: (o, x, p) => { o[0] = 1 - p.a * x[0] * x[0] + x[1]; o[1] = p.b * x[0]; } }),
    makeMap({ id: 'lozi', label: 'Lozi', defaults: { a: 1.7, b: 0.5 }, init: [0.1, 0.1], spread: 0.05, bounds: { x: [-1.0, 1.4], y: [-0.5, 0.7] },
      iterate: (o, x, p) => { o[0] = 1 - p.a * Math.abs(x[0]) + x[1]; o[1] = p.b * x[0]; } }),
    makeMap({ id: 'bedhead', label: 'Bedhead', defaults: { a: 0.65343, b: 0.7345345 }, init: [1, 1], spread: 0.1, bounds: { x: [-1.2, 1.6], y: [-1, 2.4] },
      iterate: (o, x, p) => { o[0] = Math.sin((x[0] * x[1]) / p.b) * x[1] + Math.cos(p.a * x[0] - x[1]); o[1] = x[0] + Math.sin(x[1]) / p.b; } }),
    makeMap({ id: 'pickover', label: 'Pickover 3D', dim: 3, defaults: { a: 2.24, b: 0.43, c: -0.65, d: -2.43, e: 1 }, init: [0.1, 0.1, 0.1], spread: 0.2, bounds: { x: [-2.2, 2.2], y: [-2, 2], z: [-1, 1] },
      iterate: (o, x, p) => { o[0] = Math.sin(p.a * x[1]) - x[2] * Math.cos(p.b * x[0]); o[1] = x[2] * Math.sin(p.c * x[0]) - Math.cos(p.d * x[1]); o[2] = p.e * Math.sin(x[0]); } }),
    makeMap({ id: 'icon-sanddollar', label: 'Icon · sanddollar', defaults: { lambda: -2.34, alpha: 2.0, beta: 0.2, gamma: 0.1, omega: 0 }, init: [0.01, 0.013], spread: 0.05, pointSize: 0.007, bounds: { x: [-1.005, 1.005], y: [-1.005, 1.005] },
      iterate: (o, x, p) => { const zzbar = x[0] * x[0] + x[1] * x[1]; const a2 = x[0] * x[0] - x[1] * x[1]; const b2 = 2 * x[0] * x[1]; const zr = a2 * a2 - b2 * b2; const zi = 2 * a2 * b2; const zn = x[0] * zr - x[1] * zi; const f = p.lambda + p.alpha * zzbar + p.beta * zn; o[0] = f * x[0] + p.gamma * zr - p.omega * x[1]; o[1] = f * x[1] - p.gamma * zi + p.omega * x[0]; } }),
    makeMap({ id: 'icon-trinity', label: 'Icon · trinity', defaults: { lambda: 1.56, alpha: -1.0, beta: 0.1, gamma: -0.82, omega: 0.12 }, init: [0.01, 0.013], spread: 0.1, pointSize: 0.007, bounds: { x: [-1.35, 1.35], y: [-1.35, 1.35] },
      iterate: (o, x, p) => { const zr = x[0] * x[0] - x[1] * x[1]; const zi = 2 * x[0] * x[1]; const zzbar = x[0] * x[0] + x[1] * x[1]; const zn = x[0] * zr - x[1] * zi; const pp = p.lambda + p.alpha * zzbar + p.beta * zn; o[0] = pp * x[0] + p.gamma * zr - p.omega * x[1]; o[1] = pp * x[1] - p.gamma * zi + p.omega * x[0]; } }),
    makeMap({ id: 'icon-pentagram', label: 'Icon · Pentagram', defaults: { lambda: 2.6, alpha: -2.0, beta: 0.0, gamma: -0.5, omega: 0.0 }, init: [0.01, 0.01], spread: 0.1, pointSize: 0.007, bounds: { x: [-1.3, 1.3], y: [-1.3, 1.3] },
      iterate: (o, x, p) => { const x2 = x[0] * x[0]; const y2 = x[1] * x[1]; const zr = x2 * x2 - 6 * x2 * y2 + y2 * y2; const zi = 4 * x[0] * x[1] * (x2 - y2); const zzbar = x2 + y2; const zn = x[0] * zr - x[1] * zi; const pp = p.lambda + p.alpha * zzbar + p.beta * zn; o[0] = pp * x[0] + p.gamma * zr - p.omega * x[1]; o[1] = pp * x[1] - p.gamma * zi + p.omega * x[0]; } }),
    makeMap({ id: 'icon-hexagon', label: 'Icon · hexagon', defaults: { lambda: -2.5, alpha: 5.0, beta: -1.9, gamma: 1.0, omega: 0.188 }, init: [0.01, 0.013], spread: 0.05, pointSize: 0.007, bounds: { x: [-0.72, 0.72], y: [-0.72, 0.72] },
      iterate: (o, x, p) => { const X = x[0], Y = x[1]; const zzbar = X * X + Y * Y; const x2 = X * X - Y * Y, y2 = 2 * X * Y; const x4 = x2 * x2 - y2 * y2, y4 = 2 * x2 * y2; const zr = x4 * X - y4 * Y, zi = x4 * Y + y4 * X; const zn = X * zr - Y * zi; const pp = p.lambda + p.alpha * zzbar + p.beta * zn; o[0] = pp * X + p.gamma * zr - p.omega * Y; o[1] = pp * Y - p.gamma * zi + p.omega * X; } }),
    makeMap({ id: 'icon-heptagon', label: 'Icon · heptagon', defaults: { lambda: 2.5, alpha: -2.5, beta: 0.0, gamma: 0.9, omega: 0.0 }, init: [0.01, 0.013], spread: 0.1, pointSize: 0.007, bounds: { x: [-1.01, 1.01], y: [-1.01, 1.01] },
      iterate: (o, x, p) => {
        const X = x[0], Y = x[1];
        const zzbar = X * X + Y * Y;
        // (X + iY)^6 unrolled (degree n-1 = 6 for n = 7)
        const z2r = X * X - Y * Y, z2i = 2 * X * Y;
        const z3r = z2r * X - z2i * Y, z3i = z2r * Y + z2i * X;
        const z4r = z3r * X - z3i * Y, z4i = z3r * Y + z3i * X;
        const z5r = z4r * X - z4i * Y, z5i = z4r * Y + z4i * X;
        const zr = z5r * X - z5i * Y, zi = z5r * Y + z5i * X;
        const zn = zr * X - zi * Y; // Re((X + iY)^7)
        const pp = p.lambda + p.alpha * zzbar + p.beta * zn;
        o[0] = pp * X + p.gamma * zr - p.omega * Y;
        o[1] = pp * Y - p.gamma * zi + p.omega * X;
      } }),
    makeMap({ id: 'icon-clamshell', label: 'Icon · Clamshell', defaults: { lambda: -1.86, alpha: 2.0, beta: 0.0, gamma: 1.0, omega: 0.1 }, init: [0.01, 0.013], spread: 0.05, pointSize: 0.007, bounds: { x: [-0.9, 0.9], y: [-0.9, 0.9] },
      iterate: (o, x, p) => { const zr = x[0] * x[0] * x[0] - 3 * x[0] * x[1] * x[1]; const zi = 3 * x[0] * x[0] * x[1] - x[1] * x[1] * x[1]; const zn = x[0] * zr - x[1] * zi; const zzbar = x[0] * x[0] + x[1] * x[1]; const pp = p.lambda + p.alpha * zzbar + p.beta * zn; o[0] = pp * x[0] + p.gamma * zr - p.omega * x[1]; o[1] = pp * x[1] - p.gamma * zi + p.omega * x[0]; } }),
    makeMap({ id: 'gingerbreadman', label: 'Gingerbreadman', defaults: { s: 1 }, init: [-0.1, 0], spread: 4, bounds: { x: [-3, 8], y: [-3, 8] },
      iterate: (o, x, p) => { o[0] = 1 - x[1] + p.s * Math.abs(x[0]); o[1] = x[0]; } }),
    makeMap({ id: 'standard', label: 'Standard (Chirikov)', defaults: { K: 1.2 }, init: [Math.PI, Math.PI], spread: 6, bounds: { x: [0, 2 * Math.PI], y: [0, 2 * Math.PI] }, pointSize: 0.006,
      iterate: (o, x, p) => { const TAU = 2 * Math.PI; let np = (x[1] + p.K * Math.sin(x[0])) % TAU; if (np < 0) np += TAU; let nx = (x[0] + np) % TAU; if (nx < 0) nx += TAU; o[0] = nx; o[1] = np; } }),
    makeMap({ id: 'duffing-map', label: 'Duffing', defaults: { a: 2.75, b: 0.2 }, init: [0.1, 0.1], spread: 0.1, bounds: { x: [-1.75, 1.75], y: [-1.75, 1.75] },
      iterate: (o, x, p) => { o[0] = x[1]; o[1] = -p.b * x[0] + p.a * x[1] - x[1] * x[1] * x[1]; } }),
    makeMap({ id: 'kings-dream', label: 'King’s Dream', defaults: { a: -0.966, b: 2.879, c: 0.765, d: 0.744 }, init: [0.1, 0.1], spread: 0.1, bounds: { x: [-1.8, 1.8], y: [-1.45, 1.45] },
      iterate: (o, x, p) => { o[0] = Math.sin(p.b * x[1]) + p.c * Math.sin(p.b * x[0]); o[1] = Math.sin(p.a * x[0]) + p.d * Math.sin(p.a * x[1]); } }),
    makeMap({ id: 'sprott-quadratic', label: 'Sprott Quadratic', defaults: { a0: 1, a1: -0.8, a2: -0.7, a3: -0.1, a4: -0.7, a5: 0.1, a6: 1.1, a7: -0.3, a8: -0.5, a9: 0, a10: -0.9, a11: 0.2 }, init: [0.05, 0.05], spread: 0.05, bounds: { x: [-2.224, 1.466], y: [-1.019, 1.282] },
      iterate: (o, x, p) => { const X = x[0], Y = x[1]; o[0] = p.a0 + p.a1 * X + p.a2 * X * X + p.a3 * X * Y + p.a4 * Y + p.a5 * Y * Y; o[1] = p.a6 + p.a7 * X + p.a8 * X * X + p.a9 * X * Y + p.a10 * Y + p.a11 * Y * Y; } }),
    makeMap({ id: 'zaslavsky', label: 'Zaslavsky', defaults: { nu: 0.5, eps: 1.0, gamma: 0.8 }, init: [0.1, 0.1], spread: 0.1, bounds: { x: [0, 1], y: [-0.5, 0.5] },
      iterate: (o, x, p) => { const e = Math.exp(-p.gamma); const m = (1 - e) / p.gamma; const c = Math.cos(2 * Math.PI * x[0]); const n = x[0] + p.nu * (1 + m * x[1]) + p.eps * p.nu * m * c; o[0] = n - Math.floor(n); o[1] = e * (x[1] + p.eps * c); } }),
    makeMap({ id: 'martin', label: 'Martin (Hopalong)', defaults: { a: 4 }, init: [0, 0], spread: 0.5, bounds: { x: [-2.5, 7.5], y: [-3.5, 6.5] },
      iterate: (o, x, p) => { o[0] = x[1] - Math.sin(x[0]); o[1] = p.a - x[0]; } }),
  ].map((s) => [s.id, s]),
);

const MAXDIM = 3;
const _x = new Float64Array(MAXDIM);
const _out = new Float64Array(MAXDIM);

class IteratedMapArchetype implements Archetype {
  readonly kind = 'map' as const;
  readonly particleCount: number;
  readonly id: string;

  private readonly system: MapSystem;
  private readonly dim: number;
  private readonly state: Float64Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  constructor(system: MapSystem, config: ArchetypeConfig) {
    this.system = system;
    this.id = system.id;
    this.dim = system.dim;
    this.particleCount = config.particleCount;
    const n = this.particleCount;
    this.state = new Float64Array(n * this.dim);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);

    const rng = mulberry32(config.seed);
    for (let i = 0; i < n; i++) {
      const off = i * this.dim;
      for (let k = 0; k < this.dim; k++) this.state[off + k] = system.init[k] + (rng() - 0.5) * system.spread;
    }
    spectralGradient(n, this.colors);
    this.syncPositions();
  }

  step(_dt: number, p: ResolvedParams): void {
    const { state, dim, system } = this;
    const n = this.particleCount;
    for (let i = 0; i < n; i++) {
      const off = i * dim;
      for (let k = 0; k < dim; k++) _x[k] = state[off + k];
      system.iterate(_out, _x, p);
      for (let k = 0; k < dim; k++) state[off + k] = _out[k];
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const { state, positions, dim, system } = this;
    const [cx, cy, cz] = system.center;
    const s = system.scale;
    const depth = system.depth ?? 0;
    const radialDepth = system.radialDepth ?? 0;
    const n = this.particleCount;
    for (let i = 0; i < n; i++) {
      const so = i * dim;
      const po = i * 3;
      // Escapers (some maps have bounded basins) get reseeded to keep the cloud alive.
      if (!Number.isFinite(state[so]) || !Number.isFinite(state[so + 1])) {
        for (let k = 0; k < dim; k++) state[so + k] = system.init[k];
      }
      const X = (state[so] - cx) * s;
      const Y = (state[so + 1] - cy) * s;
      positions[po] = X;
      positions[po + 1] = Y;
      // dim-3 maps use their own z; attractor-image maps drape over an eggcrate; icons get a RADIAL relief
      // (z=f(R) only ⇒ N-fold symmetry preserved); canonical phase portraits stay flat. Face-on X-Y is unchanged.
      let z = 0;
      if (dim > 2) z = (state[so + 2] - cz) * s;
      else if (depth) z = depth * Math.sin(DEPTH_FREQ * X) * Math.sin(DEPTH_FREQ * Y);
      else if (radialDepth) { const R = Math.hypot(X, Y); z = radialDepth * Math.cos(RADIAL_FREQ * R) * Math.max(0, 1 - 0.45 * R); }
      positions[po + 2] = z;
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }

  readColors(): Float32Array {
    return this.colors;
  }

  readState(): Float64Array {
    return this.state;
  }

  loadState(s: Float64Array): void {
    this.state.set(s.subarray(0, this.state.length));
    this.syncPositions();
  }

  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: this.system.label, stateOffset: 0, stateLength: this.state.length, params: { ...this.system.defaults } }];
  }

  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: this.system.pointSize };
  }

  dispose(): void {
    /* buffers GC with the instance */
  }
}

export function makeMapFactory(system: MapSystem): ArchetypeFactory {
  return {
    id: system.id,
    label: system.label,
    category: 'Map',
    kind: 'map',
    params: system.paramSpec,
    defaultParticleCount: 100_000,
    defaultDt: system.dt,
    create: (config) => new IteratedMapArchetype(system, config),
  };
}

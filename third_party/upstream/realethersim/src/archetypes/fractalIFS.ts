import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';
import { mulberry32, type Rng } from '../state/rng';

// Iterated Function Systems via the "chaos game": each point repeatedly picks one of a few affine
// contractions (weighted by probability) and applies it — x' = a·x + b·y + e, y' = c·x + d·y + f.
// After a short warm-up the cloud condenses onto the IFS attractor (Barnsley fern, Sierpinski,
// dragon, carpet). Points are coloured by which map last moved them, so the self-similar copies show
// up in different hues. No dt — the accumulator just paces how often the game iterates.
export interface IfsMap {
  a: number; b: number; c: number; d: number; e: number; f: number; p: number; // p = selection weight
}
interface IfsSpec {
  id: string;
  label: string;
  maps: IfsMap[];
  bounds: { x: [number, number]; y: [number, number] };
  hue: number; // base hue for the per-map palette
  pointSize?: number;
}

const mid = (r: [number, number]): number => (r[0] + r[1]) / 2;

export interface IfsSystem extends IfsSpec {
  cum: number[]; // cumulative normalized probabilities
  scale: number;
  center: [number, number];
}

function makeIfs(o: IfsSpec): IfsSystem {
  const total = o.maps.reduce((s, m) => s + m.p, 0);
  const cum: number[] = [];
  let acc = 0;
  for (const m of o.maps) {
    acc += m.p / total;
    cum.push(acc);
  }
  cum[cum.length - 1] = 1.0001; // guard the top bin against fp drift
  const range = Math.max(o.bounds.x[1] - o.bounds.x[0], o.bounds.y[1] - o.bounds.y[0]);
  return { ...o, cum, scale: 3 / range, center: [mid(o.bounds.x), mid(o.bounds.y)] };
}

export const IFS_SYSTEMS: Record<string, IfsSystem> = Object.fromEntries(
  [
    makeIfs({
      id: 'barnsley-fern', label: 'Barnsley Fern', hue: 0.34, bounds: { x: [-2.8, 2.8], y: [0, 10] },
      maps: [
        { a: 0, b: 0, c: 0, d: 0.16, e: 0, f: 0, p: 0.01 },
        { a: 0.85, b: 0.04, c: -0.04, d: 0.85, e: 0, f: 1.6, p: 0.85 },
        { a: 0.2, b: -0.26, c: 0.23, d: 0.22, e: 0, f: 1.6, p: 0.07 },
        { a: -0.15, b: 0.28, c: 0.26, d: 0.24, e: 0, f: 0.44, p: 0.07 },
      ],
    }),
    makeIfs({
      id: 'sierpinski', label: 'Sierpiński Triangle', hue: 0.02, bounds: { x: [0, 1], y: [0, 0.866] },
      maps: [
        { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0, p: 1 },
        { a: 0.5, b: 0, c: 0, d: 0.5, e: 0.5, f: 0, p: 1 },
        { a: 0.5, b: 0, c: 0, d: 0.5, e: 0.25, f: 0.433, p: 1 },
      ],
    }),
    makeIfs({
      id: 'dragon', label: 'Heighway Dragon', hue: 0.55, bounds: { x: [-0.45, 1.2], y: [-0.7, 0.7] },
      maps: [
        { a: 0.5, b: -0.5, c: 0.5, d: 0.5, e: 0, f: 0, p: 1 },
        { a: -0.5, b: -0.5, c: 0.5, d: -0.5, e: 1, f: 0, p: 1 },
      ],
    }),
    makeIfs({
      id: 'sierpinski-carpet', label: 'Sierpiński Carpet', hue: 0.62, bounds: { x: [0, 1], y: [0, 1] },
      maps: [0, 1, 2].flatMap((j) => [0, 1, 2].filter((i) => !(i === 1 && j === 1)).map((i) => ({
        a: 1 / 3, b: 0, c: 0, d: 1 / 3, e: i / 3, f: j / 3, p: 1,
      }))),
    }),
  ].map((s) => [s.id, s]),
);

// IFS exposes a single tunable: "warp" lightly perturbs every map's rotation so the user can morph
// the attractor (0 = the canonical fractal).
const PARAM_SPEC: ParamSpec[] = [{ key: 'warp', label: 'warp', min: -0.3, max: 0.3, step: 0.005, default: 0 }];

class FractalIfsArchetype implements Archetype {
  readonly kind = 'map' as const;
  readonly particleCount: number;
  readonly id: string;

  private readonly system: IfsSystem;
  private readonly state: Float64Array; // x, y
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly rng: Rng;

  constructor(system: IfsSystem, config: ArchetypeConfig) {
    this.system = system;
    this.id = system.id;
    this.particleCount = config.particleCount;
    const n = this.particleCount;
    this.state = new Float64Array(n * 2);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.rng = mulberry32(config.seed);

    // Colours are uploaded once (the render pipeline reads them at build time), so colour by particle
    // index with a hue gradient around the system's base hue — a coherent, visible palette. (The GPU
    // path colours dynamically by the last-applied map.)
    for (let i = 0; i < n; i++) {
      this.state[i * 2] = (this.rng() - 0.5) * 0.1;
      this.state[i * 2 + 1] = (this.rng() - 0.5) * 0.1 + mid(system.bounds.y);
      hslToRgb((system.hue + 0.16 * (i / n)) % 1, 0.72, 0.6, this.colors, i * 3);
    }
    this.syncPositions();
  }

  step(_dt: number, p: ResolvedParams): void {
    const n = this.particleCount;
    const st = this.state;
    const { maps, cum } = this.system;
    const K = maps.length;
    const rng = this.rng;
    const warp = p.warp ?? 0;

    for (let i = 0; i < n; i++) {
      const r = rng();
      let mi = 0;
      while (mi < K - 1 && r > cum[mi]) mi++;
      const m = maps[mi];
      const o = i * 2;
      const x = st[o];
      const y = st[o + 1];
      // warp = a small shear added off-diagonal, morphing the attractor continuously.
      st[o] = m.a * x + (m.b + warp) * y + m.e;
      st[o + 1] = (m.c - warp) * x + m.d * y + m.f;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const n = this.particleCount;
    const st = this.state;
    const pos = this.positions;
    const [cx, cy] = this.system.center;
    const s = this.system.scale;
    for (let i = 0; i < n; i++) {
      const o = i * 2;
      const po = i * 3;
      if (!Number.isFinite(st[o]) || !Number.isFinite(st[o + 1])) {
        st[o] = 0;
        st[o + 1] = cy;
      }
      pos[po] = (st[o] - cx) * s;
      pos[po + 1] = (st[o + 1] - cy) * s;
      pos[po + 2] = 0;
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
    return [{ id: 'root', parentId: null, label: `${this.system.label} (${this.system.maps.length} maps)`, stateOffset: 0, stateLength: this.state.length }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: this.system.pointSize ?? 0.008 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export function makeIfsFactory(system: IfsSystem): ArchetypeFactory {
  return {
    id: system.id,
    label: system.label,
    category: 'Fractal',
    kind: 'map',
    params: PARAM_SPEC,
    defaultParticleCount: 100_000,
    particleCountOptions: [50_000, 100_000, 250_000],
    defaultDt: 0.004,
    create: (config) => new FractalIfsArchetype(system, config),
  };
}

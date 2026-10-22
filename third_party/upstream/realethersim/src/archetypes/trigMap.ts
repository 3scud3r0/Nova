import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Trigonometric Map. A two-line iterated map on the plane —
//   x' = sin(x² − y² + a),  y' = cos(2xy + b)
// — whose arguments x²−y² and 2xy are exactly the real and imaginary parts of z², so this is a
// complex quadratic folded through sine and cosine. Because sin and cos are bounded, every orbit
// stays trapped in the unit square, and the population settles onto an invariant density: a lacy
// attractor whose shape is set entirely by the two phases a and b. Drift a and b and the attractor
// blooms, splits and reforms through an endless family of shapes. (After Simone Conradi's
// numpy/matplotlib density studies.) Colours bake once; the whole attractor lives in positions.
// Bounded.
const TAU = Math.PI * 2;

class TrigMapArchetype implements Archetype {
  readonly id = 'trigMap';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly xs: Float64Array; // live orbit state
  private readonly ys: Float64Array;
  private a0 = 0.54;
  private b0 = 1.06;
  private morph = 1;
  private zoom = 1;
  private cx = 0;
  private cy = 0;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(1024, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.xs = new Float64Array(N);
    this.ys = new Float64Array(N);
    const rng = mulberry32((config.seed ^ 0x27d4eb2f) >>> 0);
    this.readParams(config.params);
    const a = this.a0, b = this.b0;
    for (let i = 0; i < N; i++) {
      let x = rng() * 2 - 1, y = rng() * 2 - 1;
      // burn in so every point starts ON the attractor (no transient haze on arrival)
      for (let k = 0; k < 60; k++) {
        const nx = Math.sin(x * x - y * y + a);
        const ny = Math.cos(2 * x * y + b);
        x = nx; y = ny;
      }
      this.xs[i] = x; this.ys[i] = y;
      this.cx += x; this.cy += y;
      // colour baked by the seed's angle — a hue wheel that mixes as orbits fold together
      const hue = Math.atan2(y, x) / TAU + 0.5;
      const o = i * 3;
      const c = hueToRgb(hue);
      const bri = 0.75 + 0.4 * rng();
      this.colors[o] = c[0] * bri; this.colors[o + 1] = c[1] * bri; this.colors[o + 2] = c[2] * bri;
    }
    this.cx /= N; this.cy /= N; // recentre the attractor in the frame
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.a0 = p.phaseA ?? 0.54;
    this.b0 = p.phaseB ?? 1.06;
    this.morph = p.morph ?? 1;
    this.zoom = p.zoom ?? 1;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    const s = 1.05 * this.zoom;
    // recentre on the live centroid so drift never pushes the attractor out of frame
    let mx = 0, my = 0;
    for (let i = 0; i < N; i++) { mx += this.xs[i]; my += this.ys[i]; }
    mx /= N; my /= N;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      pos[o] = (this.xs[i] - mx) * s;
      pos[o + 1] = (this.ys[i] - my) * s;
      pos[o + 2] = 0;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt;
    // the two phases drift slowly, so the attractor continuously morphs
    const a = this.a0 + 0.08 * Math.sin(0.05 * this.t * this.morph);
    const b = this.b0 + 0.08 * Math.cos(0.041 * this.t * this.morph);
    const xs = this.xs, ys = this.ys;
    for (let i = 0; i < this.particleCount; i++) {
      const x = xs[i], y = ys[i];
      xs[i] = Math.sin(x * x - y * y + a);
      ys[i] = Math.cos(2 * x * y + b);
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const s = new Float64Array(1 + this.particleCount * 2);
    s[0] = this.t;
    s.set(this.xs, 1);
    s.set(this.ys, 1 + this.particleCount);
    return s;
  }
  loadState(s: Float64Array): void {
    this.t = s[0] ?? 0;
    const N = this.particleCount;
    if (s.length >= 1 + N * 2) { this.xs.set(s.subarray(1, 1 + N)); this.ys.set(s.subarray(1 + N, 1 + 2 * N)); }
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'trigonometric map attractor', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.0065 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

// compact HSV(h,1,1)→RGB for the baked hue wheel
function hueToRgb(h: number): [number, number, number] {
  const x = ((h % 1) + 1) % 1;
  const r = Math.abs(x * 6 - 3) - 1;
  const g = 2 - Math.abs(x * 6 - 2);
  const b = 2 - Math.abs(x * 6 - 4);
  return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))];
}

export const trigMapFactory: ArchetypeFactory = {
  id: 'trigMap',
  label: 'Trigonometric Map',
  category: 'Map',
  kind: 'flow',
  params: [
    { key: 'phaseA', label: 'phase a', min: -3.14, max: 3.14, step: 0.02, default: 0.54 },
    { key: 'phaseB', label: 'phase b', min: -3.14, max: 3.14, step: 0.02, default: 1.06 },
    { key: 'morph', label: 'morph rate', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'zoom', label: 'zoom', min: 0.6, max: 1.6, step: 0.02, default: 1 },
  ],
  defaultParticleCount: 150_000,
  particleCountOptions: [80_000, 150_000, 260_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the attractor is a density, not a trajectory
  bloom: 0.35,
  create: (config) => new TrigMapArchetype(config),
};

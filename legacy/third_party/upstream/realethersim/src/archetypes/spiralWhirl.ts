import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';

// Spiral Whirl. A faithful port of a "tsubuyaki Processing" one-liner by KAZ+OO (@KAZOOOps): four
// thousand points, each riding a nested spiral. The index i sets a sawtooth radius r = i mod 200
// plus a slow breathing wobble 99·sin(i²+t), an angle a = i + t winds it round, and a second offset
// 80·(sin(i+t), cos(3i+t)) swirls the whole bloom — pure closed form, no state. It reads as a lace of
// interleaved spiral arcs that turn and pulse. Sampled densely along the same index range (the radial
// wobble bucketed per integer index so each arc stays crisp); the white-to-pink colour bakes once. Bounded.
const S = 1 / 175; // p5 pixels → render units
const IMAX = 4000; // index range of the original sketch

class SpiralWhirlArchetype implements Archetype {
  readonly id = 'spiralWhirl';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly iv: Float64Array; // per-point index i (fractional, dense sampling)
  private speed = 1;
  private swirl = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(1024, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.iv = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const i = (k / N) * IMAX;
      this.iv[k] = i;
      // white → pink by index, like the original stroke(255, 220+35·sin(i), 255)
      const g = 0.86 + 0.14 * Math.sin(i);
      const o = k * 3;
      this.colors[o] = 1.0; this.colors[o + 1] = g; this.colors[o + 2] = 1.0;
    }
    this.readParams(config.params);
    this.t = 3.3; // arrive at an asymmetric, swirling phase
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.speed = p.speed ?? 1;
    this.swirl = p.swirl ?? 1;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const t = this.t;
    const off = 80 * this.swirl;
    for (let k = 0; k < this.particleCount; k++) {
      const i = this.iv[k];
      const ii = Math.floor(i); // integer bucket: the radial-noise term is constant along each arc
      const a = i + t;
      const r = (i % 200) + 99 * Math.sin(ii * ii + t);
      const x = r * Math.sin(a) + off * Math.sin(i + t);
      const y = r * Math.cos(a) + off * Math.cos(i * 3 + t);
      const o = k * 3;
      pos[o] = x * S;
      pos[o + 1] = y * S;
      pos[o + 2] = 0;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt * this.speed;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'nested spiral whirl', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.006 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const spiralWhirlFactory: ArchetypeFactory = {
  id: 'spiralWhirl',
  label: 'Spiral Whirl',
  category: 'Parametric',
  kind: 'flow',
  params: [
    { key: 'speed', label: 'wind speed', min: 0.1, max: 2.5, step: 0.05, default: 1 },
    { key: 'swirl', label: 'swirl offset', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 90_000,
  particleCountOptions: [40_000, 90_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.6,
  create: (config) => new SpiralWhirlArchetype(config),
};

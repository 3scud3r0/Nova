import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { getCustomExpr } from '../core/customExpr';
import type { CompiledFn } from '../core/expr';

// Custom (parametric) — a user-authored system. Every point n is placed by evaluating three
// expressions the user types live: x, y, z as functions of the point index i, the time t, the count n,
// and the knobs a…h. The expressions are compiled by the safe whitelist parser (src/core/expr.ts), so
// nothing but maths ever runs. This archetype just reads the current compiled functions from the shared
// live state each frame (re-syncing when the editor bumps the version) and fills the point cloud —
// guarding NaN/∞ and clamping to the render box so a wild formula can't blow up the view. Runs on the
// main thread (the compiled closures can't be shipped to the sim worker). Colours bake as a smooth
// spectrum along i so structure reads. Bounded.
const SCALE = 2.0; // expressions are typically O(1); scale into a comfortable view
const CLAMP = 14; // hard bound so a divergent formula stays in the render box (< 50)
const KNOBS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

class CustomParametricArchetype implements Archetype {
  readonly id = 'customParametric';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly P: Record<string, number> = {}; // knob values passed to the compiled expressions
  private speed = 1;
  private t = 0;
  private version = -1;
  private fnX: CompiledFn = () => 0; private fnY: CompiledFn = () => 0; private fnZ: CompiledFn = () => 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(256, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    // bake a smooth spectrum along the index (IQ cosine palette) so the traced structure reads
    for (let i = 0; i < N; i++) {
      const u = i / N, o = i * 3;
      this.colors[o] = 0.55 + 0.45 * Math.cos(6.2831853 * (u + 0.0));
      this.colors[o + 1] = 0.55 + 0.45 * Math.cos(6.2831853 * (u + 0.33));
      this.colors[o + 2] = 0.55 + 0.45 * Math.cos(6.2831853 * (u + 0.66));
    }
    this.readParams(config.params);
    this.pullExpr();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    for (const k of KNOBS) this.P[k] = p[k] ?? 0;
    this.speed = p.speed ?? 1;
  }

  // adopt the latest compiled expressions when the editor has changed them
  private pullExpr(): void {
    const s = getCustomExpr();
    if (s.version === this.version) return;
    this.version = s.version;
    this.fnX = s.fn.x; this.fnY = s.fn.y; this.fnZ = s.fn.z;
  }

  // NaN/∞ → 0, then scale, then clamp into the render box so a divergent formula can't blow up the view
  private guard(v: number): number {
    if (!Number.isFinite(v)) return 0;
    const s = v * SCALE;
    return s < -CLAMP ? -CLAMP : s > CLAMP ? CLAMP : s;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount, t = this.t, P = this.P;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      pos[o] = this.guard(this.fnX(i, t, N, P));
      pos[o + 1] = this.guard(this.fnY(i, t, N, P));
      pos[o + 2] = this.guard(this.fnZ(i, t, N, P));
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.pullExpr();
    this.t += dt * this.speed;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'your equation', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.006 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const customParametricFactory: ArchetypeFactory = {
  id: 'customParametric',
  label: 'Custom Equation',
  category: 'Custom',
  kind: 'flow',
  mainThread: true, // compiled expression closures live on the main thread, not the sim worker
  params: [
    { key: 'a', label: 'a', min: -8, max: 8, step: 0.05, default: 3 },
    { key: 'b', label: 'b', min: -8, max: 8, step: 0.05, default: 2 },
    { key: 'c', label: 'c', min: -8, max: 8, step: 0.05, default: 5 },
    { key: 'd', label: 'd', min: -8, max: 8, step: 0.05, default: 1 },
    { key: 'e', label: 'e', min: -8, max: 8, step: 0.05, default: 1 },
    { key: 'f', label: 'f', min: -8, max: 8, step: 0.05, default: 1 },
    { key: 'g', label: 'g', min: -8, max: 8, step: 0.05, default: 1 },
    { key: 'h', label: 'h', min: -8, max: 8, step: 0.05, default: 1 },
    { key: 'speed', label: 'time rate', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 80_000,
  particleCountOptions: [40_000, 80_000, 150_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.4,
  create: (config) => new CustomParametricArchetype(config),
};

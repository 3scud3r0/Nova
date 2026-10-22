import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Logistic Bifurcation Diagram — the fig-tree of chaos. The whole catalog is full of strange
// ATTRACTORS (the endpoints of a flow) but never a control-parameter sweep: this is that missing
// genre. The map xₙ₊₁ = r·xₙ·(1−xₙ) has, for each growth rate r, a long-run attractor — a single
// fixed point, then (as r passes 3) a 2-cycle, then 4, 8, 16… doubling faster and faster until at
// r≈3.5699 (the Feigenbaum point) it dissolves into chaos, shot through with sudden PERIODIC WINDOWS
// (the wide period-3 band at r≈3.83). Each point owns a fixed r and keeps iterating the map, so it
// hops around its own attractor forever — the diagram shimmers as it is continuously resampled.
// Colour is baked by the Lyapunov exponent λ = ⟨ln|r(1−2x)|⟩: cool where the orbit is stable
// (λ<0, the windows), hot where it is chaotic (λ>0). Bounded; x∈[0,1] always. (Feigenbaum, 1978.)
const R_MIN = 2.5, R_MAX = 4.0;

class BifurcationArchetype implements Archetype {
  readonly id = 'bifurcation';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly r: Float64Array; // each point's fixed growth rate
  private readonly x: Float64Array; // its current orbit value (iterated live)
  private rate = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(2048, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.r = new Float64Array(N);
    this.x = new Float64Array(N);
    const rng = mulberry32((config.seed ^ 0x2545f491) >>> 0);
    this.readParams(config.params);
    for (let i = 0; i < N; i++) {
      const r = R_MIN + rng() * (R_MAX - R_MIN);
      let x = 0.2 + rng() * 0.6;
      for (let k = 0; k < 180; k++) x = r * x * (1 - x); // burn off the transient onto the attractor
      // measure the Lyapunov exponent over a stretch of the settled orbit
      let lyap = 0;
      for (let k = 0; k < 80; k++) {
        lyap += Math.log(Math.abs(r * (1 - 2 * x)) + 1e-12);
        x = r * x * (1 - x);
      }
      lyap /= 80;
      this.r[i] = r; this.x[i] = x;
      // cool teal for stable orbits (λ<0), hot amber→white for chaos (λ>0)
      const chaos = Math.max(0, Math.min(1, (lyap + 0.15) / 0.85));
      const o = i * 3;
      const b = 0.6 + 0.5 * rng();
      this.colors[o] = (0.12 + 0.88 * chaos) * b;
      this.colors[o + 1] = (0.55 + 0.2 * chaos) * b;
      this.colors[o + 2] = (0.95 - 0.7 * chaos) * b;
    }
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.rate = p.rate ?? 1;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      // r → horizontal, x → vertical (the classic diagram orientation)
      pos[o] = ((this.r[i] - R_MIN) / (R_MAX - R_MIN) - 0.5) * 3.2;
      pos[o + 1] = (this.x[i] - 0.5) * 2.3;
      pos[o + 2] = 0;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt * this.rate;
    // iterate each orbit a few steps per frame — points hop across their attractor → the diagram
    // shimmers (chaotic columns fill their band; period-n windows blink between n discrete values)
    const iters = 1 + Math.floor(this.rate * 2);
    for (let s = 0; s < iters; s++) {
      for (let i = 0; i < this.particleCount; i++) {
        const r = this.r[i];
        this.x[i] = r * this.x[i] * (1 - this.x[i]);
      }
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'logistic map — period-doubling to chaos', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const bifurcationFactory: ArchetypeFactory = {
  id: 'bifurcation',
  label: 'Bifurcation Diagram',
  category: 'Map',
  kind: 'flow',
  params: [
    { key: 'rate', label: 'iteration speed', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 200_000,
  particleCountOptions: [120_000, 200_000, 320_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.35,
  create: (config) => new BifurcationArchetype(config),
};

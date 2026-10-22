import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Gray-Scott reaction-diffusion on a toroidal W×W grid — the canonical Turing system. Two chemicals
// U and V diffuse at different rates while V autocatalyses (U + 2V → 3V) and decays; U is replenished
// at "feed" rate f and V removed at "kill" rate k. The f/k plane (Pearson's classification) sweeps
// the whole zoo of Turing patterns: spots, stripes, coral, mitosis, worms, mazes. Bounded by the
// feed/kill balance (concentrations stay in ~[0,1]), so it can't blow up. Rendered as a displaced
// point grid: V drives the relief height (and, on GPU, the colour).
const PARAM_SPEC: ParamSpec[] = [
  { key: 'feed', label: 'feed f', min: 0.01, max: 0.09, step: 0.0005, default: 0.0367 },
  { key: 'kill', label: 'kill k', min: 0.045, max: 0.07, step: 0.0002, default: 0.0649 },
  { key: 'diffU', label: 'D_u', min: 0.08, max: 0.26, step: 0.005, default: 0.16 },
  { key: 'diffV', label: 'D_v', min: 0.04, max: 0.13, step: 0.005, default: 0.08 },
  { key: 'relief', label: 'relief', min: 0, max: 4, step: 0.05, default: 2.2 },
];

const EXTENT = 3;
const ITERS = 4; // reaction-diffusion sub-iterations per step() — speeds pattern formation

class GrayScottFieldArchetype implements Archetype {
  readonly id = 'grayScottField';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly W: number;
  private u: Float64Array;
  private v: Float64Array;
  private uNext: Float64Array;
  private vNext: Float64Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private relief = 2.2;

  constructor(config: ArchetypeConfig) {
    const w = Math.max(32, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    const n = this.particleCount;
    this.u = new Float64Array(n);
    this.v = new Float64Array(n);
    this.uNext = new Float64Array(n);
    this.vNext = new Float64Array(n);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.seedField(config.seed);
    this.syncPositions();
  }

  // U = 1 everywhere; scatter a few V blobs to nucleate the pattern.
  private seedField(seed: number): void {
    const rng = mulberry32(seed);
    const w = this.W;
    this.u.fill(1);
    this.v.fill(0);
    const blobs = 18;
    for (let b = 0; b < blobs; b++) {
      const cx = Math.floor(rng() * w);
      const cy = Math.floor(rng() * w);
      const r = 2 + Math.floor(rng() * 4);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const i = ((cy + dy + w) % w) * w + ((cx + dx + w) % w);
          this.u[i] = 0.5;
          this.v[i] = 0.25;
        }
      }
    }
  }

  step(_dt: number, p: ResolvedParams): void {
    const w = this.W;
    const Du = p.diffU ?? 0.16;
    const Dv = p.diffV ?? 0.08;
    const f = p.feed ?? 0.0367;
    const k = p.kill ?? 0.0649;
    this.relief = p.relief ?? 2.2;

    for (let it = 0; it < ITERS; it++) {
      const u = this.u;
      const v = this.v;
      const un = this.uNext;
      const vn = this.vNext;
      for (let y = 0; y < w; y++) {
        const yu = ((y - 1 + w) % w) * w;
        const yd = ((y + 1) % w) * w;
        const yc = y * w;
        for (let x = 0; x < w; x++) {
          const xl = (x - 1 + w) % w;
          const xr = (x + 1) % w;
          const c = yc + x;
          const uc = u[c];
          const vc = v[c];
          // 9-point Laplacian (orthogonal 0.2, diagonal 0.05, centre −1)
          const lapU =
            0.2 * (u[yc + xl] + u[yc + xr] + u[yu + x] + u[yd + x]) +
            0.05 * (u[yu + xl] + u[yu + xr] + u[yd + xl] + u[yd + xr]) -
            uc;
          const lapV =
            0.2 * (v[yc + xl] + v[yc + xr] + v[yu + x] + v[yd + x]) +
            0.05 * (v[yu + xl] + v[yu + xr] + v[yd + xl] + v[yd + xr]) -
            vc;
          const uvv = uc * vc * vc;
          un[c] = uc + (Du * lapU - uvv + f * (1 - uc));
          vn[c] = vc + (Dv * lapV + uvv - (f + k) * vc);
        }
      }
      this.u = un;
      this.v = vn;
      this.uNext = u;
      this.vNext = v;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const w = this.W;
    const v = this.v;
    const pos = this.positions;
    const col = this.colors;
    const cell = EXTENT / (w - 1);
    const half = EXTENT / 2;
    const relief = this.relief;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = i * 3;
        const vv = v[i];
        pos[o] = x * cell - half;
        pos[o + 1] = vv * relief - 0.4; // V drives the relief height
        pos[o + 2] = y * cell - half;
        // teal → white by V (the pattern)
        const t = Math.min(1, vv * 2.2);
        col[o] = 0.04 + 0.96 * t;
        col[o + 1] = 0.55 + 0.45 * t;
        col[o + 2] = 0.55 + 0.45 * t;
      }
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    const n = this.particleCount;
    const out = new Float64Array(n * 2);
    out.set(this.u, 0);
    out.set(this.v, n);
    return out;
  }
  loadState(s: Float64Array): void {
    const n = this.particleCount;
    this.u.set(s.subarray(0, n));
    this.v.set(s.subarray(n, n * 2));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Gray-Scott ${this.W}²`, stateOffset: 0, stateLength: this.particleCount * 2 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', exposesField: true, pointSize: 0.02 };
  }
  readField(): { texture: unknown; width: number; height: number } {
    return { texture: this.v, width: this.W, height: this.W };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const grayScottFieldFactory: ArchetypeFactory = {
  id: 'grayScottField',
  label: 'Gray-Scott (Turing)',
  category: 'Field',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 40_000,
  particleCountOptions: [16_384, 40_000, 65_536],
  defaultDt: 0.02,
  create: (config) => new GrayScottFieldArchetype(config),
};

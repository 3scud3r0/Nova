import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Law of the Iterated Logarithm. A centered random walk Sₙ = X₁ + … + Xₙ (mean 0, variance 1)
// spreads, on average, like √n — that is the Central Limit Theorem. But how far does it EVER wander?
// Khinchin's law of the iterated logarithm answers with a sharper, almost-sure envelope: the walk's
// running record is bounded by ±√(2n log log n), which it kisses infinitely often yet never
// permanently breaks through —
//   limsup Sₙ / √(2n log log n) = +1,   liminf Sₙ / √(2n log log n) = −1.
// Here an ensemble of walks fans out from the origin; the Gaussian bulk fills the middle (√n), and
// the two bright LIL walls open above and below (√(2n log log n)). The rare paths that reach the wall
// flare orange — the record-setters. A sweeping front traces the walks out in n. Colours bake once;
// the increments are baked, so the whole ensemble is deterministic. Bounded.
const NMAX = 4200; // steps per walk
const N0 = 8; // first step with a defined log log
const YS = 0.0102; // Sₙ → render units
const W = 3.0; // horizontal span (the n-axis)

class IteratedLogArchetype implements Archetype {
  readonly id = 'iteratedLog';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly role: Uint8Array; // 0 walk, 1 LIL envelope, 2 front bar, 3 CLT ref
  private readonly pn: Float64Array; // step index n (walk / envelope / ref)
  private readonly py: Float64Array; // baked render y
  private walks = 1;
  private sweep = 1;
  private diffuse = 1;
  private t = 0;
  private buildKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(2048, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.role = new Uint8Array(N);
    this.pn = new Float64Array(N);
    this.py = new Float64Array(N);
    this.seed = config.seed;
    this.t = 5.5; // land the thumbnail on the fully-swept fan
    this.rebuild(config.params);
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round(p.walks ?? 1)},${Math.round((p.diffuse ?? 1) * 100)}`;
  }

  // the LIL wall ±√(2n log log n)
  private static env(n: number): number {
    const nn = Math.max(N0, n);
    const ll = Math.log(Math.log(nn));
    return Math.sqrt(2 * nn * Math.max(0.05, ll));
  }

  private rebuild(p: ResolvedParams): void {
    this.walks = Math.max(1, Math.round(p.walks ?? 1));
    this.diffuse = p.diffuse ?? 1;
    this.sweep = p.speed ?? 1;
    this.buildKey = this.keyOf(p);
    const N = this.particleCount;
    const col = this.colors;
    const rng = mulberry32((this.seed ^ 0x3b9a73c9) >>> 0);
    const nEnv = Math.floor(N * 0.07); // the two LIL walls
    const nRef = Math.floor(N * 0.03); // faint ±√n CLT reference
    const nFront = Math.floor(N * 0.015); // the sweeping "now" bar
    const nWalkPts = N - nEnv - nRef - nFront;
    const K = Math.max(24, Math.round(this.walks * 260)); // ensemble size scales with the param
    const perWalk = Math.max(2, Math.floor(nWalkPts / K));
    let idx = 0;
    const put = (role: number, n: number, y: number, r: number, g: number, b: number): void => {
      if (idx >= N) return;
      this.role[idx] = role; this.pn[idx] = n; this.py[idx] = y;
      col[idx * 3] = r; col[idx * 3 + 1] = g; col[idx * 3 + 2] = b;
      idx++;
    };
    // ── the walk ensemble ──
    const sigma = Math.sqrt(this.diffuse); // step std (variance = diffuse)
    for (let k = 0; k < K && idx + perWalk <= N - nEnv - nRef - nFront; k++) {
      const wr = mulberry32((this.seed ^ (0x9e3779b9 + k * 2654435761)) >>> 0);
      const stride = NMAX / perWalk;
      let s = 0; let prevN = wr() * stride; let sample = 0;
      for (let n = 1; n <= NMAX; n++) {
        // Gaussian increment (Box–Muller-lite via two uniforms averaged toward normal)
        const u1 = Math.max(1e-9, wr()), u2 = wr();
        s += sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(6.283185 * u2);
        if (n >= prevN + stride || n === NMAX) {
          prevN = n; sample++;
          const y = s * YS;
          const wall = IteratedLogArchetype.env(n) * YS;
          const touch = Math.abs(y) > wall * 0.82; // record-setters near the wall flare orange
          const bri = 0.5 + 0.4 * wr();
          if (touch) put(0, n, y, 1.0 * bri, 0.62 * bri, 0.18 * bri);
          else put(0, n, y, 0.28 * bri, 0.6 * bri, 1.0 * bri); // stochastic blue
          if (sample >= perWalk) break;
        }
      }
    }
    // ── LIL walls: ±√(2n log log n) ──
    const half = Math.floor(nEnv / 2);
    for (let j = 0; j < nEnv; j++) {
      const n = N0 + (NMAX - N0) * (j % half) / Math.max(1, half - 1);
      const sgn = j < half ? 1 : -1;
      const y = sgn * IteratedLogArchetype.env(n) * YS;
      const b = 0.9 + 0.4 * rng();
      put(1, n, y, b, b, b); // white wall
    }
    // ── faint ±√n Central-Limit reference ──
    const hr = Math.floor(nRef / 2);
    for (let j = 0; j < nRef; j++) {
      const n = N0 + (NMAX - N0) * (j % hr) / Math.max(1, hr - 1);
      const sgn = j < hr ? 1 : -1;
      const y = sgn * Math.sqrt(n) * this.diffuse * YS;
      put(3, n, y, 0.12, 0.28, 0.4); // dim blue reference
    }
    // ── the sweeping front bar ──
    for (let j = 0; j < nFront; j++) {
      put(2, 0, (rng() * 2 - 1) * 1.35, 0.6, 0.95, 1.0);
    }
    while (idx < N) put(0, 0, 0, 0, 0, 0);
    this.syncPositions();
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    const frontN = ((this.t * this.sweep * 520) % (NMAX * 1.25)); // sweeps past NMAX, then holds dark briefly
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const role = this.role[i];
      if (role === 2) {
        // front bar rides the current n
        const fn = Math.min(NMAX, frontN);
        pos[o] = (fn / NMAX) * W - W / 2;
        pos[o + 1] = this.py[i];
        pos[o + 2] = 0;
        continue;
      }
      const n = this.pn[i];
      if (n > frontN) { pos[o] = 0; pos[o + 1] = -40; pos[o + 2] = 0; continue; } // not yet traced
      pos[o] = (n / NMAX) * W - W / 2;
      pos[o + 1] = this.py[i];
      pos[o + 2] = 0;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const key = this.keyOf(p);
    if (key !== this.buildKey) { this.rebuild(p); return; }
    this.sweep = p.speed ?? 1;
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'random-walk ensemble + LIL wall', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.006 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const iteratedLogFactory: ArchetypeFactory = {
  id: 'iteratedLog',
  label: 'Iterated Logarithm',
  category: 'Sampler',
  kind: 'flow',
  params: [
    { key: 'walks', label: 'ensemble', min: 0.4, max: 3, step: 0.1, default: 1, rebuild: true }, // number of walks
    { key: 'diffuse', label: 'step variance', min: 0.4, max: 2, step: 0.05, default: 1, rebuild: true },
    { key: 'speed', label: 'sweep rate', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 170_000,
  particleCountOptions: [90_000, 170_000, 280_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.4,
  create: (config) => new IteratedLogArchetype(config),
};

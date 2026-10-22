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

// Multi-Species Lenia. Lenia is the continuous cellular automaton whose smooth ring-kernel dynamics
// grow lifelike cells; run THREE Lenia fields at once — three species, each with its own growth
// niche — and couple them by local COMPETITION (each species' growth is suppressed where the others
// are dense), and the dish comes alive: territories form, organisms of different colours chase,
// merge, and displace each other. (Honest scoping: this is multi-species Lenia with pointwise
// competitive coupling — the pragmatic cousin of Bert Chan's full multi-channel Lenia, which couples
// species through cross-channel convolution kernels.) Rendering keeps our colours-bake-once rule:
// every grid cell owns three points — one pure red, one green, one blue — and each species' state is
// shown by LIFTING its point into the dish (relief by concentration); where a species is absent its
// point parks in an off-camera reservoir. Overlaps blend additively into the rainbow membranes.
const EXTENT = 3;
const KERNEL_PEAK = 0.5;
const KERNEL_WIDTH = 0.15;
const SPECIES = 3;
const MU_SCALE = [0.93, 0.98, 1.04]; // per-species growth niche offsets (close enough that all thrive)
const SG_SCALE = [0.95, 1.0, 1.08];
const PARK_Y = -3.0; // off-camera reservoir for absent-species points

const PARAM_SPEC: ParamSpec[] = [
  { key: 'mu', label: 'growth μ', min: 0.05, max: 0.35, step: 0.005, default: 0.15 },
  { key: 'sigma', label: 'growth σ', min: 0.005, max: 0.06, step: 0.001, default: 0.017 },
  { key: 'rate', label: 'rate', min: 0.02, max: 0.3, step: 0.005, default: 0.12 },
  { key: 'compete', label: 'competition', min: 0, max: 1.2, step: 0.05, default: 0.3 },
  { key: 'radius', label: 'kernel R', min: 8, max: 20, step: 1, default: 12, options: { '10': 10, '12': 12, '15': 15 }, rebuild: true },
];

function growth(u: number, mu: number, sigma: number): number {
  const d = (u - mu) / sigma;
  return 2 * Math.exp(-0.5 * d * d) - 1;
}

class MultiLeniaArchetype implements Archetype {
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  readonly id = 'multiLenia';

  private readonly W: number;
  private readonly R: number;
  private fields: Float32Array[] = [];
  private nexts: Float32Array[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly kdx: Int32Array;
  private readonly kdy: Int32Array;
  private readonly kw: Float32Array;
  private readonly seed0: number;
  private reseeds = 0; // immigration counter (deterministic propagule rain for collapsed species)
  private stepCount = 0;

  constructor(config: ArchetypeConfig) {
    // three points per grid cell (one per species)
    const w = Math.max(48, Math.round(Math.sqrt(config.particleCount / SPECIES)));
    this.W = w;
    this.seed0 = config.seed;
    this.particleCount = w * w * SPECIES;
    this.R = Math.max(3, Math.min(Math.round(config.params.radius ?? 12), Math.floor((w - 1) / 2)));
    for (let s = 0; s < SPECIES; s++) {
      this.fields.push(new Float32Array(w * w));
      this.nexts.push(new Float32Array(w * w));
    }
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);

    // shared ring kernel (as in lenia.ts), normalised to sum 1
    const R = this.R;
    const dxs: number[] = [], dys: number[] = [], wts: number[] = [];
    let sum = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const r = Math.sqrt(dx * dx + dy * dy) / R;
        if (r > 1 || r < 1e-6) continue;
        const k = Math.exp(-((r - KERNEL_PEAK) ** 2) / (2 * KERNEL_WIDTH * KERNEL_WIDTH));
        dxs.push(dx); dys.push(dy); wts.push(k); sum += k;
      }
    }
    for (let i = 0; i < wts.length; i++) wts[i] /= sum;
    this.kdx = Int32Array.from(dxs);
    this.kdy = Int32Array.from(dys);
    this.kw = Float32Array.from(wts);

    // colours bake ONCE: pure species hues (overlaps blend additively into rainbow membranes)
    const HUES = [
      [1.0, 0.32, 0.28],
      [0.32, 1.0, 0.42],
      [0.4, 0.58, 1.05],
    ];
    const rngC = mulberry32((config.seed ^ 0xbe5466cf) >>> 0);
    for (let s = 0; s < SPECIES; s++) {
      for (let i = 0; i < w * w; i++) {
        const o = (s * w * w + i) * 3;
        const bri = 0.95 + 0.4 * rngC();
        this.colors[o] = HUES[s][0] * bri;
        this.colors[o + 1] = HUES[s][1] * bri;
        this.colors[o + 2] = HUES[s][2] * bri;
      }
    }
    // seed each species with soft blobs scattered over the WHOLE dish (same statistics as the base
    // Lenia's proven seeding — crowding all of a species into one region over-densifies it and Lenia's
    // growth kills over-dense patches); interleaved species then carve territories via competition
    const rng = mulberry32(config.seed);
    for (let s = 0; s < SPECIES; s++) this.inject(this.fields[s], rng, 45);
    this.syncPositions();
  }

  // drop a few soft propagule blobs into a species' field (used for seeding AND immigration)
  private inject(f: Float32Array, rng: () => number, count: number): void {
    const w = this.W, R = this.R;
    for (let b = 0; b < count; b++) {
      const bx = Math.floor((0.05 + 0.9 * rng()) * w);
      const by = Math.floor((0.05 + 0.9 * rng()) * w);
      const br = R * (0.45 + 0.5 * rng()); // organism-scale blobs convert into cells instead of dying back
      const amp = 0.55 + 0.45 * rng();
      const br2 = br * br;
      const span = Math.ceil(br);
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > br2) continue;
          const x = (((bx + dx) % w) + w) % w;
          const y = (((by + dy) % w) + w) % w;
          const v = amp * Math.exp(-d2 / (0.5 * br2));
          const i = y * w + x;
          if (v > f[i]) f[i] = v;
        }
      }
    }
  }

  step(_dt: number, p: ResolvedParams): void {
    const w = this.W;
    const kdx = this.kdx, kdy = this.kdy, kw = this.kw;
    const taps = kw.length;
    const mu = p.mu ?? 0.15;
    const sigma = p.sigma ?? 0.017;
    const rate = p.rate ?? 0.12;
    const comp = p.compete ?? 0.3;
    for (let s = 0; s < SPECIES; s++) {
      const f = this.fields[s];
      const out = this.nexts[s];
      const fa = this.fields[(s + 1) % SPECIES];
      const fb = this.fields[(s + 2) % SPECIES];
      const mus = mu * MU_SCALE[s];
      const sgs = sigma * SG_SCALE[s];
      for (let y = 0; y < w; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          let u = 0;
          for (let t = 0; t < taps; t++) {
            const xx = (((x + kdx[t]) % w) + w) % w;
            const yy = (((y + kdy[t]) % w) + w) % w;
            u += kw[t] * f[yy * w + xx];
          }
          // Lenia growth MINUS local competition from the other species (pointwise coupling)
          let v = f[idx] + rate * (growth(u, mus, sgs) - comp * (fa[idx] + fb[idx]));
          v = v < 0 ? 0 : v > 1 ? 1 : v;
          out[idx] = v;
        }
      }
    }
    for (let s = 0; s < SPECIES; s++) {
      const tmp = this.fields[s];
      this.fields[s] = this.nexts[s];
      this.nexts[s] = tmp;
    }
    // IMMIGRATION (ecology's rescue effect): if a species has collapsed, a few propagules drift in
    // from off-dish. Deterministic (seeded by a reseed counter); checked sparsely — keeps every
    // species in play across the whole parameter range instead of leaving a dead dish.
    this.stepCount++;
    if (this.stepCount % 24 === 0) {
      for (let sp = 0; sp < SPECIES; sp++) {
        const f = this.fields[sp];
        let mass = 0;
        for (let i = 0; i < f.length; i++) mass += f[i];
        if (mass / f.length < 0.004) {
          const rng = mulberry32((this.seed0 ^ Math.imul(this.reseeds + 11 + sp * 131, 2654435761)) >>> 0);
          this.reseeds++;
          this.inject(f, rng, 8);
        }
      }
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const w = this.W;
    const pos = this.positions;
    const cell = EXTENT / (w - 1);
    const half = EXTENT / 2;
    for (let s = 0; s < SPECIES; s++) {
      const f = this.fields[s];
      const base = s * w * w;
      const zNudge = s * 0.006; // hairline layer split so co-located species both read
      for (let i = 0; i < w * w; i++) {
        const o = (base + i) * 3;
        const v = f[i];
        if (v > 0.045) {
          pos[o] = (i % w) * cell - half;
          pos[o + 1] = v * 0.55 - 0.12 + zNudge;
          pos[o + 2] = ((i / w) | 0) * cell - half;
        } else {
          // park absent-species points in an off-camera reservoir (far outside the view cone)
          pos[o] = -8 - s;
          pos[o + 1] = PARK_Y;
          pos[o + 2] = (i % 89) * 0.004;
        }
      }
    }
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const out = new Float64Array(SPECIES * this.W * this.W);
    for (let s = 0; s < SPECIES; s++) out.set(this.fields[s], s * this.W * this.W);
    return out;
  }
  loadState(st: Float64Array): void {
    for (let s = 0; s < SPECIES; s++) {
      const seg = st.subarray(s * this.W * this.W, (s + 1) * this.W * this.W);
      this.fields[s].set(seg);
    }
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Multi-species Lenia ${this.W}²×3 (R=${this.R})`, stateOffset: 0, stateLength: this.particleCount }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.034 }; // fat cells — organisms read as filled membranes
  }
  dispose(): void { /* buffers GC with the instance */ }
}

export const multiLeniaFactory: ArchetypeFactory = {
  id: 'multiLenia',
  label: 'Multi-Species Lenia',
  category: 'Life',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 120_000, // 3 species points per cell → a 200² dish (same resolution as Lenia)
  particleCountOptions: [90_000, 120_000, 192_000],
  defaultDt: 0.1,
  defaultTrail: 0, // the living dish IS the visual
  create: (config) => new MultiLeniaArchetype(config),
};

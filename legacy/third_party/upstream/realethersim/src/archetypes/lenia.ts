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

// Lenia: a continuous cellular automaton ("smooth life"). The state is a real-valued field in [0,1]
// on a toroidal grid. Each step convolves the field with a smooth ring-shaped kernel to get a local
// "potential" U, then nudges every cell by a Gaussian growth function G(U) centred at μ — cells near
// the right density grow, others decay. Bounded by a [0,1] clamp, so it never blows up; with the
// classic Orbium parameters it spontaneously forms gliders, rotors, and lifelike cells. Rendered as
// a displaced point grid (height + colour by concentration), like the other Field systems.
const EXTENT = 3;
const KERNEL_PEAK = 0.5; // kernel ring radius (fraction of R)
const KERNEL_WIDTH = 0.15;

const PARAM_SPEC: ParamSpec[] = [
  { key: 'mu', label: 'growth μ', min: 0.05, max: 0.35, step: 0.005, default: 0.15 },
  { key: 'sigma', label: 'growth σ', min: 0.005, max: 0.06, step: 0.001, default: 0.017 },
  { key: 'rate', label: 'rate', min: 0.02, max: 0.3, step: 0.005, default: 0.12 },
  { key: 'radius', label: 'kernel R', min: 8, max: 20, step: 1, default: 13, options: { '10': 10, '13': 13, '16': 16 }, rebuild: true },
];

function growth(u: number, mu: number, sigma: number): number {
  const d = (u - mu) / sigma;
  return 2 * Math.exp(-0.5 * d * d) - 1;
}

class LeniaArchetype implements Archetype {
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  readonly id = 'lenia';

  private readonly W: number;
  private readonly R: number;
  private field: Float32Array;
  private next: Float32Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // Precomputed normalized ring kernel as parallel (dx, dy, weight) arrays.
  private readonly kdx: Int32Array;
  private readonly kdy: Int32Array;
  private readonly kw: Float32Array;

  constructor(config: ArchetypeConfig) {
    const w = Math.max(64, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    // Clamp R so the kernel always fits inside the torus (R ≥ W/2 would wrap and double-count).
    this.R = Math.max(3, Math.min(Math.round(config.params.radius ?? 13), Math.floor((w - 1) / 2)));
    this.field = new Float32Array(w * w);
    this.next = new Float32Array(w * w);
    this.positions = new Float32Array(w * w * 3);
    this.colors = new Float32Array(w * w * 3);

    // Ring kernel: a Gaussian shell peaked at KERNEL_PEAK·R, normalized to sum 1.
    const R = this.R;
    const dxs: number[] = [];
    const dys: number[] = [];
    const wts: number[] = [];
    let sum = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const r = Math.sqrt(dx * dx + dy * dy) / R;
        if (r > 1 || r < 1e-6) continue;
        const k = Math.exp(-((r - KERNEL_PEAK) ** 2) / (2 * KERNEL_WIDTH * KERNEL_WIDTH));
        dxs.push(dx);
        dys.push(dy);
        wts.push(k);
        sum += k;
      }
    }
    for (let i = 0; i < wts.length; i++) wts[i] /= sum;
    this.kdx = Int32Array.from(dxs);
    this.kdy = Int32Array.from(dys);
    this.kw = Float32Array.from(wts);

    // Seed soft random blobs so the field has structure to evolve (pure noise tends to die out).
    const rng = mulberry32(config.seed);
    for (let b = 0; b < 14; b++) {
      const bx = Math.floor((0.2 + 0.6 * rng()) * w);
      const by = Math.floor((0.2 + 0.6 * rng()) * w);
      const br = R * (0.8 + 0.8 * rng());
      const amp = 0.5 + 0.5 * rng();
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
          if (v > this.field[i]) this.field[i] = v;
        }
      }
    }
    this.syncPositions();
  }

  step(_dt: number, p: ResolvedParams): void {
    const w = this.W;
    const f = this.field;
    const out = this.next;
    const kdx = this.kdx;
    const kdy = this.kdy;
    const kw = this.kw;
    const taps = kw.length;
    const mu = p.mu ?? 0.15;
    const sigma = p.sigma ?? 0.017;
    const rate = p.rate ?? 0.12;

    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        let u = 0;
        for (let t = 0; t < taps; t++) {
          const xx = (((x + kdx[t]) % w) + w) % w;
          const yy = (((y + kdy[t]) % w) + w) % w;
          u += kw[t] * f[yy * w + xx];
        }
        let v = f[y * w + x] + rate * growth(u, mu, sigma);
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        out[y * w + x] = v;
      }
    }
    this.field = out;
    this.next = f;
    this.syncPositions();
  }

  private syncPositions(): void {
    const w = this.W;
    const f = this.field;
    const pos = this.positions;
    const col = this.colors;
    const cell = EXTENT / (w - 1);
    const half = EXTENT / 2;
    for (let i = 0; i < w * w; i++) {
      const x = i % w;
      const y = (i / w) | 0;
      const o = i * 3;
      const v = f[i];
      pos[o] = x * cell - half;
      pos[o + 1] = v * 0.5 - 0.15; // gentle relief by concentration
      pos[o + 2] = y * cell - half;
      col[o] = 0.1 + 0.5 * v; // dark teal → bright lime
      col[o + 1] = 0.2 + 0.75 * v;
      col[o + 2] = 0.25 + 0.35 * v;
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return Float64Array.from(this.field);
  }
  loadState(s: Float64Array): void {
    this.field.set(s.subarray(0, this.field.length));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Lenia ${this.W}² (R=${this.R})`, stateOffset: 0, stateLength: this.particleCount }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', exposesField: true, pointSize: 0.02 };
  }
  readField(): { texture: unknown; width: number; height: number } {
    return { texture: this.field, width: this.W, height: this.W };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const leniaFactory: ArchetypeFactory = {
  id: 'lenia',
  label: 'Lenia',
  category: 'Field',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 40_000,
  particleCountOptions: [40_000, 65_536, 90_000],
  defaultDt: 0.1,
  create: (config) => new LeniaArchetype(config),
};

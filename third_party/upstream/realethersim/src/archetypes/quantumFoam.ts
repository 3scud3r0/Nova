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

// Quantum Foam / Discrete Lattices (PRD §2): a Gray-Scott reaction-diffusion field on a toroidal
// W×W grid, the field-native archetype. It runs on the same worker pipeline as the others, but is
// rendered by mapping each cell to a grid point displaced/coloured by the V concentration — and it
// implements readField() (the contract path only foam needs). f/k presets give mitosis, coral,
// maze, etc. Particle count selects the grid resolution (W = round(√count)).
const PARAM_SPEC: ParamSpec[] = [
  { key: 'feed', label: 'feed f', min: 0.01, max: 0.09, step: 0.0005, default: 0.037 },
  { key: 'kill', label: 'kill k', min: 0.04, max: 0.07, step: 0.0005, default: 0.06 },
  { key: 'diffU', label: 'Du', min: 0.05, max: 0.3, step: 0.005, default: 0.16 },
  { key: 'diffV', label: 'Dv', min: 0.02, max: 0.16, step: 0.005, default: 0.08 },
  { key: 'relief', label: 'relief', min: 0, max: 4, step: 0.05, default: 1.8 },
];

const EXTENT = 3; // world-space width of the grid plane

class QuantumFoamArchetype implements Archetype {
  readonly id = 'quantumFoam';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly w: number;
  private u: Float64Array;
  private v: Float64Array;
  private uNext: Float64Array;
  private vNext: Float64Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly field: Float32Array; // V exposed via readField()
  private relief = 1.8;

  constructor(config: ArchetypeConfig) {
    const w = Math.max(32, Math.round(Math.sqrt(config.particleCount)));
    this.w = w;
    this.particleCount = w * w;
    const n = this.particleCount;

    this.u = new Float64Array(n);
    this.v = new Float64Array(n);
    this.uNext = new Float64Array(n);
    this.vNext = new Float64Array(n);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.field = new Float32Array(n);

    this.seedField(config.seed);
    this.initGrid();
    this.syncPositions();
  }

  private seedField(seed: number): void {
    const rng = mulberry32(seed);
    const w = this.w;
    this.u.fill(1);
    this.v.fill(0);
    // A handful of V seed blobs kick off the reaction.
    const blobs = 12;
    for (let b = 0; b < blobs; b++) {
      const cx = Math.floor(rng() * w);
      const cy = Math.floor(rng() * w);
      const r = 3 + Math.floor(rng() * 5);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const x = (cx + dx + w) % w;
          const y = (cy + dy + w) % w;
          const i = y * w + x;
          this.u[i] = 0.5;
          this.v[i] = 0.25;
        }
      }
    }
  }

  // Static base colours: a cool→warm gradient by column so the relief reads in dark mode.
  private initGrid(): void {
    const w = this.w;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const t = x / w;
        this.colors[i * 3] = 0.2 + 0.5 * t;
        this.colors[i * 3 + 1] = 0.5 + 0.3 * (1 - t);
        this.colors[i * 3 + 2] = 0.7;
      }
    }
  }

  step(_dt: number, p: ResolvedParams): void {
    const w = this.w;
    const u = this.u;
    const v = this.v;
    const un = this.uNext;
    const vn = this.vNext;
    const Du = p.diffU ?? 0.16;
    const Dv = p.diffV ?? 0.08;
    const f = p.feed ?? 0.037;
    const k = p.kill ?? 0.06;
    this.relief = p.relief ?? 1.8;

    // Gray-Scott with a 9-point Laplacian (orthogonal 0.2, diagonal 0.05), toroidal wrap. dt = 1.
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
    this.syncPositions();
  }

  private syncPositions(): void {
    const w = this.w;
    const v = this.v;
    const pos = this.positions;
    const field = this.field;
    const relief = this.relief;
    const half = EXTENT / 2;
    const cell = EXTENT / (w - 1);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const vv = v[i];
        field[i] = vv;
        const o = i * 3;
        pos[o] = x * cell - half;
        pos[o + 1] = vv * relief - 0.3; // V drives the relief
        pos[o + 2] = y * cell - half;
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
    return [{ id: 'root', parentId: null, label: `Field ${this.w}×${this.w}`, stateOffset: 0, stateLength: this.particleCount * 2 }];
  }

  renderHint(): RenderHint {
    return { geometry: 'points', exposesField: true, pointSize: 0.02 };
  }

  // The contract path unique to field-native archetypes (PRD): expose the V field.
  readField(): { texture: unknown; width: number; height: number } {
    return { texture: this.field, width: this.w, height: this.w };
  }

  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const quantumFoamFactory: ArchetypeFactory = {
  id: 'quantumFoam',
  label: 'Quantum-Foam',
  category: 'Field',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 40_000, // 200×200 grid
  defaultDt: 0.005,
  particleCountOptions: [16_384, 40_000, 65_536], // 128² / 200² / 256²
  create: (config) => new QuantumFoamArchetype(config),
};

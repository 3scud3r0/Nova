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

// Greenberg–Hastings excitable medium: a cyclic cellular automaton on a toroidal W×W grid. Each
// cell cycles 0 (rest) → 1 (excited) → 2…N-1 (refractory) → 0. A resting cell ignites when enough
// neighbours are excited. From random seeding this self-organises into travelling and SPIRAL waves
// (a BZ-reaction look). Bounded by construction (integer states), so it can never blow up. The
// state is rendered as a displaced point grid (phase as relief). Particle count → grid (W=√count).
const PARAM_SPEC: ParamSpec[] = [
  { key: 'states', label: 'states', min: 3, max: 12, step: 1, default: 6, options: { '4': 4, '6': 6, '8': 8, '10': 10 }, rebuild: true },
  { key: 'threshold', label: 'threshold', min: 1, max: 4, step: 1, default: 2, options: { '1': 1, '2': 2, '3': 3 } },
  { key: 'relief', label: 'relief', min: 0, max: 3, step: 0.05, default: 1.6 },
];

const EXTENT = 3;

class ExcitableMediumArchetype implements Archetype {
  readonly id = 'excitableMedium';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly W: number;
  private readonly N: number; // number of states
  private state: Float32Array;
  private next: Float32Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private relief = 1.6;

  constructor(config: ArchetypeConfig) {
    const w = Math.max(48, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    this.N = Math.max(3, Math.round(config.params.states ?? 6));
    this.state = new Float32Array(w * w);
    this.next = new Float32Array(w * w);
    this.positions = new Float32Array(w * w * 3);
    this.colors = new Float32Array(w * w * 3);

    const rng = mulberry32(config.seed);
    for (let i = 0; i < w * w; i++) {
      // Mostly resting with scattered excited/refractory cells to nucleate waves.
      this.state[i] = rng() < 0.5 ? 0 : Math.floor(rng() * this.N);
      const t = (i % w) / w;
      this.colors[i * 3] = 0.25 + 0.55 * t;
      this.colors[i * 3 + 1] = 0.55 + 0.25 * (1 - t);
      this.colors[i * 3 + 2] = 0.75;
    }
    this.syncPositions();
  }

  step(_dt: number, p: ResolvedParams): void {
    const w = this.W;
    const N = this.N;
    const s = this.state;
    const nx = this.next;
    const thr = Math.max(1, Math.round(p.threshold ?? 2));
    this.relief = p.relief ?? 1.6;

    for (let y = 0; y < w; y++) {
      const yu = ((y - 1 + w) % w) * w;
      const yd = ((y + 1) % w) * w;
      const yc = y * w;
      for (let x = 0; x < w; x++) {
        const xl = (x - 1 + w) % w;
        const xr = (x + 1) % w;
        const c = yc + x;
        const cur = s[c];
        if (cur === 0) {
          let exc = 0;
          if (s[yc + xl] === 1) exc++;
          if (s[yc + xr] === 1) exc++;
          if (s[yu + x] === 1) exc++;
          if (s[yd + x] === 1) exc++;
          if (s[yu + xl] === 1) exc++;
          if (s[yu + xr] === 1) exc++;
          if (s[yd + xl] === 1) exc++;
          if (s[yd + xr] === 1) exc++;
          nx[c] = exc >= thr ? 1 : 0;
        } else {
          nx[c] = cur >= N - 1 ? 0 : cur + 1;
        }
      }
    }
    this.state = nx;
    this.next = s;
    this.syncPositions();
  }

  private syncPositions(): void {
    const w = this.W;
    const s = this.state;
    const pos = this.positions;
    const cell = EXTENT / (w - 1);
    const half = EXTENT / 2;
    const invN = 1 / (this.N - 1);
    const relief = this.relief;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = i * 3;
        pos[o] = x * cell - half;
        pos[o + 1] = (s[i] === 1 ? 1 : s[i] * invN) * relief - 0.3; // excited band rides high
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
    return Float64Array.from(this.state);
  }

  loadState(v: Float64Array): void {
    this.state.set(v.subarray(0, this.state.length));
    this.syncPositions();
  }

  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Excitable ${this.W}² (${this.N} states)`, stateOffset: 0, stateLength: this.particleCount }];
  }

  renderHint(): RenderHint {
    return { geometry: 'points', exposesField: true, pointSize: 0.02 };
  }

  readField(): { texture: unknown; width: number; height: number } {
    return { texture: this.state, width: this.W, height: this.W };
  }

  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const excitableMediumFactory: ArchetypeFactory = {
  id: 'excitableMedium',
  label: 'Excitable Medium',
  category: 'Field',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 40_000,
  particleCountOptions: [16_384, 40_000, 65_536],
  defaultDt: 0.02,
  create: (config) => new ExcitableMediumArchetype(config),
};

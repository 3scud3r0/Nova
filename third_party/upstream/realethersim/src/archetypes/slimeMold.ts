import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';
import { mulberry32, type Rng } from '../state/rng';

// Physarum slime mold: agents wander a toroidal W×W trail field, depositing a chemical and steering
// toward whichever of three forward sensors smells strongest; the field diffuses (3×3 blur) and
// decays each step. Agents congregate on the trails they reinforce, so emergent transport networks
// appear in the AGENT density (we render the agents). The field is the hidden driver — exposed via
// readField(). This is the archetype that exercises the agent↔field feedback path.
const PARAM_SPEC: ParamSpec[] = [
  { key: 'speed', label: 'speed', min: 0.3, max: 3, step: 0.05, default: 1.0 },
  { key: 'sensorDist', label: 'sensor dist', min: 3, max: 22, step: 0.5, default: 9 },
  { key: 'sensorAngle', label: 'sensor ∠', min: 0.1, max: 1.0, step: 0.01, default: 0.4 },
  { key: 'turn', label: 'turn', min: 0.1, max: 1.2, step: 0.01, default: 0.45 },
  { key: 'decay', label: 'decay', min: 0.8, max: 0.99, step: 0.005, default: 0.9 },
  { key: 'grid', label: 'field res', min: 128, max: 256, step: 64, default: 192, options: { '128': 128, '192': 192, '256': 256 }, rebuild: true },
];

const DIM = 3; // x, y (field coords), heading
const EXTENT = 3; // world span of the field plane
const TWO_PI = Math.PI * 2;

class SlimeMoldArchetype implements Archetype {
  readonly id = 'slimeMold';
  readonly kind = 'flow' as const;
  readonly particleCount: number; // agent count = rendered point count

  private readonly W: number;
  private readonly state: Float64Array; // agents: x, y, heading
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private field: Float32Array;
  private temp: Float32Array;
  private readonly rng: Rng;

  constructor(config: ArchetypeConfig) {
    this.particleCount = config.particleCount;
    const n = this.particleCount;
    this.W = Math.max(64, Math.round(config.params.grid ?? 192));
    const W = this.W;
    this.state = new Float64Array(n * DIM);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.field = new Float32Array(W * W);
    this.temp = new Float32Array(W * W);
    this.rng = mulberry32(config.seed);

    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      this.state[o] = this.rng() * W;
      this.state[o + 1] = this.rng() * W;
      this.state[o + 2] = this.rng() * TWO_PI;
      hslToRgb(0.06 + 0.1 * (i / n), 0.85, 0.6, this.colors, i * 3); // warm glow palette
    }
    this.syncPositions();
  }

  private sense(x: number, y: number, ang: number, dist: number): number {
    const W = this.W;
    let sx = Math.round(x + Math.cos(ang) * dist) % W;
    let sy = Math.round(y + Math.sin(ang) * dist) % W;
    if (sx < 0) sx += W;
    if (sy < 0) sy += W;
    return this.field[sy * W + sx];
  }

  step(_dt: number, p: ResolvedParams): void {
    const n = this.particleCount;
    const W = this.W;
    const st = this.state;
    const field = this.field;
    const speed = p.speed ?? 1;
    const sd = p.sensorDist ?? 9;
    const sa = p.sensorAngle ?? 0.4;
    const turn = p.turn ?? 0.45;
    const decay = p.decay ?? 0.9;
    const rng = this.rng;

    // 1. Agents: sense → steer → move → deposit.
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const x = st[o];
      const y = st[o + 1];
      let h = st[o + 2];
      const fwd = this.sense(x, y, h, sd);
      const left = this.sense(x, y, h + sa, sd);
      const right = this.sense(x, y, h - sa, sd);
      if (fwd > left && fwd > right) {
        // keep heading
      } else if (fwd < left && fwd < right) {
        h += (rng() < 0.5 ? 1 : -1) * turn; // ambiguous → random turn
      } else if (left > right) {
        h += turn;
      } else if (right > left) {
        h -= turn;
      }
      let nx = x + Math.cos(h) * speed;
      let ny = y + Math.sin(h) * speed;
      nx = ((nx % W) + W) % W;
      ny = ((ny % W) + W) % W;
      st[o] = nx;
      st[o + 1] = ny;
      st[o + 2] = h;
      field[((ny | 0) * W + (nx | 0))] += 1; // deposit
    }

    // 2. Field: 3×3 toroidal blur × decay (ping-pong).
    const temp = this.temp;
    for (let yy = 0; yy < W; yy++) {
      const yu = ((yy - 1 + W) % W) * W;
      const yd = ((yy + 1) % W) * W;
      const yc = yy * W;
      for (let xx = 0; xx < W; xx++) {
        const xl = (xx - 1 + W) % W;
        const xr = (xx + 1) % W;
        const c = yc + xx;
        const sum =
          field[c] + field[yc + xl] + field[yc + xr] + field[yu + xx] + field[yd + xx] +
          field[yu + xl] + field[yu + xr] + field[yd + xl] + field[yd + xr];
        temp[c] = (sum / 9) * decay;
      }
    }
    this.field = temp;
    this.temp = field;

    this.syncPositions();
  }

  private syncPositions(): void {
    const n = this.particleCount;
    const W = this.W;
    const st = this.state;
    const pos = this.positions;
    const scale = EXTENT / W;
    const half = EXTENT / 2;
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const po = i * 3;
      pos[po] = st[o] * scale - half;
      pos[po + 1] = 0;
      pos[po + 2] = st[o + 1] * scale - half;
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }

  readColors(): Float32Array {
    return this.colors;
  }

  readState(): Float64Array {
    return this.state;
  }

  loadState(s: Float64Array): void {
    this.state.set(s.subarray(0, this.state.length));
    this.syncPositions();
  }

  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Plasmodium (${this.W}² field)`, stateOffset: 0, stateLength: this.state.length, particleStart: 0, particleCount: this.particleCount }];
  }

  renderHint(): RenderHint {
    return { geometry: 'points', exposesField: true, pointSize: 0.01 };
  }

  readField(): { texture: unknown; width: number; height: number } {
    return { texture: this.field, width: this.W, height: this.W };
  }

  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const slimeMoldFactory: ArchetypeFactory = {
  id: 'slimeMold',
  label: 'Slime Mold',
  category: 'Life',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 100_000,
  particleCountOptions: [50_000, 100_000, 200_000],
  defaultDt: 0.008,
  create: (config) => new SlimeMoldArchetype(config),
};

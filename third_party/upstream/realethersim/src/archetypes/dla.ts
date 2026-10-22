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

// Diffusion-Limited Aggregation: random-walking "dust" particles wander a toroidal grid until they
// touch the growing cluster, then freeze in place. Starting from a single seed, this builds a
// branching, self-similar dendrite (fractal dimension ≈ 1.71) — the pattern behind coral, lightning,
// frost, and mineral deposits. The cluster is the grid; walkers are invisible drivers. Stuck cells
// are lifted into the render plane (empty cells hidden below), so growth shows via position — which
// works on the CPU path even though colours upload only once (coloured by radius: core → tips).
const EXTENT = 3;
const TAU = Math.PI * 2;
const HIDDEN_Y = -30; // empty cells parked below the camera (off-screen, |y| stays render-bounded)
const NEI = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
]; // 8-neighbour Moore stencil — used for the sticking/adjacency test
// 4-neighbour (von Neumann) random-walk steps; ordered to match the GPU kernel exactly.
const STEP = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

const PARAM_SPEC: ParamSpec[] = [
  { key: 'stickiness', label: 'stickiness', min: 0.05, max: 1, step: 0.05, default: 1 },
  { key: 'walkers', label: 'walkers', min: 2000, max: 40000, step: 1000, default: 8000, options: { '4k': 4000, '8k': 8000, '16k': 16000 }, rebuild: true },
];

class DlaArchetype implements Archetype {
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  readonly id = 'dla';

  private readonly W: number;
  private readonly M: number; // walker count
  private readonly grid: Float32Array; // 0 empty, 1 stuck
  private readonly walk: Float64Array; // walker x,y (grid coords)
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly rng: Rng;
  private clusterR = 1; // current cluster radius (cells) — walkers launch just outside it so growth is fast

  constructor(config: ArchetypeConfig) {
    const w = Math.max(64, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    this.M = Math.max(1000, Math.round(config.params.walkers ?? 8000));
    this.grid = new Float32Array(w * w);
    this.walk = new Float64Array(this.M * 2);
    this.positions = new Float32Array(w * w * 3);
    this.colors = new Float32Array(w * w * 3);
    this.rng = mulberry32(config.seed);

    this.grid[(w >> 1) * w + (w >> 1)] = 1; // seed at centre
    for (let i = 0; i < this.M; i++) this.respawn(i);

    // PRE-GROW: a single-seed cluster reads as empty on load (slow start). Run the aggregation up-front
    // until the dendrite fills most of the frame, so it's immediately visible; live growth continues.
    const stick0 = config.params.stickiness ?? 1;
    const targetR = w * 0.38; // grow until the dendrite spans most of the frame (branchy, not a solid blob)
    for (let s = 0; s < 14000 && this.clusterR < targetR; s++) this.growOnce(stick0);

    // Static colours by radius from centre (core warm → tips cool); revealed as cells become stuck.
    // Colour ONLY the (pre-grown) stuck cells — bright warm-to-gold by radius. Empty cells stay BLACK so
    // they're invisible from ANY camera angle (parking them off-screen by y-offset isn't robust under
    // orbit — a steep view catches the parked plane as a bright patch).
    const cx = w / 2;
    const maxR = w * 0.5;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (this.grid[idx] <= 0) continue; // empty → leave black
        const r = Math.min(1, Math.hypot(x - cx, y - cx) / maxR);
        // bright warm-to-gold ramp (single-layer dendrite ⇒ brightness, not density, is the visibility lever)
        hslToRgb(0.04 + 0.14 * r, 0.95, 0.85, this.colors, idx * 3);
      }
    }
    this.syncPositions();
  }

  private respawn(i: number): void {
    // Launch on an annulus JUST OUTSIDE the current frontier, so a walker reaches the cluster in a few
    // steps rather than wandering the whole grid — this is what makes the dendrite grow fast enough to
    // be visible. Capped so it never spawns past the render extent.
    const w = this.W;
    const a = this.rng() * TAU;
    const rad = Math.min(w * 0.47, this.clusterR + 4 + this.rng() * 5);
    this.walk[i * 2] = (((w / 2 + Math.cos(a) * rad) % w) + w) % w;
    this.walk[i * 2 + 1] = (((w / 2 + Math.sin(a) * rad) % w) + w) % w;
  }

  // One aggregation pass over all walkers; returns the number of cells that newly stuck this pass.
  private growOnce(stick: number): number {
    const w = this.W;
    const g = this.grid;
    const walk = this.walk;
    const rng = this.rng;
    const c = w >> 1;
    const killR = this.clusterR + 14; // relaunch walkers that stray past this so they stay productive
    const killR2 = killR * killR;
    let newly = 0;
    for (let i = 0; i < this.M; i++) {
      let wx = walk[i * 2] | 0;
      let wy = walk[i * 2 + 1] | 0;
      const ci = wy * w + wx;
      if (g[ci] > 0) {
        this.respawn(i);
        continue;
      }
      let adj = false;
      for (let k = 0; k < 8; k++) {
        const nx = (wx + NEI[k][0] + w) % w;
        const ny = (wy + NEI[k][1] + w) % w;
        if (g[ny * w + nx] > 0) {
          adj = true;
          break;
        }
      }
      if (adj && rng() < stick) {
        g[ci] = 1;
        newly++;
        const dx = wx - (w >> 1), dy = wy - (w >> 1);
        const rr = Math.sqrt(dx * dx + dy * dy);
        if (rr > this.clusterR) this.clusterR = rr; // grow the frontier so launches track outward
        this.respawn(i);
        continue;
      }
      const dir = (rng() * 4) | 0; // 4-neighbour walk (matches the GPU kernel)
      wx = (wx + STEP[dir][0] + w) % w;
      wy = (wy + STEP[dir][1] + w) % w;
      const sx = wx - c, sy = wy - c;
      if (sx * sx + sy * sy > killR2) { this.respawn(i); continue; } // strayed too far → relaunch at the frontier
      walk[i * 2] = wx;
      walk[i * 2 + 1] = wy;
    }
    return newly;
  }

  step(_dt: number, p: ResolvedParams): void {
    this.growOnce(p.stickiness ?? 1);
    this.syncPositions();
  }

  private syncPositions(): void {
    const w = this.W;
    const g = this.grid;
    const pos = this.positions;
    const cell = EXTENT / (w - 1);
    const half = EXTENT / 2;
    for (let i = 0; i < w * w; i++) {
      const o = i * 3;
      pos[o] = (i % w) * cell - half;
      pos[o + 1] = g[i] > 0 ? 0 : HIDDEN_Y;
      pos[o + 2] = ((i / w) | 0) * cell - half;
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return Float64Array.from(this.grid);
  }
  loadState(s: Float64Array): void {
    this.grid.set(s.subarray(0, this.grid.length));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `DLA ${this.W}² (${this.M} walkers)`, stateOffset: 0, stateLength: this.particleCount }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.02 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const dlaFactory: ArchetypeFactory = {
  id: 'dla',
  label: 'Diffusion-Limited Aggregation',
  category: 'Fractal',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 6_400, // W≈80 — small enough that the dendrite fills the frame + reads chunky
  particleCountOptions: [6_400, 16_384, 40_000],
  defaultDt: 0.016,
  create: (config) => new DlaArchetype(config),
};

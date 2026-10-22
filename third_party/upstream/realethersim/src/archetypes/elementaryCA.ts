import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Elementary Cellular Automaton — Wolfram's proof that complexity needs no complicated rule. A single
// row of on/off cells updates in lockstep: each cell's next state is looked up from its own value and
// its two neighbours (8 possible patterns), and the 8 answers, read as a byte, ARE the rule number
// (0–255). From one lit cell, Rule 90 draws the Sierpiński triangle, Rule 30 makes provably chaotic
// noise (it seeds a random-number generator), and Rule 110 is Turing-complete — universal computation
// from three-cell arithmetic. We grow the space-time diagram row by row down the screen so you watch
// the structure accrete, then loop. Only lit cells are drawn (dark cells park off-frame); colour is
// baked as a gradient down the rows. Bounded. (Stephen Wolfram, 1983.)
const W = 460, H = 320; // grid: columns × generations of history
const PARK = -44; // dark cells park here, off-frame

class ElementaryCAArchetype implements Archetype {
  readonly id = 'elementaryCA';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly grid: Uint8Array; // H×W precomputed space-time bits
  private rule = 30;
  private seedMode = 0; // 0 = single centre cell, 1 = random row
  private rate = 1;
  private reveal = 0; // how many rows are currently shown (grows over time, then loops)
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = W * H;
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.grid = new Uint8Array(N);
    const rng = mulberry32((config.seed ^ 0x6c078965) >>> 0);
    this.readParams(config.params);
    // bake a downward colour gradient (cyan → magenta) by row; dark cells never show it
    for (let row = 0; row < H; row++) {
      const f = row / (H - 1);
      // saturated cyan (top) → magenta (bottom); keep secondaries low so hue survives bloom clipping
      const cr = 0.15 + 1.75 * f, cg = 1.35 - 1.15 * f, cb = 1.9 - 0.55 * f;
      for (let col = 0; col < W; col++) {
        const o = (row * W + col) * 3;
        const b = 0.9 + 0.35 * rng();
        this.colors[o] = cr * b; this.colors[o + 1] = cg * b; this.colors[o + 2] = cb * b;
      }
    }
    this.computeGrid(rng);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.rule = Math.max(0, Math.min(255, Math.round(p.rule ?? 30)));
    this.seedMode = Math.round(p.seed ?? 0);
    this.rate = p.rate ?? 1;
  }

  // evolve the elementary CA from the seed row down through H generations, storing every cell
  private computeGrid(rng: () => number): void {
    const g = this.grid;
    g.fill(0);
    if (this.seedMode >= 1) {
      for (let c = 0; c < W; c++) g[c] = rng() < 0.5 ? 1 : 0;
    } else {
      g[(W >> 1)] = 1; // single lit cell, centred
    }
    for (let row = 1; row < H; row++) {
      const prev = (row - 1) * W, cur = row * W;
      for (let c = 0; c < W; c++) {
        const l = c > 0 ? g[prev + c - 1] : 0;
        const m = g[prev + c];
        const r = c < W - 1 ? g[prev + c + 1] : 0;
        const nb = (l << 2) | (m << 1) | r; // 0..7 neighbourhood pattern
        g[cur + c] = (this.rule >> nb) & 1; // the rule byte's nb-th bit
      }
    }
  }

  private syncPositions(): void {
    const pos = this.positions;
    const shown = Math.min(H, Math.floor(this.reveal));
    for (let row = 0; row < H; row++) {
      const y = (0.5 - row / (H - 1)) * 2.2; // row 0 at top, growing downward
      const visible = row < shown;
      for (let col = 0; col < W; col++) {
        const i = row * W + col;
        const o = i * 3;
        if (visible && this.grid[i]) {
          pos[o] = (col / (W - 1) - 0.5) * 3.1;
          pos[o + 1] = y;
          pos[o + 2] = 0;
        } else {
          pos[o] = 0; pos[o + 1] = PARK; pos[o + 2] = 0; // off-frame
        }
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const prevRule = this.rule, prevSeed = this.seedMode;
    this.readParams(p);
    if (this.rule !== prevRule || this.seedMode !== prevSeed) {
      this.computeGrid(mulberry32((this.rule * 2654435761) >>> 0));
      this.reveal = 0; // regrow from the top on a rule change
    }
    this.t += dt * this.rate;
    this.reveal += dt * this.rate * 80; // ~80 generations/sec
    if (this.reveal > H + 40) this.reveal = 0; // hold full for a beat, then loop the accretion
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t, this.reveal]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.reveal = s[1] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'elementary cellular automaton (space-time)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.006 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const elementaryCAFactory: ArchetypeFactory = {
  id: 'elementaryCA',
  label: 'Elementary CA',
  category: 'Life',
  kind: 'flow',
  params: [
    { key: 'rule', label: 'rule number', min: 0, max: 255, step: 1, default: 30 },
    { key: 'seed', label: 'seed (0 dot · 1 random)', min: 0, max: 1, step: 1, default: 0 },
    { key: 'rate', label: 'growth speed', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: W * H,
  particleCountOptions: [W * H],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.4,
  create: (config) => new ElementaryCAArchetype(config),
};

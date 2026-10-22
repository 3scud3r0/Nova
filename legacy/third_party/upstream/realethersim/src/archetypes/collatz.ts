import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';

// Collatz Coral — the 3n+1 problem, drawn as a living reef. Take any positive integer; if it is even
// halve it, if it is odd triple it and add one; repeat. The Collatz conjecture says every number
// eventually falls to 1 — checked past 2^68, unproven for 87 years. Each number's descent (its
// "hailstone" sequence) is run BACKWARDS from 1 and drawn as a turtle bough: step forward, turning
// gently left at an even number, harder right at an odd one. Because every sequence ends "…8→4→2→1",
// the boughs all share that stem and only split where their numbers diverge — so hundreds of independent
// walks weave into one branching coral. Most steps are halvings (gentle sweeps); the rarer odd numbers
// put the kinks that throw off new branches. Each bough is drawn dim at the shared stem and bright at its
// own tip, so the crown blazes while the trunk stays a thin bright thread. None of this proves the
// conjecture — it is just startling that a rule this simple grows something this botanical. (The classic
// "Collatz orchid"; a cousin of the Ulam/prime spirals.)
const A_EVEN = 0.06; // radians turned (left) at an even number — gentle, so halving-runs sweep, not spiral
const A_ODD = -0.13; // radians turned (right) at an odd number — the sharper kink that throws a branch
const D_MAX = 90; // deepest step drawn along a bough — trims the runaway tails, keeps a compact crown
const RANGE = 300_000; // spread of starting integers sampled for boughs → diverse fronds
const INTERP = 2; // points drawn per unit segment → continuous boughs, not a dotted spray
const EXTENT = 2.3; // render half-extent to normalise into

class CollatzArchetype implements Archetype {
  readonly id = 'collatz';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly bx: Float32Array; private readonly by: Float32Array; private readonly bz: Float32Array;
  private readonly hf: Float32Array; private readonly ph: Float32Array;
  private sway = 1; private speed = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = config.particleCount;
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.bx = new Float32Array(N); this.by = new Float32Array(N); this.bz = new Float32Array(N);
    this.hf = new Float32Array(N); this.ph = new Float32Array(N);

    // Fill half the budget with natural boughs (root → leaf, dense lines); the rest is the mirror image.
    const H = N; // no mirror — the natural asymmetric Collatz coral
    const hx = new Float32Array(H); const hy = new Float32Array(H);
    const dfrac = new Float32Array(H); const tint = new Uint8Array(H);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const seq: number[] = [];
    let filled = 0, j = 0;
    while (filled < H && j < 4_000_000) {
      const start = 2 + (((j * 2654435761) >>> 0) % RANGE); // hashed spread → diverse boughs
      const teal = (j % 11) === 0;
      j++;
      // forward hailstone sequence start → 1
      seq.length = 0;
      let v = start; seq.push(v);
      let guard = 0;
      while (v !== 1 && guard++ < 100000) { v = v % 2 === 0 ? v / 2 : 3 * v + 1; seq.push(v); }
      const L = seq.length;
      const drawLen = Math.min(L, D_MAX + 1);
      // walk the reversed path (root first) as a turtle, emitting a continuous line
      let x = 0, y = 0, h = Math.PI / 2, px = 0, py = 0;
      for (let k = 0; k < drawLen && filled < H; k++) {
        const val = seq[L - 1 - k];
        h += (val % 2 === 0) ? A_EVEN : A_ODD;
        x += Math.cos(h); y += Math.sin(h);
        if (k > 0) {
          const df = k / D_MAX; // 0 stem … 1 crown
          for (let m = 1; m <= INTERP && filled < H; m++) {
            const tt = m / INTERP;
            const ex = px + (x - px) * tt, ey = py + (y - py) * tt;
            const i = filled++;
            hx[i] = ex; hy[i] = ey; dfrac[i] = df; tint[i] = teal ? 1 : 0;
            if (ex < minX) minX = ex; if (ex > maxX) maxX = ex;
            if (ey < minY) minY = ey; if (ey > maxY) maxY = ey;
          }
        }
        px = x; py = y;
      }
    }

    // normalise + anchor the root at the base so the coral GROWS UPWARD. x is centred on 0 (the stem)
    // and mirrored; y is shifted so the shared root sits near the bottom of the frame.
    const halfX = Math.max(Math.abs(minX), Math.abs(maxX), 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    const s = (2 * EXTENT) / Math.max(2 * halfX, spanY);
    for (let i = 0; i < N; i++) {
      const src = i < H ? i : i - H;
      const sign = i < H ? 1 : -1; // second half is the mirror image → the bilateral orchid
      const nx = hx[src] * s * sign;
      const ny = (hy[src] - minY) * s - EXTENT;
      const nz = (((i * 2654435761) >>> 0) % 1000 / 1000 - 0.5) * 0.16; // whisper of depth for orbiting
      this.bx[i] = nx; this.by[i] = ny; this.bz[i] = nz;
      this.hf[i] = Math.max(0, (ny + EXTENT) / (2 * EXTENT));
      this.ph[i] = (i % 991) * 0.213;
      // dim rose stem → bright ivory/violet crown; a teal-tinted minority of whole boughs
      const df = dfrac[src];
      const b = df * df; // brightness rises steeply toward the tips so the shared stem stays a thin thread
      const o = i * 3;
      if (tint[src]) {
        this.colors[o] = 0.05 + 0.9 * b; this.colors[o + 1] = 0.22 + 1.5 * b; this.colors[o + 2] = 0.4 + 1.7 * b;
      } else {
        this.colors[o] = 0.28 + 1.9 * b; this.colors[o + 1] = 0.06 + 1.05 * b; this.colors[o + 2] = 0.16 + 1.5 * b;
      }
    }
    this.readParams(config.params);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.sway = p.sway ?? 1;
    this.speed = p.speed ?? 1;
  }

  private syncPositions(): void {
    const pos = this.positions, N = this.particleCount;
    const w = this.t * this.speed * 0.7;
    const amp = 0.08 * this.sway;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const hf = this.hf[i];
      const dx = Math.sin(w + this.ph[i] + this.by[i] * 1.5) * amp * hf; // seaweed sway, stronger up high
      pos[o] = this.bx[i] + dx;
      pos[o + 1] = this.by[i];
      pos[o + 2] = this.bz[i];
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'reversed hailstone boughs woven into a coral', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const collatzFactory: ArchetypeFactory = {
  id: 'collatz',
  label: 'Collatz Coral',
  category: 'Number',
  kind: 'flow',
  params: [
    { key: 'sway', label: 'sway', min: 0, max: 2.5, step: 0.05, default: 1 },
    { key: 'speed', label: 'sway speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 220_000,
  particleCountOptions: [120_000, 220_000, 340_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new CollatzArchetype(config),
};

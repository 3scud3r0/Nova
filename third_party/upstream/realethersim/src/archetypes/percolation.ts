import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';
import { mulberry32 } from '../state/rng';

// Percolation — when does a random network connect? Each square of a grid is filled with probability p,
// independently; filled squares that touch along an edge belong to the same cluster (each cluster gets its
// own colour). Below a sharp threshold, p_c ≈ 0.5927, clusters stay small and isolated; above it one giant
// cluster spans the whole grid (drawn in gold). Right at the threshold the spanning cluster is a fractal, full
// of holes on every scale, with dimension 91/48. A fire is lit along the left edge and spreads through
// touching filled squares (the raised, glowing front): below p_c it dies out, above it crosses — this is the
// model for forest fires, oil seeping through rock, coffee through grounds, and disease through a population.
// Change p to watch the transition; it is remarkably sudden on a big grid.

const PER = 4; // points per square

class PercolationArchetype implements Archetype {
  readonly id = 'percolation';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly L: number;
  private readonly p: number;
  private readonly occ: Uint8Array;
  private readonly parent: Int32Array; private readonly size: Int32Array;
  private readonly dist: Int32Array; // fire arrival time (shortest path through filled squares from the left edge), −1 = never
  private readonly maxDist: number;
  private readonly spanning: number; // root of a left-to-right spanning cluster, or −1
  private readonly largest: number; // size of the largest cluster
  private readonly crossTime: number; // fire's arrival at the right edge (−1 = never)
  private readonly base: Float32Array; // x, z of each drawn point
  private speed = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    this.p = Math.min(1, Math.max(0, config.params.p ?? 0.5927));
    this.readParams(config.params);
    const L = Math.max(16, Math.floor(Math.sqrt(P / PER))); // each square is drawn as PER jittered points (a lattice of single points moirés)
    this.L = L;
    const N = L * L;
    this.occ = new Uint8Array(N); this.parent = new Int32Array(N); this.size = new Int32Array(N); this.dist = new Int32Array(N).fill(-1);
    for (let k = 0; k < N; k++) { this.occ[k] = rng() < this.p ? 1 : 0; this.parent[k] = k; this.size[k] = 1; }
    // clusters by union–find (nearest neighbours)
    for (let j = 0; j < L; j++) for (let i = 0; i < L; i++) {
      const k = j * L + i;
      if (!this.occ[k]) continue;
      if (i + 1 < L && this.occ[k + 1]) this.union(k, k + 1);
      if (j + 1 < L && this.occ[k + L]) this.union(k, k + L);
    }
    // a cluster spans if it touches both the left and the right column
    const left = new Set<number>();
    for (let j = 0; j < L; j++) if (this.occ[j * L]) left.add(this.find(j * L));
    let span = -1;
    for (let j = 0; j < L && span < 0; j++) { const k = j * L + L - 1; if (this.occ[k] && left.has(this.find(k))) span = this.find(k); }
    this.spanning = span;
    let big = 0;
    for (let k = 0; k < N; k++) if (this.occ[k] && this.parent[k] === k) big = Math.max(big, this.size[k]);
    this.largest = big;
    // the fire: breadth-first from every filled square in the left column
    const q = new Int32Array(N); let qh = 0, qt = 0;
    for (let j = 0; j < L; j++) { const k = j * L; if (this.occ[k]) { this.dist[k] = 0; q[qt++] = k; } }
    let md = 0, cross = -1;
    while (qh < qt) {
      const k = q[qh++], d = this.dist[k], i = k % L, j = (k / L) | 0;
      md = Math.max(md, d);
      if (i === L - 1 && cross < 0) cross = d;
      const nb = [i > 0 ? k - 1 : -1, i < L - 1 ? k + 1 : -1, j > 0 ? k - L : -1, j < L - 1 ? k + L : -1];
      for (const n of nb) if (n >= 0 && this.occ[n] && this.dist[n] < 0) { this.dist[n] = d + 1; q[qt++] = n; }
    }
    this.maxDist = md; this.crossTime = cross;

    // colours: spanning cluster gold, other clusters a muted hue each (by cluster), empty squares black
    this.base = new Float32Array(N * PER * 2);
    const S = 3.3 / L, col = this.colors;
    for (let k = 0; k < N; k++) {
      const i = k % L, j = (k / L) | 0;
      for (let q = 0; q < PER; q++) {
        const o = k * PER + q;
        this.base[o * 2] = (i - L / 2 + 0.1 + 0.8 * rng()) * S; this.base[o * 2 + 1] = (j - L / 2 + 0.1 + 0.8 * rng()) * S;
        if (!this.occ[k]) continue; // stays black
        const r = this.find(k);
        if (r === span) hslToRgb(0.11, 0.95, 0.6, col, o * 3);
        else {
          const h = ((r * 2654435761) >>> 0) / 4294967296, sz = this.size[r];
          hslToRgb(0.45 + 0.5 * h, 0.6, 0.25 + 0.25 * Math.min(1, Math.log(sz) / Math.log(400)), col, o * 3);
        }
      }
    }
    // spare points (when P isn't a square) sit black at the origin
    this.t = 0;
    this.syncPositions();
  }

  private find(k: number): number {
    while (this.parent[k] !== k) { this.parent[k] = this.parent[this.parent[k]]; k = this.parent[k]; }
    return k;
  }
  private union(a: number, b: number): void {
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (this.size[ra] < this.size[rb]) { const t = ra; ra = rb; rb = t; }
    this.parent[rb] = ra; this.size[ra] += this.size[rb];
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  private syncPositions(): void {
    const pos = this.positions, L = this.L, N = L * L;
    const front = this.t; // the fire's front, in steps
    for (let k = 0; k < N; k++) {
      const d = this.dist[k];
      let y = 0;
      if (d >= 0) {
        const g = front - d;
        if (g >= 0) y = g < 4 ? 0.22 * (1 - g / 4) + 0.03 : 0.03; // the raised front, then burnt (slightly raised)
      }
      for (let q = 0; q < PER; q++) { const o = k * PER + q; pos[o * 3] = this.base[o * 2]; pos[o * 3 + 1] = y; pos[o * 3 + 2] = this.base[o * 2 + 1]; }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    // the fire advances ~40 squares per second at speed 1, then the forest regrows and it starts again
    this.t += dt * this.speed * 40;
    if (this.t > this.maxDist + 60) this.t = 0;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { if (s.length === 1) { this.t = s[0]; this.syncPositions(); } }
  /** Summary numbers, for the panel and for tests. */
  stats(): { spans: boolean; largestFraction: number; crossTime: number; L: number } {
    return { spans: this.spanning >= 0, largestFraction: this.largest / (this.L * this.L), crossTime: this.crossTime, L: this.L };
  }
  getHierarchy(): NodeSpec[] {
    const s = this.stats();
    const label = `p = ${this.p.toFixed(4)} (threshold p_c ≈ 0.5927) on a ${s.L}×${s.L} grid · largest cluster ${(100 * s.largestFraction).toFixed(1)}% of all squares · ${s.spans ? `a cluster spans the grid; the fire crosses in ${s.crossTime} steps (straight across: ${s.L - 1})` : 'no cluster spans; the fire dies out'}`;
    return [{ id: 'root', parentId: null, label, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const percolationFactory: ArchetypeFactory = {
  id: 'percolation',
  label: 'Percolation',
  category: 'Matter',
  kind: 'flow',
  params: [
    { key: 'p', label: 'fill probability p', min: 0.3, max: 0.9, step: 0.0025, default: 0.5927, rebuild: true },
    { key: 'speed', label: 'fire speed', min: 0, max: 4, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 160_000, // a 200 × 200 grid, 4 points per square
  particleCountOptions: [90_000, 160_000, 360_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.4,
  create: (config) => new PercolationArchetype(config),
};

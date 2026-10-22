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

// Community Islands — how a network's hidden groups become visible. Real networks (friendships, papers
// citing papers, proteins that work together) are made of COMMUNITIES: groups whose members link to each
// other far more than to outsiders. Drawn naively the whole thing is an unreadable hairball. Treat it as
// a physical system instead — every link a spring, every node a charge that pushes all others away — and
// let it relax: densely-linked groups pull themselves together while the few links between groups (the
// "weak ties") stretch, and the hairball unmixes into islands joined by long bridges. The graph is a
// stochastic block model (the standard benchmark for community detection); the layout is a live
// spring–charge simulation (Fruchterman–Reingold style forces, damped). It opens settled, then every so
// often scrambles itself back into a hairball and unmixes again. Colour = community (fixed per node, so
// colour-once is exact); bridges glow white-gold.
const EXTENT = 2.1; // render half-extent of the settled layout
const GOLDEN_HUE = 0.61803398875;

class CommunityIslandsArchetype implements Archetype {
  readonly id = 'communityIslands';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  // graph
  private readonly N: number;
  private readonly E: number;
  private readonly ea: Int32Array;
  private readonly eb: Int32Array;
  // layout state (natural units)
  private readonly x: Float64Array; private readonly y: Float64Array; private readonly z: Float64Array;
  private readonly vx: Float64Array; private readonly vy: Float64Array; private readonly vz: Float64Array;
  private readonly fx: Float64Array; private readonly fy: Float64Array; private readonly fz: Float64Array;
  private readonly L0: number; // spring rest length
  private sc = 1; // natural → render scale (fixed from the settled layout)
  // points: an edge point is (edge, t); a node point is (node, offset)
  private readonly pe: Int32Array; // edge index, or −1 − node for a node point
  private readonly pt: Float32Array; // position along the edge, 0…1
  private readonly ox: Float32Array; private readonly oy: Float32Array; private readonly oz: Float32Array; // node-ball offsets
  private readonly rng: () => number;
  // live params
  private pull = 1;
  private speed = 1;
  private spin = 0.5;
  private period = 24;
  private t = 0;
  private sinceShuffle = 0;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    this.rng = rng;

    // --- a stochastic block model: C communities of uneven size, dense inside, sparse bridges between ---
    const C = Math.max(2, Math.round(config.params.communities ?? 6));
    const N = Math.max(C * 8, Math.round(config.params.nodes ?? 480));
    const bridges = Math.max(0, config.params.bridges ?? 1);
    this.N = N;
    const w = Array.from({ length: C }, () => 0.6 + 0.8 * rng());
    const wsum = w.reduce((a, b) => a + b, 0);
    const comm = new Int32Array(N);
    const members: number[][] = Array.from({ length: C }, () => []);
    let i0 = 0;
    for (let c = 0; c < C; c++) {
      const size = c === C - 1 ? N - i0 : Math.max(6, Math.round((N * w[c]) / wsum));
      for (let k = 0; k < size && i0 < N; k++) { comm[i0] = c; members[c].push(i0); i0++; }
    }
    const edges: number[] = [];
    const seen = new Set<number>();
    const add = (a: number, b: number): void => {
      if (a === b) return;
      const key = a < b ? a * N + b : b * N + a;
      if (seen.has(key)) return;
      seen.add(key); edges.push(a, b);
    };
    const MEAN_IN = 5.5; // expected links to your own community
    for (const m of members) {
      const p = Math.min(1, MEAN_IN / Math.max(1, m.length - 1));
      for (let a = 0; a < m.length; a++) for (let b = a + 1; b < m.length; b++) if (rng() < p) add(m[a], m[b]);
      for (let a = 1; a < m.length; a++) add(m[a], m[(rng() * a) | 0]); // a random spanning tree: no stray fragments
    }
    const nBridges = Math.round(N * 0.06 * bridges);
    for (let k = 0; k < nBridges; k++) {
      const a = (rng() * N) | 0;
      let b = (rng() * N) | 0, guard = 0;
      while (comm[b] === comm[a] && guard++ < 50) b = (rng() * N) | 0;
      add(a, b);
    }
    for (let c = 1; c < C; c++) add(members[c][0], members[(rng() * c) | 0][0]); // keep it one connected network
    this.E = edges.length / 2;
    this.ea = new Int32Array(this.E); this.eb = new Int32Array(this.E);
    const deg = new Int32Array(N);
    for (let e = 0; e < this.E; e++) { this.ea[e] = edges[2 * e]; this.eb[e] = edges[2 * e + 1]; deg[this.ea[e]]++; deg[this.eb[e]]++; }

    // --- layout state; settle it now so the system opens formed ---
    this.x = new Float64Array(N); this.y = new Float64Array(N); this.z = new Float64Array(N);
    this.vx = new Float64Array(N); this.vy = new Float64Array(N); this.vz = new Float64Array(N);
    this.fx = new Float64Array(N); this.fy = new Float64Array(N); this.fz = new Float64Array(N);
    this.L0 = 0.9 / Math.cbrt(N);
    this.scramble();
    this.readParams(config.params);
    for (let s = 0; s < 700; s++) this.relax(0.016);
    let r2 = 0;
    const [cx, cy, cz] = this.centroid();
    for (let i = 0; i < N; i++) r2 += (this.x[i] - cx) ** 2 + (this.y[i] - cy) ** 2 + (this.z[i] - cz) ** 2;
    this.sc = (0.62 * EXTENT) / Math.sqrt(r2 / N + 1e-9);

    // --- points: edges as chains (bridges brighter), nodes as small balls ---
    const hue = (c: number): number => (0.03 + c * GOLDEN_HUE) % 1;
    this.pe = new Int32Array(P); this.pt = new Float32Array(P);
    this.ox = new Float32Array(P); this.oy = new Float32Array(P); this.oz = new Float32Array(P);
    const lens = new Float64Array(this.E);
    let Ltot = 0;
    for (let e = 0; e < this.E; e++) {
      const a = this.ea[e], b = this.eb[e];
      const bridge = comm[a] !== comm[b];
      lens[e] = Math.hypot(this.x[a] - this.x[b], this.y[a] - this.y[b], this.z[a] - this.z[b]) * (bridge ? 1.6 : 1); // bridges a bit denser
      Ltot += lens[e];
    }
    const nodeBudget = Math.floor(P * 0.24);
    const edgeBudget = P - nodeBudget;
    let p = 0;
    const tmp = new Float32Array(3);
    for (let e = 0; e < this.E && p < edgeBudget; e++) {
      const a = this.ea[e], b = this.eb[e];
      const bridge = comm[a] !== comm[b];
      const n = Math.max(3, Math.round((edgeBudget * lens[e]) / Ltot));
      for (let s = 0; s < n && p < edgeBudget; s++, p++) {
        const tt = n > 1 ? s / (n - 1) : 0.5;
        this.pe[p] = e; this.pt[p] = tt;
        const o = p * 3;
        if (bridge) {
          hslToRgb(0.11, 0.85, 0.62, this.colors, o); // a white-gold weak tie
          this.colors[o] *= 1.25; this.colors[o + 1] *= 1.2; this.colors[o + 2] *= 1.1;
        } else {
          hslToRgb(hue(comm[a]), 0.8, 0.5, this.colors, o);
          for (let k = 0; k < 3; k++) this.colors[o + k] *= 0.75;
        }
      }
    }
    let degSum = 0;
    for (let i = 0; i < N; i++) degSum += deg[i];
    for (let i = 0; i < N && p < P; i++) {
      const share = Math.max(2, Math.round((nodeBudget * deg[i]) / degSum));
      const rad = 0.010 + 0.006 * Math.sqrt(deg[i]); // render units: hubs get bigger balls
      hslToRgb(hue(comm[i]), 0.7, 0.66, tmp, 0);
      for (let s = 0; s < share && p < P; s++, p++) {
        const u = rng() * 2 - 1, th = rng() * 6.2831853, rr = rad * Math.cbrt(rng()), ss = Math.sqrt(1 - u * u) * rr;
        this.pe[p] = -1 - i;
        this.ox[p] = ss * Math.cos(th); this.oy[p] = u * rr; this.oz[p] = ss * Math.sin(th);
        this.colors[p * 3] = tmp[0] * 1.3; this.colors[p * 3 + 1] = tmp[1] * 1.3; this.colors[p * 3 + 2] = tmp[2] * 1.3;
      }
    }
    for (; p < P; p++) { this.pe[p] = -1; this.ox[p] = 0; this.oy[p] = 0; this.oz[p] = 0; } // spare points sit inside node 0's ball
    this.syncPositions();
  }

  // Scramble into a tight hairball: every node somewhere in a small ball, at rest.
  private scramble(): void {
    const r = this.L0 * 1.2;
    for (let i = 0; i < this.N; i++) {
      const u = this.rng() * 2 - 1, th = this.rng() * 6.2831853, s = Math.sqrt(1 - u * u), rr = r * Math.cbrt(this.rng());
      this.x[i] = s * Math.cos(th) * rr; this.y[i] = u * rr; this.z[i] = s * Math.sin(th) * rr;
      this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0;
    }
  }

  private centroid(): [number, number, number] {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < this.N; i++) { cx += this.x[i]; cy += this.y[i]; cz += this.z[i]; }
    return [cx / this.N, cy / this.N, cz / this.N];
  }

  // One damped step of the spring–charge system: all pairs repel (~L0²/d²), links are springs (rest L0),
  // a weak pull toward the centre keeps separate islands from drifting off.
  private relax(dt: number): void {
    const { N, x, y, z, vx, vy, vz, fx, fy, fz, L0 } = this;
    const kRep = L0 * L0 * 0.9;
    const kSpring = 6 * this.pull;
    fx.fill(0); fy.fill(0); fz.fill(0);
    for (let i = 0; i < N; i++) {
      const xi = x[i], yi = y[i], zi = z[i];
      let ax = 0, ay = 0, az = 0;
      for (let j = i + 1; j < N; j++) {
        const rx = xi - x[j], ry = yi - y[j], rz = zi - z[j];
        const d2 = rx * rx + ry * ry + rz * rz + 1e-4 * L0 * L0;
        const f = kRep / (d2 * Math.sqrt(d2));
        const gx = rx * f, gy = ry * f, gz = rz * f;
        ax += gx; ay += gy; az += gz;
        fx[j] -= gx; fy[j] -= gy; fz[j] -= gz;
      }
      fx[i] += ax; fy[i] += ay; fz[i] += az;
    }
    for (let e = 0; e < this.E; e++) {
      const a = this.ea[e], b = this.eb[e];
      const rx = x[b] - x[a], ry = y[b] - y[a], rz = z[b] - z[a];
      const d = Math.sqrt(rx * rx + ry * ry + rz * rz) + 1e-9;
      const f = (kSpring * (d - L0)) / d;
      fx[a] += rx * f; fy[a] += ry * f; fz[a] += rz * f;
      fx[b] -= rx * f; fy[b] -= ry * f; fz[b] -= rz * f;
    }
    const g = 0.15, damp = Math.exp(-4 * dt), vmax = 3 * L0 / Math.max(dt, 1e-6) * 0.25;
    for (let i = 0; i < N; i++) {
      vx[i] = (vx[i] + (fx[i] - g * x[i]) * dt) * damp;
      vy[i] = (vy[i] + (fy[i] - g * y[i]) * dt) * damp;
      vz[i] = (vz[i] + (fz[i] - g * z[i]) * dt) * damp;
      const v = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      if (v > vmax) { const k = vmax / v; vx[i] *= k; vy[i] *= k; vz[i] *= k; }
      x[i] += vx[i] * dt; y[i] += vy[i] * dt; z[i] += vz[i] * dt;
    }
  }

  private readParams(p: ResolvedParams): void {
    this.pull = p.pull ?? 1;
    this.speed = p.speed ?? 1;
    this.spin = p.spin ?? 0.5;
    this.period = p.reshuffle ?? 24;
  }

  private syncPositions(): void {
    const pos = this.positions, P = this.particleCount;
    const [cx, cy, cz] = this.centroid();
    const sc = this.sc;
    const ang = this.t * this.spin * 0.12;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const { x, y, z, ea, eb } = this;
    const clamp = (v: number): number => (v > 9 ? 9 : v < -9 ? -9 : v);
    for (let p = 0; p < P; p++) {
      const e = this.pe[p];
      let X: number, Y: number, Z: number;
      if (e >= 0) {
        const a = ea[e], b = eb[e], t = this.pt[p];
        X = x[a] + (x[b] - x[a]) * t; Y = y[a] + (y[b] - y[a]) * t; Z = z[a] + (z[b] - z[a]) * t;
        X = (X - cx) * sc; Y = (Y - cy) * sc; Z = (Z - cz) * sc;
      } else {
        const i = -1 - e;
        X = (x[i] - cx) * sc + this.ox[p]; Y = (y[i] - cy) * sc + this.oy[p]; Z = (z[i] - cz) * sc + this.oz[p];
      }
      const o = p * 3;
      pos[o] = clamp(X * ca + Z * sa);
      pos[o + 1] = clamp(Y);
      pos[o + 2] = clamp(-X * sa + Z * ca);
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const h = dt * this.speed;
    if (h > 0) {
      this.t += h;
      this.sinceShuffle += h;
      if (this.period > 0 && this.sinceShuffle >= this.period) { this.sinceShuffle = 0; this.scramble(); }
      this.relax(Math.min(h, 0.03));
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const s = new Float64Array(2 + 6 * this.N);
    s[0] = this.t; s[1] = this.sinceShuffle;
    s.set(this.x, 2); s.set(this.y, 2 + this.N); s.set(this.z, 2 + 2 * this.N);
    s.set(this.vx, 2 + 3 * this.N); s.set(this.vy, 2 + 4 * this.N); s.set(this.vz, 2 + 5 * this.N);
    return s;
  }
  loadState(s: Float64Array): void {
    if (s.length !== 2 + 6 * this.N) return;
    this.t = s[0]; this.sinceShuffle = s[1];
    const N = this.N;
    this.x.set(s.subarray(2, 2 + N)); this.y.set(s.subarray(2 + N, 2 + 2 * N)); this.z.set(s.subarray(2 + 2 * N, 2 + 3 * N));
    this.vx.set(s.subarray(2 + 3 * N, 2 + 4 * N)); this.vy.set(s.subarray(2 + 4 * N, 2 + 5 * N)); this.vz.set(s.subarray(2 + 5 * N, 2 + 6 * N));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'a clustered network relaxing into islands', stateOffset: 0, stateLength: 2 + 6 * this.N }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const communityIslandsFactory: ArchetypeFactory = {
  id: 'communityIslands',
  label: 'Community Islands',
  category: 'Network',
  kind: 'flow',
  params: [
    { key: 'communities', label: 'communities', min: 2, max: 10, step: 1, default: 6, rebuild: true },
    { key: 'nodes', label: 'nodes', min: 150, max: 800, step: 10, default: 420, rebuild: true },
    { key: 'bridges', label: 'bridges (weak ties)', min: 0, max: 4, step: 0.1, default: 1, rebuild: true },
    { key: 'pull', label: 'link pull', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'reshuffle', label: 'scramble every (s, 0 = never)', min: 0, max: 60, step: 1, default: 24 },
    { key: 'spin', label: 'spin', min: 0, max: 3, step: 0.05, default: 0.5 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 160_000,
  particleCountOptions: [80_000, 160_000, 240_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new CommunityIslandsArchetype(config),
};

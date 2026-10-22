import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Barabási–Albert Network — how a scale-free network grows itself. Start with a tiny seed of connected
// nodes, then add nodes one at a time; each newcomer wires to m existing nodes chosen with probability
// proportional to how many links they ALREADY have. "The rich get richer": the earliest, best-connected
// nodes keep winning new links, so a handful of giant HUBS emerge while most nodes stay sparse — a
// power-law degree distribution, the signature of the web, citation graphs, protein interactions, airline
// maps, and the connectivity people point to when they call this diagram a neural network drawn early. No
// hubs are designed in; they self-organise from one rule, preferential attachment (Barabási–Albert 1999).
// We grow the graph, lay it out in 3-D with a force-directed relaxation (links pull, all nodes repel), and
// draw every edge as a chain of points — dim spokes, hot hubs — so the emergent hub-and-spoke skeleton
// glows. Bounded (the layout is normalised into the render box).
const EXTENT = 2.2; // render half-extent to normalise the layout into

class BarabasiAlbertArchetype implements Archetype {
  readonly id = 'barabasiAlbert';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly bx: Float32Array; private readonly by: Float32Array; private readonly bz: Float32Array;
  private speed = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    this.bx = new Float32Array(P); this.by = new Float32Array(P); this.bz = new Float32Array(P);

    const rng = mulberry32(config.seed);
    const m = Math.max(1, Math.round(config.params.attach ?? 2)); // links each new node makes
    const N = Math.max(m + 2, Math.round(config.params.nodes ?? 1100)); // total nodes
    const m0 = m + 1; // fully-connected seed

    // --- grow the Barabási–Albert graph via the "stub list" (preferential attachment in O(1) per pick) ---
    const deg = new Int32Array(N);
    const maxE = (m0 * (m0 - 1)) / 2 + (N - m0) * m;
    const ea = new Int32Array(maxE); const eb = new Int32Array(maxE); let E = 0;
    const stubs = new Int32Array(2 * maxE); let S = 0; // each node appears once per incident edge-end
    const addEdge = (a: number, b: number): void => {
      ea[E] = a; eb[E] = b; E++; deg[a]++; deg[b]++; stubs[S++] = a; stubs[S++] = b;
    };
    for (let a = 0; a < m0; a++) for (let b = a + 1; b < m0; b++) addEdge(a, b); // seed clique
    const chosen = new Int32Array(m);
    for (let i = m0; i < N; i++) {
      let c = 0, tries = 0;
      while (c < m && tries < 20000) {
        tries++;
        const t = stubs[(rng() * S) | 0]; // pick a node with probability ∝ its degree
        if (t === i) continue;
        let dup = false; for (let k = 0; k < c; k++) if (chosen[k] === t) { dup = true; break; }
        if (dup) continue;
        chosen[c++] = t;
      }
      for (let k = 0; k < c; k++) addEdge(i, chosen[k]);
    }
    let maxDeg = 1; for (let i = 0; i < N; i++) if (deg[i] > maxDeg) maxDeg = deg[i];

    // --- 3-D force-directed layout (Fruchterman–Reingold): edges attract, every pair repels ---
    const px = new Float64Array(N); const py = new Float64Array(N); const pz = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      // seed on a small sphere so it unfolds symmetrically
      const u = rng() * 2 - 1, th = rng() * 6.2831853, s = Math.sqrt(1 - u * u);
      px[i] = s * Math.cos(th); py[i] = u; pz[i] = s * Math.sin(th);
    }
    const dx = new Float64Array(N); const dy = new Float64Array(N); const dz = new Float64Array(N);
    const k = 2.7 * Math.cbrt(1 / N); // ideal edge length (larger = more spread, edges read as a web)
    const k2 = k * k;
    const ITERS = 90;
    for (let it = 0; it < ITERS; it++) {
      dx.fill(0); dy.fill(0); dz.fill(0);
      // repulsion (all pairs)
      for (let i = 0; i < N; i++) {
        const xi = px[i], yi = py[i], zi = pz[i];
        for (let j = i + 1; j < N; j++) {
          let rx = xi - px[j], ry = yi - py[j], rz = zi - pz[j];
          let d2 = rx * rx + ry * ry + rz * rz; if (d2 < 1e-6) { rx = 1e-3; d2 = 1e-6; }
          const d = Math.sqrt(d2);
          const f = k2 / d2; // repulsive magnitude
          const ux = rx / d, uy = ry / d, uz = rz / d;
          dx[i] += ux * f; dy[i] += uy * f; dz[i] += uz * f;
          dx[j] -= ux * f; dy[j] -= uy * f; dz[j] -= uz * f;
        }
      }
      // attraction (along edges)
      for (let e = 0; e < E; e++) {
        const a = ea[e], b = eb[e];
        let rx = px[a] - px[b], ry = py[a] - py[b], rz = pz[a] - pz[b];
        const d = Math.sqrt(rx * rx + ry * ry + rz * rz) + 1e-6;
        const f = (d * d) / k; // attractive magnitude
        const ux = rx / d, uy = ry / d, uz = rz / d;
        dx[a] -= ux * f; dy[a] -= uy * f; dz[a] -= uz * f;
        dx[b] += ux * f; dy[b] += uy * f; dz[b] += uz * f;
      }
      const temp = 0.08 * (1 - it / ITERS); // cool down
      for (let i = 0; i < N; i++) {
        const dl = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i] + dz[i] * dz[i]) + 1e-9;
        const lim = Math.min(dl, temp);
        px[i] += (dx[i] / dl) * lim; py[i] += (dy[i] / dl) * lim; pz[i] += (dz[i] / dl) * lim;
      }
    }

    // normalise into the render box (bbox-centre, uniform scale)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < N; i++) {
      if (px[i] < minX) minX = px[i]; if (px[i] > maxX) maxX = px[i];
      if (py[i] < minY) minY = py[i]; if (py[i] > maxY) maxY = py[i];
      if (pz[i] < minZ) minZ = pz[i]; if (pz[i] > maxZ) maxZ = pz[i];
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
    const sc = (2 * EXTENT) / span;
    const nx = (i: number): number => (px[i] - cx) * sc;
    const ny = (i: number): number => (py[i] - cy) * sc;
    const nz = (i: number): number => (pz[i] - cz) * sc;

    // degree → colour: cool blue spokes → hot ivory/gold hubs
    const col = (degv: number, out: Float32Array, o: number, dim: number): void => {
      const g = Math.pow(degv / maxDeg, 0.55);
      out[o] = (0.12 + 3.0 * g) * dim;        // hubs blaze gold/ivory
      out[o + 1] = (0.32 + 1.9 * g) * dim;
      out[o + 2] = (1.5 - 1.25 * g) * dim;    // leaves stay cool blue
    };

    // --- lay down points: edges as chains (density ∝ length), then bright hub blobs ---
    let Ltot = 0; const elen = new Float32Array(E);
    for (let e = 0; e < E; e++) {
      const a = ea[e], b = eb[e];
      const d = Math.hypot(nx(a) - nx(b), ny(a) - ny(b), nz(a) - nz(b));
      elen[e] = d; Ltot += d;
    }
    const budgetNodes = Math.floor(P * 0.22);
    const budgetEdges = P - budgetNodes;
    let filled = 0;
    for (let e = 0; e < E && filled < budgetEdges; e++) {
      const a = ea[e], b = eb[e];
      const ax = nx(a), ay = ny(a), az = nz(a), bx = nx(b), by = ny(b), bz = nz(b);
      const npts = Math.max(2, Math.round((budgetEdges * elen[e]) / (Ltot + 1e-9)));
      const hi = Math.max(deg[a], deg[b]);
      for (let s = 0; s < npts && filled < budgetEdges; s++) {
        const tt = npts > 1 ? s / (npts - 1) : 0;
        const i = filled++;
        this.bx[i] = ax + (bx - ax) * tt; this.by[i] = ay + (by - ay) * tt; this.bz[i] = az + (bz - az) * tt;
        // spokes fade toward the low-degree end so hubs read as the bright junctions
        const near = tt < 0.5 ? deg[a] : deg[b];
        col(0.3 * hi + 0.7 * near, this.colors, i * 3, 0.7);
      }
    }
    // hub glows: distribute the node budget by degree, jittered into a little ball whose size ∝ degree
    let placed = filled;
    for (let i = 0; i < N && placed < P; i++) {
      const share = Math.max(1, Math.round((budgetNodes * deg[i]) / (2 * E)));
      const rad = 0.012 + 0.055 * Math.sqrt(deg[i] / maxDeg);
      for (let s = 0; s < share && placed < P; s++) {
        const u = rng() * 2 - 1, th = rng() * 6.2831853, ss = Math.sqrt(1 - u * u) * Math.cbrt(rng());
        const p = placed++;
        this.bx[p] = nx(i) + ss * Math.cos(th) * rad;
        this.by[p] = ny(i) + u * rad;
        this.bz[p] = nz(i) + ss * Math.sin(th) * rad;
        col(deg[i], this.colors, p * 3, 1.45);
      }
    }
    // any remainder: park at the origin, coloured black (invisible from every angle)
    for (let p = placed; p < P; p++) { this.bx[p] = 0; this.by[p] = 0; this.bz[p] = 0; }

    this.readParams(config.params);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  private syncPositions(): void {
    const pos = this.positions, N = this.particleCount;
    const ang = this.t * this.speed * 0.14; // slow turn so the 3-D hub structure reads
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const x = this.bx[i], z = this.bz[i];
      pos[o] = x * ca + z * sa;
      pos[o + 1] = this.by[i];
      pos[o + 2] = -x * sa + z * ca;
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
    return [{ id: 'root', parentId: null, label: 'a scale-free network grown by preferential attachment', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const barabasiAlbertFactory: ArchetypeFactory = {
  id: 'barabasiAlbert',
  label: 'Barabási–Albert Network',
  category: 'Network',
  kind: 'flow',
  params: [
    { key: 'nodes', label: 'nodes', min: 300, max: 2600, step: 50, default: 1100, rebuild: true },
    { key: 'attach', label: 'links / node (m)', min: 1, max: 5, step: 1, default: 2, rebuild: true },
    { key: 'speed', label: 'spin', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 180_000,
  particleCountOptions: [120_000, 180_000, 260_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new BarabasiAlbertArchetype(config),
};

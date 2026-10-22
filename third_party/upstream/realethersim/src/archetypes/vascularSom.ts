import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Vascular SOM — a Self-Organizing Map meeting a problem it cannot solve perfectly. The same Kohonen
// rule as the sphere-draping SOM (best-matching-unit + a shrinking Gaussian neighbourhood on a flat
// rectangular lattice) is handed a BRANCHING vascular tree instead of a smooth surface. Local updates
// preserve neighbourhood structure beautifully on continuous manifolds — but a flat sheet cannot wrap
// around every bifurcation while keeping all neighbouring neurons consistently connected. So the sheet
// stretches, compresses and tears near the branch points: not the algorithm failing, but revealing the
// limits of topology preservation — the geometry asks more of the sheet than its lattice can hold. The
// blue neural sheet strains between the tree's glowing gold branch-clusters. Wireframe over a static
// tree cloud; colours bake once. Bounded. (Teuvo Kohonen, 1982.)
const GW = 46, GH = 46; // neuron grid
const NN = GW * GH;

class VascularSomArchetype implements Archetype {
  readonly id = 'vascularSom';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // neuron weights (3-D positions)
  private readonly wx: Float64Array; private readonly wy: Float64Array; private readonly wz: Float64Array;
  // render points: 0 = wireframe edge (lerp neuronA→neuronB), 1 = tree cloud, 2 = sample glint
  private readonly role: Uint8Array;
  private readonly ea: Int32Array; private readonly eb: Int32Array; private readonly ef: Float64Array;
  private readonly cx: Float64Array; private readonly cy: Float64Array; private readonly cz: Float64Array; // static cloud/glint pos
  // the vascular tree geometry (flat segment list + tip list), built once, stable across loads
  private readonly segs: number[] = []; // [ax,ay,az,bx,by,bz, …]
  private readonly tips: number[] = []; // [x,y,z, …]
  private rng: () => number;
  private trained = 0;
  private rate = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(2048, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.wx = new Float64Array(NN); this.wy = new Float64Array(NN); this.wz = new Float64Array(NN);
    this.role = new Uint8Array(N);
    this.ea = new Int32Array(N); this.eb = new Int32Array(N); this.ef = new Float64Array(N);
    this.cx = new Float64Array(N); this.cy = new Float64Array(N); this.cz = new Float64Array(N);
    this.rng = mulberry32((config.seed ^ 0x41c64e6d) >>> 0);
    this.readParams(config.params);
    const rng = this.rng;
    this.buildTree();
    // init neurons as a small flat patch (they will strain to reach the branching tree)
    for (let n = 0; n < NN; n++) {
      const gx = (n % GW) / (GW - 1) - 0.5, gy = ((n / GW) | 0) / (GH - 1) - 0.5;
      this.wx[n] = gx * 0.4 + (rng() - 0.5) * 0.02;
      this.wy[n] = gy * 0.4 + (rng() - 0.5) * 0.02;
      this.wz[n] = (rng() - 0.5) * 0.02;
    }
    // build the render buffer: edges of the grid, the gold tree cloud, a few sample glints
    const edges: [number, number][] = [];
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const n = gy * GW + gx;
      if (gx < GW - 1) edges.push([n, n + 1]);
      if (gy < GH - 1) edges.push([n, n + GW]);
    }
    const nCloud = Math.floor(N * 0.42); // the tree is bushy + bright — it dominates like the tweet
    const nGlint = Math.floor(N * 0.015);
    const nWire = N - nCloud - nGlint;
    let idx = 0;
    for (let e = 0; e < edges.length && idx < nWire; e++) {
      const per = Math.max(2, Math.floor(nWire / edges.length));
      for (let j = 0; j < per && idx < nWire; j++, idx++) {
        this.role[idx] = 0; this.ea[idx] = edges[e][0]; this.eb[idx] = edges[e][1];
        this.ef[idx] = per === 1 ? 0.5 : j / (per - 1);
        // cool blue neural sheet
        const o = idx * 3;
        const shade = 0.65 + 0.55 * this.rng();
        this.colors[o] = 0.16 * shade; this.colors[o + 1] = 0.56 * shade; this.colors[o + 2] = 1.0 * shade;
      }
    }
    while (idx < nWire) { this.role[idx] = 0; this.ea[idx] = 0; this.eb[idx] = 1; this.ef[idx] = 0.5; idx++; }
    // tree cloud: the branching geometry being learned (dense gold clusters at the tips)
    for (let j = 0; j < nCloud && idx < N; j++, idx++) {
      const [sx, sy, sz, tip] = this.sampleTree();
      this.role[idx] = 1; this.cx[idx] = sx; this.cy[idx] = sy; this.cz[idx] = sz;
      const o = idx * 3; const b = (tip ? 0.95 : 0.10) + 0.2 * rng(); // tips burn brighter → glowing clusters
      this.colors[o] = b * 1.0; this.colors[o + 1] = b * 0.72; this.colors[o + 2] = b * 0.26;
    }
    // glints: a handful of bright inputs riding the tree
    for (; idx < N; idx++) {
      const [sx, sy, sz] = this.sampleTree();
      this.role[idx] = 2; this.cx[idx] = sx; this.cy[idx] = sy; this.cz[idx] = sz;
      const b = 1.3 + 0.6 * rng();
      this.colors[idx * 3] = b; this.colors[idx * 3 + 1] = b * 0.85; this.colors[idx * 3 + 2] = b * 0.45;
    }
    // burn in so the sheet arrives already straining over the tree
    for (let s = 0; s < 55; s++) this.train();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.rate = p.rate ?? 1;
  }

  // Grow a recursive bifurcating tree with a fixed seed so the shape is stable across loads. Each
  // segment splits into two children tilted toward random perpendiculars, lengths shrinking per level.
  private buildTree(): void {
    const trng = mulberry32(0x5eed1a3);
    const grow = (x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, level: number): void => {
      const nx = x + dx * len, ny = y + dy * len, nz = z + dz * len;
      this.segs.push(x, y, z, nx, ny, nz);
      if (level <= 0) { this.tips.push(nx, ny, nz); return; }
      const spread = 0.4 + 0.3 * (6 - level) / 6; // branches fan wider toward the canopy
      for (let c = 0; c < 2; c++) {
        // a random unit vector, projected perpendicular to the current direction
        let rx = trng() - 0.5, ry = trng() - 0.5, rz = trng() - 0.5;
        const dpr = rx * dx + ry * dy + rz * dz;
        rx -= dpr * dx; ry -= dpr * dy; rz -= dpr * dz;
        const pl = Math.hypot(rx, ry, rz) || 1; rx /= pl; ry /= pl; rz /= pl;
        const ang = (c === 0 ? 1 : -1) * spread * (0.7 + 0.6 * trng());
        const ca = Math.cos(ang), sa = Math.sin(ang);
        let ndx = ca * dx + sa * rx, ndy = ca * dy + sa * ry, ndz = ca * dz + sa * rz;
        const nl = Math.hypot(ndx, ndy, ndz) || 1; ndx /= nl; ndy /= nl; ndz /= nl;
        grow(nx, ny, nz, ndx, ndy, ndz, len * 0.72, level - 1);
      }
    };
    // trunk runs along a diagonal so the draped sheet reads at a 3/4 view
    grow(-1.5, -0.45, -0.15, 0.92, 0.35, 0.18, 0.82, 5);
  }

  // sample a point on the tree: 45% clustered near a tip (bushy ends), else along a random tube
  private sampleTree(): [number, number, number, boolean] {
    const nSeg = this.segs.length / 6;
    if (this.rng() < 0.6 && this.tips.length) {
      const k = (this.rng() * (this.tips.length / 3)) | 0;
      const o = k * 3;
      return [
        this.tips[o] + (this.rng() - 0.5) * 0.15,
        this.tips[o + 1] + (this.rng() - 0.5) * 0.15,
        this.tips[o + 2] + (this.rng() - 0.5) * 0.15,
        true,
      ];
    }
    const s = ((this.rng() * nSeg) | 0) * 6;
    const f = this.rng();
    return [
      this.segs[s] + (this.segs[s + 3] - this.segs[s]) * f + (this.rng() - 0.5) * 0.05,
      this.segs[s + 1] + (this.segs[s + 4] - this.segs[s + 1]) * f + (this.rng() - 0.5) * 0.05,
      this.segs[s + 2] + (this.segs[s + 5] - this.segs[s + 2]) * f + (this.rng() - 0.5) * 0.05,
      false,
    ];
  }

  // one training frame: present a few samples, move the best-matching neuron + neighbours
  private train(): void {
    const prog = Math.min(1, this.trained / 2200); // annealing progress
    // NOTE vs the sphere SOM: we keep a higher neighbourhood FLOOR (1.4, not ~0.6). A branching tree
    // can't be tiled by a flat sheet, so with a tiny σ the sheet crumples into a wad; a broader floor
    // keeps it a taut sail that visibly STRAINS and tears between branches — that's the whole point.
    const sigma = 20 * Math.pow(1 / 20, prog) + 1.4; // neighbourhood radius shrinks 20 → ~1.4
    const eta = 0.34 * Math.pow(0.05 / 0.34, prog); // learning rate decays
    const inv2s2 = 1 / (2 * sigma * sigma);
    const K = 12;
    for (let s = 0; s < K; s++) {
      const [sx, sy, sz] = this.sampleTree();
      // best-matching unit
      let best = 0, bd = 1e9;
      for (let n = 0; n < NN; n++) {
        const dx = sx - this.wx[n], dy = sy - this.wy[n], dz = sz - this.wz[n];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = n; }
      }
      const bcx = best % GW, bcy = (best / GW) | 0;
      const rad = Math.ceil(sigma * 3);
      for (let gy = Math.max(0, bcy - rad); gy <= Math.min(GH - 1, bcy + rad); gy++) {
        for (let gx = Math.max(0, bcx - rad); gx <= Math.min(GW - 1, bcx + rad); gx++) {
          const dd = (gx - bcx) * (gx - bcx) + (gy - bcy) * (gy - bcy);
          const h = eta * Math.exp(-dd * inv2s2);
          const n = gy * GW + gx;
          this.wx[n] += h * (sx - this.wx[n]);
          this.wy[n] += h * (sy - this.wy[n]);
          this.wz[n] += h * (sz - this.wz[n]);
        }
      }
      this.trained++;
    }
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const role = this.role[i];
      if (role === 0) {
        const a = this.ea[i], b = this.eb[i], f = this.ef[i];
        pos[o] = this.wx[a] + (this.wx[b] - this.wx[a]) * f;
        pos[o + 1] = this.wy[a] + (this.wy[b] - this.wy[a]) * f;
        pos[o + 2] = this.wz[a] + (this.wz[b] - this.wz[a]) * f;
      } else if (role === 1) {
        pos[o] = this.cx[i]; pos[o + 1] = this.cy[i]; pos[o + 2] = this.cz[i];
      } else {
        // glints ride their tree sample with a small living jitter
        const ph = i * 0.7 + this.t * 1.3;
        pos[o] = this.cx[i] + Math.sin(ph) * 0.03;
        pos[o + 1] = this.cy[i] + Math.cos(ph * 1.3) * 0.03;
        pos[o + 2] = this.cz[i] + Math.sin(ph * 0.7) * 0.03;
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt * this.rate;
    this.train();
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t, this.trained]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.trained = s[1] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'neural sheet straining over a vascular tree', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.006 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const vascularSomFactory: ArchetypeFactory = {
  id: 'vascularSom',
  label: 'Vascular SOM',
  category: 'Life',
  kind: 'flow',
  params: [
    { key: 'rate', label: 'learning pace', min: 0.3, max: 2.5, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 150_000,
  particleCountOptions: [80_000, 150_000, 240_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.4,
  create: (config) => new VascularSomArchetype(config),
};

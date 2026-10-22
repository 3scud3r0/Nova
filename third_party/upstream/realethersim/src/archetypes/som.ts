import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Self-Organizing Map (Kohonen). A flat sheet of neurons, each carrying a weight vector, with no
// knowledge of the data around it. For every input sample x it finds the best-matching neuron
// c = argminᵢ‖x − wᵢ‖ and nudges that neuron AND its grid neighbours toward the sample,
// wᵢ ← wᵢ + η(t)·h_c i(t)·(x − wᵢ). As the neighbourhood radius σ shrinks over training, the sheet
// bends and folds onto the hidden geometry of the data while preserving its 2-D neighbourhood
// structure — order emerging from thousands of simple local updates (Teuvo Kohonen, 1982). Here a
// grid of neurons starts as a tiny flat patch and learns to wrap a sphere of samples, draping over
// it like an orange peel. Drawn as a live wireframe (points strung along the grid edges); colours
// bake once. Bounded.
const GW = 44, GH = 44; // neuron grid
const NN = GW * GH;
const R = 1.2; // radius of the data sphere

class SomArchetype implements Archetype {
  readonly id = 'som';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // neuron weights (3-D positions)
  private readonly wx: Float64Array; private readonly wy: Float64Array; private readonly wz: Float64Array;
  // render points: 0 = wireframe edge (lerp neuronA→neuronB), 1 = data cloud, 2 = sample glint
  private readonly role: Uint8Array;
  private readonly ea: Int32Array; private readonly eb: Int32Array; private readonly ef: Float64Array;
  private readonly cx: Float64Array; private readonly cy: Float64Array; private readonly cz: Float64Array; // static cloud/glint pos
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
    // init neurons as a small flat patch (they will unfold to wrap the sphere)
    for (let n = 0; n < NN; n++) {
      const gx = (n % GW) / (GW - 1) - 0.5, gy = ((n / GW) | 0) / (GH - 1) - 0.5;
      this.wx[n] = gx * 0.35 + (rng() - 0.5) * 0.02;
      this.wy[n] = gy * 0.35 + (rng() - 0.5) * 0.02;
      this.wz[n] = (rng() - 0.5) * 0.02;
    }
    // build the render buffer: edges of the grid, a faint data cloud, a few sample glints
    const edges: [number, number][] = [];
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const n = gy * GW + gx;
      if (gx < GW - 1) edges.push([n, n + 1]);
      if (gy < GH - 1) edges.push([n, n + GW]);
    }
    const nCloud = Math.floor(N * 0.14);
    const nGlint = Math.floor(N * 0.02);
    const nWire = N - nCloud - nGlint;
    let idx = 0;
    for (let e = 0; e < edges.length && idx < nWire; e++) {
      const per = Math.max(2, Math.floor(nWire / edges.length));
      for (let j = 0; j < per && idx < nWire; j++, idx++) {
        this.role[idx] = 0; this.ea[idx] = edges[e][0]; this.eb[idx] = edges[e][1];
        this.ef[idx] = per === 1 ? 0.5 : j / (per - 1);
        // teal sheet, faintly brighter along one diagonal so the fold reads
        const o = idx * 3;
        const shade = 0.7 + 0.5 * this.rng();
        this.colors[o] = 0.16 * shade; this.colors[o + 1] = 0.72 * shade; this.colors[o + 2] = 0.88 * shade;
      }
    }
    while (idx < nWire) { this.role[idx] = 0; this.ea[idx] = 0; this.eb[idx] = 1; this.ef[idx] = 0.5; idx++; }
    // data cloud: faint samples on the sphere (the geometry being learned)
    for (let j = 0; j < nCloud && idx < N; j++, idx++) {
      const [sx, sy, sz] = this.sampleSphere();
      this.role[idx] = 1; this.cx[idx] = sx; this.cy[idx] = sy; this.cz[idx] = sz;
      const o = idx * 3; const b = 0.06 + 0.06 * rng();
      this.colors[o] = b * 0.7; this.colors[o + 1] = b * 0.9; this.colors[o + 2] = b;
    }
    // glints: a handful of bright samples (the current inputs)
    for (; idx < N; idx++) {
      this.role[idx] = 2; const b = 1.2 + 0.6 * rng();
      this.colors[idx * 3] = b; this.colors[idx * 3 + 1] = b * 0.95; this.colors[idx * 3 + 2] = b * 0.6;
    }
    // burn in so the sheet arrives already unfolding
    for (let s = 0; s < 80; s++) this.train();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.rate = p.rate ?? 1;
  }

  private sampleSphere(): [number, number, number] {
    const z = 2 * this.rng() - 1, th = 6.2831853 * this.rng(), r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * Math.cos(th) * R, r * Math.sin(th) * R, z * R];
  }

  // one training frame: present a few samples, move the best-matching neuron + neighbours
  private train(): void {
    const prog = Math.min(1, this.trained / 2600); // annealing progress
    const sigma = 20 * Math.pow(1 / 20, prog) + 0.6; // neighbourhood radius shrinks 20 → ~1
    const eta = 0.32 * Math.pow(0.03 / 0.32, prog); // learning rate decays
    const inv2s2 = 1 / (2 * sigma * sigma);
    const K = 12;
    for (let s = 0; s < K; s++) {
      const [sx, sy, sz] = this.sampleSphere();
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
        // glints ride a slowly-changing sample position (drift for life)
        const ph = i * 0.3 + this.t * 0.7;
        const z = Math.sin(ph), r = Math.sqrt(Math.max(0, 1 - z * z));
        pos[o] = r * Math.cos(ph * 2.1) * R; pos[o + 1] = r * Math.sin(ph * 2.1) * R; pos[o + 2] = z * R;
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
    return [{ id: 'root', parentId: null, label: 'self-organizing map (learning)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.006 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const somFactory: ArchetypeFactory = {
  id: 'som',
  label: 'Self-Organizing Map',
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
  create: (config) => new SomArchetype(config),
};

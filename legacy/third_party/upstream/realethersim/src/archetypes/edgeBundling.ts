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

// Edge Bundling — how to see the structure in a thousand connections. Put every node of a network on a
// ring and draw each link as a straight chord and you get a grey disc of spaghetti. Danny Holten's
// hierarchical edge bundling (2006) uses the network's own hierarchy — modules, packages, departments —
// to route each link: instead of a straight chord, a link follows the path through the hierarchy tree
// (leaf → its subgroup → its group → … → the common ancestor → … → the target leaf) and is drawn as a
// smooth B-spline using those tree nodes as control points. Links that travel between the same parts of
// the hierarchy share control points, so they merge into bundles, and the macro-structure — which modules
// talk to which — leaps out. One knob, the bundling strength β, slides each spline between the straight
// chord (β = 0) and the full tree route (β = 1); here it breathes slowly so you can watch the spaghetti
// gather into cables and fray back. Colour runs along each link from its source group's hue to its
// target's, so a bundle's two ends tell you who is talking to whom. A gentle dome lifts the bundles off
// the ring plane, so orbiting shows them as arches.
const RING = 1.95; // ring radius (render units)

class EdgeBundlingArchetype implements Archetype {
  readonly id = 'edgeBundling';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // control polygons, flattened: link e uses points cpStart[e] … cpStart[e] + cpLen[e] − 1
  private readonly cpx: Float32Array; private readonly cpy: Float32Array;
  private readonly cpStart: Int32Array; private readonly cpLen: Int32Array;
  private readonly pe: Int32Array; private readonly pt: Float32Array; // link point: (link, t); leaf point: −1 − leaf
  private readonly leafX: Float32Array; private readonly leafY: Float32Array;
  private readonly ox: Float32Array; private readonly oy: Float32Array; private readonly oz: Float32Array;
  private beta = 0.9;
  private breathe = 0.5;
  private dome = 0.35;
  private speed = 1;
  private t = 0;
  private lastBeta = -1;
  private lastDome = -1;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);

    // --- a three-level hierarchy laid out radially: groups → subgroups → leaves on the ring ---
    const G = Math.max(3, Math.round(config.params.groups ?? 8));
    const S = 4; // subgroups per group
    const Lf = 6; // leaves per subgroup
    const nLeaves = G * S * Lf;
    const gap = 0.35; // angular gap between groups, in leaf slots
    const slots = nLeaves + G * gap * Lf;
    const leafAng = new Float64Array(nLeaves);
    const leafGroup = new Int32Array(nLeaves), leafSub = new Int32Array(nLeaves);
    let slot = 0, li = 0;
    for (let g = 0; g < G; g++) {
      for (let s = 0; s < S; s++) for (let l = 0; l < Lf; l++, li++) {
        leafAng[li] = ((slot + 0.5) / slots) * Math.PI * 2;
        leafGroup[li] = g; leafSub[li] = g * S + s;
        slot++;
      }
      slot += gap * Lf;
    }
    const meanAng = (idx: number[]): number => {
      let sx = 0, sy = 0;
      for (const i of idx) { sx += Math.cos(leafAng[i]); sy += Math.sin(leafAng[i]); }
      return Math.atan2(sy, sx);
    };
    // internal nodes: subgroups at 0.62·R, groups at 0.3·R, root at the centre (Holten's radial layout)
    const subPos: [number, number][] = [], groupPos: [number, number][] = [];
    for (let k = 0; k < G * S; k++) {
      const a = meanAng([...Array(nLeaves).keys()].filter((i) => leafSub[i] === k));
      subPos.push([Math.cos(a) * RING * 0.62, Math.sin(a) * RING * 0.62]);
    }
    for (let g = 0; g < G; g++) {
      const a = meanAng([...Array(nLeaves).keys()].filter((i) => leafGroup[i] === g));
      groupPos.push([Math.cos(a) * RING * 0.3, Math.sin(a) * RING * 0.3]);
    }
    this.leafX = new Float32Array(nLeaves); this.leafY = new Float32Array(nLeaves);
    for (let i = 0; i < nLeaves; i++) { this.leafX[i] = Math.cos(leafAng[i]) * RING; this.leafY[i] = Math.sin(leafAng[i]) * RING; }

    // --- links with structure: each group talks mostly to two "partner" groups and to itself ---
    const linksPerLeaf = Math.max(1, config.params.links ?? 3);
    const partners = Array.from({ length: G }, (_, g) => [(g + 1 + Math.floor(rng() * (G - 1))) % G, (g + 1 + Math.floor(rng() * (G - 1))) % G]);
    const la: number[] = [], lb: number[] = [];
    for (let i = 0; i < nLeaves; i++) {
      const k = Math.floor(linksPerLeaf) + (rng() < linksPerLeaf % 1 ? 1 : 0);
      for (let n = 0; n < k; n++) {
        const r = rng();
        const g = leafGroup[i];
        const tg = r < 0.2 ? g : r < 0.6 ? partners[g][0] : r < 0.85 ? partners[g][1] : Math.floor(rng() * G);
        const j = tg * S * Lf + Math.floor(rng() * S * Lf);
        if (j !== i) { la.push(i); lb.push(j); }
      }
    }
    const E = la.length;

    // control polygon per link: leaf, sub, [group], [root], [group], sub, leaf — through the lowest common ancestor
    const cp: [number, number][] = [];
    this.cpStart = new Int32Array(E); this.cpLen = new Int32Array(E);
    for (let e = 0; e < E; e++) {
      const a = la[e], b = lb[e];
      const path: [number, number][] = [[this.leafX[a], this.leafY[a]], subPos[leafSub[a]]];
      if (leafSub[a] !== leafSub[b]) {
        if (leafGroup[a] !== leafGroup[b]) path.push(groupPos[leafGroup[a]], [0, 0], groupPos[leafGroup[b]]);
        else path.push(groupPos[leafGroup[a]]);
        path.push(subPos[leafSub[b]]);
      }
      path.push([this.leafX[b], this.leafY[b]]);
      this.cpStart[e] = cp.length; this.cpLen[e] = path.length;
      cp.push(...path);
    }
    this.cpx = Float32Array.from(cp.map((c) => c[0])); this.cpy = Float32Array.from(cp.map((c) => c[1]));

    // --- points: links (density ∝ route length), plus small bright leaf beads on the ring ---
    const hueOf = (g: number): number => g / G; // the ring IS a colour wheel
    const len = new Float64Array(E);
    let Ltot = 0;
    for (let e = 0; e < E; e++) {
      let l = 0;
      for (let k = 1; k < this.cpLen[e]; k++) {
        const i0 = this.cpStart[e] + k - 1, i1 = i0 + 1;
        l += Math.hypot(this.cpx[i1] - this.cpx[i0], this.cpy[i1] - this.cpy[i0]);
      }
      len[e] = l; Ltot += l;
    }
    this.pe = new Int32Array(P); this.pt = new Float32Array(P);
    this.ox = new Float32Array(P); this.oy = new Float32Array(P); this.oz = new Float32Array(P);
    const leafBudget = Math.floor(P * 0.06);
    const linkBudget = P - leafBudget;
    const ca = new Float32Array(3), cb = new Float32Array(3);
    let p = 0;
    for (let e = 0; e < E && p < linkBudget; e++) {
      const n = Math.max(6, Math.round((linkBudget * len[e]) / Ltot));
      hslToRgb(hueOf(leafGroup[la[e]]), 0.85, 0.55, ca, 0);
      hslToRgb(hueOf(leafGroup[lb[e]]), 0.85, 0.55, cb, 0);
      for (let s = 0; s < n && p < linkBudget; s++, p++) {
        const tt = s / (n - 1);
        this.pe[p] = e; this.pt[p] = tt;
        for (let k = 0; k < 3; k++) this.colors[p * 3 + k] = (ca[k] * (1 - tt) + cb[k] * tt) * 0.55;
      }
    }
    const perLeaf = Math.max(2, Math.floor((P - p) / nLeaves));
    for (let i = 0; i < nLeaves && p < P; i++) {
      hslToRgb(hueOf(leafGroup[i]), 0.7, 0.7, ca, 0);
      for (let s = 0; s < perLeaf && p < P; s++, p++) {
        const u = rng() * 2 - 1, th = rng() * 6.2831853, rr = 0.028 * Math.cbrt(rng()), ss = Math.sqrt(1 - u * u) * rr;
        this.pe[p] = -1 - i;
        this.ox[p] = ss * Math.cos(th); this.oy[p] = ss * Math.sin(th); this.oz[p] = u * rr;
        this.colors[p * 3] = ca[0] * 1.3; this.colors[p * 3 + 1] = ca[1] * 1.3; this.colors[p * 3 + 2] = ca[2] * 1.3;
      }
    }
    for (; p < P; p++) this.pe[p] = -1;
    this.readParams(config.params);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.beta = p.beta ?? 0.9;
    this.breathe = p.breathe ?? 0.5;
    this.dome = p.dome ?? 0.35;
    this.speed = p.speed ?? 1;
  }

  // β now: the knob, swung down toward straight chords and back by the breathing (period ~14 s)
  private currentBeta(): number {
    const b = this.beta - this.breathe * this.beta * 0.5 * (1 - Math.cos((this.t * 2 * Math.PI) / 14));
    return Math.min(1, Math.max(0, b));
  }

  private syncPositions(): void {
    const beta = this.currentBeta();
    if (Math.abs(beta - this.lastBeta) < 1e-5 && this.dome === this.lastDome) return; // nothing moved
    this.lastBeta = beta; this.lastDome = this.dome;
    const pos = this.positions, { cpx, cpy } = this;
    const qx = new Float64Array(16), qy = new Float64Array(16);
    let curE = -1, nq = 0;
    for (let p = 0; p < this.particleCount; p++) {
      const e = this.pe[p];
      let X: number, Y: number;
      if (e >= 0) {
        if (e !== curE) {
          // straighten the control polygon toward the chord (Holten's β), then clamp the ends (triple them)
          curE = e;
          const s0 = this.cpStart[e], n = this.cpLen[e];
          const x0 = cpx[s0], y0 = cpy[s0], x1 = cpx[s0 + n - 1], y1 = cpy[s0 + n - 1];
          nq = 0;
          for (let k = 0; k < n; k++) {
            const f = k / (n - 1);
            const sx = beta * cpx[s0 + k] + (1 - beta) * (x0 + f * (x1 - x0));
            const sy = beta * cpy[s0 + k] + (1 - beta) * (y0 + f * (y1 - y0));
            const rep = k === 0 || k === n - 1 ? 3 : 1;
            for (let r = 0; r < rep; r++) { qx[nq] = sx; qy[nq] = sy; nq++; }
          }
        }
        // uniform cubic B-spline over the clamped polygon
        const segs = nq - 3;
        const u = this.pt[p] * segs;
        const j = Math.min(segs - 1, Math.floor(u)), s = u - j;
        const s2 = s * s, s3 = s2 * s;
        const b0 = (1 - 3 * s + 3 * s2 - s3) / 6, b1 = (4 - 6 * s2 + 3 * s3) / 6, b2 = (1 + 3 * s + 3 * s2 - 3 * s3) / 6, b3 = s3 / 6;
        X = b0 * qx[j] + b1 * qx[j + 1] + b2 * qx[j + 2] + b3 * qx[j + 3];
        Y = b0 * qy[j] + b1 * qy[j + 1] + b2 * qy[j + 2] + b3 * qy[j + 3];
        const r2 = (X * X + Y * Y) / (RING * RING);
        const o = p * 3;
        pos[o] = X; pos[o + 1] = Y; pos[o + 2] = this.dome * (1 - Math.min(1, r2)); // bundles arch toward the viewer
      } else {
        const i = -1 - e;
        const o = p * 3;
        pos[o] = this.leafX[i] + this.ox[p]; pos[o + 1] = this.leafY[i] + this.oy[p]; pos[o + 2] = this.oz[p];
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt * this.speed;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.lastBeta = -1; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'links routed through the hierarchy and bundled', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const edgeBundlingFactory: ArchetypeFactory = {
  id: 'edgeBundling',
  label: 'Edge Bundling',
  category: 'Network',
  kind: 'flow',
  params: [
    { key: 'beta', label: 'bundling β', min: 0, max: 1, step: 0.01, default: 0.9 },
    { key: 'breathe', label: 'breathe', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'groups', label: 'groups', min: 3, max: 14, step: 1, default: 8, rebuild: true },
    { key: 'links', label: 'links per node', min: 1, max: 6, step: 0.5, default: 3, rebuild: true },
    { key: 'dome', label: 'dome', min: 0, max: 1.2, step: 0.05, default: 0.35 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 160_000,
  particleCountOptions: [80_000, 160_000, 240_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.4,
  create: (config) => new EdgeBundlingArchetype(config),
};

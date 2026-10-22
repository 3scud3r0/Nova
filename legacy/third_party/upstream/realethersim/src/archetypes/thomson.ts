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

// Thomson Network — how N equal charges arrange themselves on a sphere. J. J. Thomson asked it in 1904
// (as a model of the atom): put N electrons on a sphere, let them repel by Coulomb's law, and find the
// arrangement of least energy. Small N give the Platonic-looking answers (4 → tetrahedron, 6 → octahedron,
// 12 → icosahedron); large N give an almost-hexagonal net — but a sphere CANNOT be tiled by hexagons alone.
// Euler's formula forces the network of nearest neighbours to carry a net topological charge: summed over
// all charges, (6 − neighbours) = 12. So there are always at least twelve 5-fold "disclinations" (red), and
// past a few hundred charges they sprout 7-fold partners (green) and string out into "scars" — the same
// physics as virus capsids, colloidal armour on droplets, and fullerenes. Here: relax the charges
// (projected gradient descent of the Coulomb energy), triangulate them (the convex hull of points on a
// sphere IS their Delaunay network), colour each by its number of neighbours, and draw the links as
// great-circle arcs. A little thermal jiggle and a slow spin keep it alive.
const R = 1.65; // sphere radius in render units

// Convex hull of points on a sphere (all are extreme): incremental, O(N²) — fine for N ≲ 2000.
// Returns, for each point, its sorted neighbour list (the Delaunay network).
export function sphereNetwork(px: Float64Array, py: Float64Array, pz: Float64Array): number[][] {
  const N = px.length;
  type Face = [number, number, number];
  const faces: (Face | null)[] = [];
  const normal = (f: Face): [number, number, number, number] => {
    const [a, b, c] = f;
    const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a];
    const vx = px[c] - px[a], vy = py[c] - py[a], vz = pz[c] - pz[a];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return [nx, ny, nz, nx * px[a] + ny * py[a] + nz * pz[a]];
  };
  const visible = (f: Face, i: number): boolean => {
    const [nx, ny, nz, d] = normal(f);
    return nx * px[i] + ny * py[i] + nz * pz[i] - d > 1e-12;
  };
  // start from a tetrahedron on four well-separated points, faces oriented outward
  const start = [0, 1, 2, 3];
  {
    let best = -1;
    for (let j = 2; j < N; j++) { // third point farthest from the 0–1 line, fourth farthest from that plane
      const t: Face = [0, 1, j];
      const [nx, ny, nz] = normal(t);
      const m = nx * nx + ny * ny + nz * nz;
      if (m > best) { best = m; start[2] = j; }
    }
    best = -1;
    const base: Face = [start[0], start[1], start[2]];
    const [nx, ny, nz, d] = normal(base);
    for (let j = 2; j < N; j++) {
      if (j === start[2]) continue;
      const h = Math.abs(nx * px[j] + ny * py[j] + nz * pz[j] - d);
      if (h > best) { best = h; start[3] = j; }
    }
  }
  const [a0, b0, c0, d0] = start;
  const tet: Face[] = [[a0, b0, c0], [a0, c0, d0], [a0, d0, b0], [b0, d0, c0]];
  for (const f of tet) faces.push(visible(f, tet.flat().find((v) => !f.includes(v))!) ? [f[0], f[2], f[1]] : f);
  const inStart = new Set(start);
  for (let i = 0; i < N; i++) {
    if (inStart.has(i)) continue;
    const vis: number[] = [];
    for (let k = 0; k < faces.length; k++) { const f = faces[k]; if (f && visible(f, i)) vis.push(k); }
    if (!vis.length) continue; // (numerically inside — can't happen for points on a sphere)
    // horizon: directed edges of visible faces whose reverse edge isn't on a visible face
    const edgeSet = new Set<string>();
    for (const k of vis) { const [a, b, c] = faces[k]!; edgeSet.add(`${a},${b}`); edgeSet.add(`${b},${c}`); edgeSet.add(`${c},${a}`); }
    const horizon: [number, number][] = [];
    for (const k of vis) {
      const [a, b, c] = faces[k]!;
      for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) if (!edgeSet.has(`${v},${u}`)) horizon.push([u, v]);
    }
    for (const k of vis) faces[k] = null;
    for (const [u, v] of horizon) faces.push([u, v, i]);
  }
  const nb: Set<number>[] = Array.from({ length: N }, () => new Set<number>());
  for (const f of faces) {
    if (!f) continue;
    const [a, b, c] = f;
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  return nb.map((s) => [...s].sort((x, y) => x - y));
}

// Projected gradient descent of the Coulomb energy Σ 1/|xᵢ−xⱼ| on the unit sphere.
function relaxCharges(x: Float64Array, y: Float64Array, z: Float64Array, iters: number): void {
  const N = x.length;
  const fx = new Float64Array(N), fy = new Float64Array(N), fz = new Float64Array(N);
  const a = Math.sqrt(8 * Math.PI / (Math.sqrt(3) * N)); // typical neighbour spacing
  for (let it = 0; it < iters; it++) {
    fx.fill(0); fy.fill(0); fz.fill(0);
    for (let i = 0; i < N; i++) {
      const xi = x[i], yi = y[i], zi = z[i];
      let ax = 0, ay = 0, az = 0;
      for (let j = i + 1; j < N; j++) {
        const rx = xi - x[j], ry = yi - y[j], rz = zi - z[j];
        const d2 = rx * rx + ry * ry + rz * rz + 1e-12;
        const f = 1 / (d2 * Math.sqrt(d2));
        ax += rx * f; ay += ry * f; az += rz * f;
        fx[j] -= rx * f; fy[j] -= ry * f; fz[j] -= rz * f;
      }
      fx[i] += ax; fy[i] += ay; fz[i] += az;
    }
    // step size: move at most a fraction of a neighbour spacing, shrinking as it converges
    const step = a * (0.12 * (1 - it / iters) + 0.01);
    let fmax = 0;
    for (let i = 0; i < N; i++) {
      const dot = fx[i] * x[i] + fy[i] * y[i] + fz[i] * z[i]; // drop the radial part: stay on the sphere
      fx[i] -= dot * x[i]; fy[i] -= dot * y[i]; fz[i] -= dot * z[i];
      fmax = Math.max(fmax, Math.hypot(fx[i], fy[i], fz[i]));
    }
    const k = step / (fmax + 1e-12);
    for (let i = 0; i < N; i++) {
      x[i] += fx[i] * k; y[i] += fy[i] * k; z[i] += fz[i] * k;
      const r = Math.hypot(x[i], y[i], z[i]);
      x[i] /= r; y[i] /= r; z[i] /= r;
    }
  }
}

class ThomsonArchetype implements Archetype {
  readonly id = 'thomson';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly N: number;
  private readonly hx: Float64Array; private readonly hy: Float64Array; private readonly hz: Float64Array; // ground state
  private readonly jx: Float64Array; private readonly jy: Float64Array; private readonly jz: Float64Array; // thermal offsets
  private readonly x: Float64Array; private readonly y: Float64Array; private readonly z: Float64Array; // drawn
  private readonly ea: Int32Array; private readonly eb: Int32Array;
  private readonly pe: Int32Array; private readonly pt: Float32Array; // edge point: (edge, t); node point: −1 − node
  private readonly ox: Float32Array; private readonly oy: Float32Array; private readonly oz: Float32Array;
  private readonly spacing: number;
  private readonly rng: () => number;
  private jiggle = 0.12;
  private spin = 0.5;
  private speed = 1;
  private t = 0;
  readonly defects: { five: number; seven: number; other: number; charge: number };

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    this.rng = rng;
    const N = Math.max(12, Math.round(config.params.charges ?? 400));
    this.N = N;

    // random start, then relax to (a local minimum of) the Thomson problem
    const hx = new Float64Array(N), hy = new Float64Array(N), hz = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const u = rng() * 2 - 1, th = rng() * 6.2831853, s = Math.sqrt(1 - u * u);
      hx[i] = s * Math.cos(th); hy[i] = u; hz[i] = s * Math.sin(th);
    }
    relaxCharges(hx, hy, hz, N < 300 ? 1400 : 500); // small N: settle fully (the "magic" icosahedral N reach 12 clean five-folds)
    this.hx = hx; this.hy = hy; this.hz = hz;
    this.spacing = Math.sqrt(8 * Math.PI / (Math.sqrt(3) * N));

    // the Delaunay network and each charge's coordination number
    const nb = sphereNetwork(hx, hy, hz);
    const zc = nb.map((l) => l.length);
    let five = 0, seven = 0, other = 0, charge = 0;
    for (const c of zc) { charge += 6 - c; if (c === 5) five++; else if (c === 7) seven++; else if (c !== 6) other++; }
    this.defects = { five, seven, other, charge };
    const ea: number[] = [], eb: number[] = [];
    for (let i = 0; i < N; i++) for (const j of nb[i]) if (j > i) { ea.push(i); eb.push(j); }
    this.ea = Int32Array.from(ea); this.eb = Int32Array.from(eb);
    const E = ea.length;

    this.jx = new Float64Array(N); this.jy = new Float64Array(N); this.jz = new Float64Array(N);
    this.x = new Float64Array(N); this.y = new Float64Array(N); this.z = new Float64Array(N);

    // colours by coordination: 5 = hot red-orange, 6 = cool blue, 7 = green-gold, else magenta
    const tone = (c: number, out: Float32Array, o: number, l: number): void => {
      if (c === 6) hslToRgb(0.58, 0.75, l * 0.85, out, o);
      else if (c === 5) hslToRgb(0.02, 0.95, l, out, o);
      else if (c === 7) hslToRgb(0.3, 0.9, l, out, o);
      else hslToRgb(0.85, 0.85, l, out, o);
    };

    // points: arcs (density ∝ length) + node balls (defects bigger)
    this.pe = new Int32Array(P); this.pt = new Float32Array(P);
    this.ox = new Float32Array(P); this.oy = new Float32Array(P); this.oz = new Float32Array(P);
    const nodeBudget = Math.floor(P * 0.3);
    const edgeBudget = P - nodeBudget;
    const per = Math.max(3, Math.floor(edgeBudget / Math.max(1, E)));
    let p = 0;
    const ca = new Float32Array(3), cb = new Float32Array(3);
    for (let e = 0; e < E && p < edgeBudget; e++) {
      const a = this.ea[e], b = this.eb[e];
      tone(zc[a], ca, 0, 0.42); tone(zc[b], cb, 0, 0.42);
      for (let s = 0; s < per && p < edgeBudget; s++, p++) {
        const tt = s / (per - 1);
        this.pe[p] = e; this.pt[p] = tt;
        for (let k = 0; k < 3; k++) this.colors[p * 3 + k] = (ca[k] * (1 - tt) + cb[k] * tt) * 0.8;
      }
    }
    const weight = (c: number): number => (c === 6 ? 1 : 3.2); // defects get more (brighter, bigger) points
    let wsum = 0;
    for (let i = 0; i < N; i++) wsum += weight(zc[i]);
    for (let i = 0; i < N && p < P; i++) {
      const share = Math.max(2, Math.round((nodeBudget * weight(zc[i])) / wsum));
      const rad = (zc[i] === 6 ? 0.018 : 0.034) * Math.sqrt(400 / N);
      tone(zc[i], ca, 0, zc[i] === 6 ? 0.58 : 0.6);
      for (let s = 0; s < share && p < P; s++, p++) {
        const u = rng() * 2 - 1, th = rng() * 6.2831853, rr = rad * Math.cbrt(rng()), ss = Math.sqrt(1 - u * u) * rr;
        this.pe[p] = -1 - i;
        this.ox[p] = ss * Math.cos(th); this.oy[p] = u * rr; this.oz[p] = ss * Math.sin(th);
        const boost = zc[i] === 6 ? 1.1 : 1.6;
        this.colors[p * 3] = ca[0] * boost; this.colors[p * 3 + 1] = ca[1] * boost; this.colors[p * 3 + 2] = ca[2] * boost;
      }
    }
    for (; p < P; p++) this.pe[p] = -1; // spares: black, inside node 0's ball
    this.readParams(config.params);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.jiggle = p.jiggle ?? 0.12;
    this.spin = p.spin ?? 0.5;
    this.speed = p.speed ?? 1;
  }

  // Thermal jiggle: each charge does an Ornstein–Uhlenbeck walk around its ground-state site.
  private jiggleStep(h: number): void {
    const { N, rng } = this;
    const theta = 2.5, sigma = this.jiggle * this.spacing * Math.sqrt(2 * theta);
    const decay = Math.exp(-theta * h), kick = sigma * Math.sqrt(h);
    for (let i = 0; i < N; i++) {
      const g = (): number => (rng() + rng() + rng() - 1.5) * 2; // ~unit-variance, cheap
      this.jx[i] = this.jx[i] * decay + kick * g();
      this.jy[i] = this.jy[i] * decay + kick * g();
      this.jz[i] = this.jz[i] * decay + kick * g();
    }
  }

  private syncPositions(): void {
    const { N, x, y, z } = this;
    for (let i = 0; i < N; i++) {
      const X = this.hx[i] + this.jx[i], Y = this.hy[i] + this.jy[i], Z = this.hz[i] + this.jz[i];
      const r = Math.hypot(X, Y, Z) || 1;
      x[i] = X / r; y[i] = Y / r; z[i] = Z / r;
    }
    const ang = this.t * this.spin * 0.15;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const pos = this.positions;
    for (let p = 0; p < this.particleCount; p++) {
      const e = this.pe[p];
      let X: number, Y: number, Z: number;
      if (e >= 0) {
        // great-circle arc: normalised chord (close enough to slerp for neighbour-length arcs)
        const a = this.ea[e], b = this.eb[e], t = this.pt[p];
        X = x[a] + (x[b] - x[a]) * t; Y = y[a] + (y[b] - y[a]) * t; Z = z[a] + (z[b] - z[a]) * t;
        const r = Math.hypot(X, Y, Z) || 1;
        X = (X / r) * R; Y = (Y / r) * R; Z = (Z / r) * R;
      } else {
        const i = -1 - e;
        X = x[i] * R + this.ox[p]; Y = y[i] * R + this.oy[p]; Z = z[i] * R + this.oz[p];
      }
      const o = p * 3;
      pos[o] = X * ca + Z * sa;
      pos[o + 1] = Y;
      pos[o + 2] = -X * sa + Z * ca;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const h = dt * this.speed;
    if (h > 0) {
      this.t += h;
      this.jiggleStep(h);
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const N = this.N, s = new Float64Array(1 + 3 * N);
    s[0] = this.t; s.set(this.jx, 1); s.set(this.jy, 1 + N); s.set(this.jz, 1 + 2 * N);
    return s;
  }
  loadState(s: Float64Array): void {
    const N = this.N;
    if (s.length !== 1 + 3 * N) return;
    this.t = s[0]; this.jx.set(s.subarray(1, 1 + N)); this.jy.set(s.subarray(1 + N, 1 + 2 * N)); this.jz.set(s.subarray(1 + 2 * N));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const d = this.defects;
    return [{ id: 'root', parentId: null, label: `${this.N} charges · ${d.five} five-fold, ${d.seven} seven-fold · net charge ${d.charge}`, stateOffset: 0, stateLength: 1 + 3 * this.N }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const thomsonFactory: ArchetypeFactory = {
  id: 'thomson',
  label: 'Thomson Network',
  category: 'Network',
  kind: 'flow',
  params: [
    { key: 'charges', label: 'charges N', min: 12, max: 900, step: 1, default: 400, rebuild: true },
    { key: 'jiggle', label: 'thermal jiggle', min: 0, max: 0.4, step: 0.01, default: 0.12 },
    { key: 'spin', label: 'spin', min: 0, max: 3, step: 0.05, default: 0.5 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 160_000,
  particleCountOptions: [80_000, 160_000, 240_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new ThomsonArchetype(config),
};

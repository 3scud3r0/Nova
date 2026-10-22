import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Penrose Tiling — order without repetition. In 1974 Roger Penrose found a pair of tiles (a fat and a
// thin rhombus) that cover the plane ONLY aperiodically: the pattern never repeats, yet it is far from
// random — it has perfect five-fold symmetry and a rigid long-range order, and any finite patch recurs
// infinitely often. Once thought impossible, this "forbidden" 5-fold order turned out to be real:
// in 1982 Dan Shechtman found actual crystals built this way (quasicrystals), a discovery that won the
// 2011 Nobel Prize. We build the tiling by de Bruijn's beautiful trick: overlay five families of
// equally-spaced parallel lines at 72° to each other (a "pentagrid"); every intersection of two lines
// becomes one rhombus, and the whole Penrose tiling falls out as the grid's dual. Rhombi are drawn as
// glowing edges — fat ones warm, thin ones cool — so the ten-fold rosettes and the endless
// non-repeating weave read directly. Bounded. (Penrose 1974; de Bruijn 1981; Shechtman 1982.)
const TAU = Math.PI * 2;
const SCALE = 0.46; // tiling-space → render units
const KEEP = 2.55; // keep rhombi whose centre lies within this render radius (a filled disk)
const M = 12; // pentagrid line-index half-range

class PenroseArchetype implements Archetype {
  readonly id = 'penrose';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly bx: Float64Array; private readonly by: Float64Array; // baked edge-point positions
  private speed = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const rng = mulberry32((config.seed ^ 0x85ebca6b) >>> 0);
    // five grid directions at 72°, and offsets γₖ (near-equal → a centred decagonal rosette; perturbed
    // so no three lines meet at a point, keeping every intersection a clean single rhombus)
    const e: [number, number][] = [];
    for (let k = 0; k < 5; k++) e.push([Math.cos((TAU * k) / 5), Math.sin((TAU * k) / 5)]);
    const gamma = [0.2, 0.2, 0.2, 0.2, 0.2].map((g, k) => g + (k - 2) * 0.0123);

    // de Bruijn dual: each pair of pentagrid lines (k,i)×(l,j) → one rhombus
    const rh: { corners: [number, number][]; thin: boolean }[] = [];
    const seen = new Set<string>();
    for (let k = 0; k < 5; k++) {
      for (let l = k + 1; l < 5; l++) {
        const det = e[k][0] * e[l][1] - e[k][1] * e[l][0];
        const thin = l - k === 1 || l - k === 4; // 36° rhombus (thin) vs 72° (fat)
        for (let i = -M; i <= M; i++) {
          for (let j = -M; j <= M; j++) {
            const a = i - gamma[k], b = j - gamma[l];
            const rx = (a * e[l][1] - b * e[k][1]) / det;
            const ry = (b * e[k][0] - a * e[l][0]) / det;
            // offset O = Σ_{m≠k,l} floor(eₘ·r + γₘ)·eₘ
            let ox = 0, oy = 0;
            for (let m = 0; m < 5; m++) {
              if (m === k || m === l) continue;
              const km = Math.floor(e[m][0] * rx + e[m][1] * ry + gamma[m]);
              ox += km * e[m][0]; oy += km * e[m][1];
            }
            // four rhombus corners, spanned by eₖ and e_l
            const corners: [number, number][] = [
              [ox + (i - 1) * e[k][0] + (j - 1) * e[l][0], oy + (i - 1) * e[k][1] + (j - 1) * e[l][1]],
              [ox + i * e[k][0] + (j - 1) * e[l][0], oy + i * e[k][1] + (j - 1) * e[l][1]],
              [ox + i * e[k][0] + j * e[l][0], oy + i * e[k][1] + j * e[l][1]],
              [ox + (i - 1) * e[k][0] + j * e[l][0], oy + (i - 1) * e[k][1] + j * e[l][1]],
            ];
            const cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
            const cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
            if (Math.hypot(cx, cy) * SCALE > KEEP) continue;
            const key = `${Math.round(cx * 64)},${Math.round(cy * 64)}`;
            if (seen.has(key)) continue; // dedupe rhombi at symmetric vertices
            seen.add(key);
            rh.push({ corners, thin });
          }
        }
      }
    }

    // Respect the requested budget so the archetype's particleCount matches what the driver (main +
    // worker) was told — a mismatch stalls the SharedArrayBuffer handshake and hangs the render loop.
    const N = Math.max(2048, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.bx = new Float64Array(N); this.by = new Float64Array(N);
    const perEdge = Math.max(4, Math.floor(N / Math.max(1, rh.length * 4))); // spread the budget over the edges
    let idx = 0;
    for (const r of rh) {
      // fat rhombi warm amber, thin rhombi cool cyan (bright for bloom on the thin edges)
      const cr = r.thin ? 0.45 : 2.8, cg = r.thin ? 1.7 : 1.35, cb = r.thin ? 2.8 : 0.45;
      for (let edge = 0; edge < 4; edge++) {
        const A = r.corners[edge], B = r.corners[(edge + 1) % 4];
        for (let p = 0; p < perEdge && idx < N; p++, idx++) {
          const f = p / perEdge;
          this.bx[idx] = (A[0] + (B[0] - A[0]) * f) * SCALE;
          this.by[idx] = (A[1] + (B[1] - A[1]) * f) * SCALE;
          const o = idx * 3, j = 0.8 + 0.4 * rng();
          this.colors[o] = cr * j; this.colors[o + 1] = cg * j; this.colors[o + 2] = cb * j;
        }
      }
    }
    // any leftover budget parks off-frame with colour 0 (invisible)
    while (idx < N) { this.bx[idx] = 0; this.by[idx] = -46; idx++; }
    this.readParams(config.params);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.speed = p.speed ?? 1;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const ang = this.t * this.speed * 0.06; // slow rotation for life
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < this.particleCount; i++) {
      const x = this.bx[i], y = this.by[i];
      const o = i * 3;
      pos[o] = x * ca - y * sa;
      pos[o + 1] = x * sa + y * ca;
      pos[o + 2] = 0;
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
    return [{ id: 'root', parentId: null, label: 'Penrose tiling (de Bruijn pentagrid)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const penroseFactory: ArchetypeFactory = {
  id: 'penrose',
  label: 'Penrose Tiling',
  category: 'Tiling',
  kind: 'flow',
  params: [
    { key: 'speed', label: 'rotation', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [120_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new PenroseArchetype(config),
};

import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';
import { mulberry32, type Rng } from '../state/rng';

// Polynomial Root Cloud (after Simone Conradi's "40,000,000 polynomial roots"). Sample many random
// polynomials whose coefficients come from a tiny set — Littlewood (±1) or Bohemian ({−1,0,1}) — find
// ALL of each one's complex roots with the Durand–Kerner (Weierstrass) method, and scatter them in the
// complex plane. The ensemble draws the famous fractal "feather" hugging the unit circle |z|=1, riddled
// with holes at the roots of unity. One-shot: roots are computed in the constructor and coloured once
// (by ring-proximity + local density → deep purple field, orange filaments, white-hot ring). A small
// density relief lifts the ring out of the plane so it's orbitable, not a flat wafer.
const TAU = Math.PI * 2;
const SCALE = 1.5; // complex-plane → render units (|z|≈1.3 fits in ~2 units)
const GRID = 320; // density-histogram resolution
const SPAN = 1.7; // half-extent of the histogram / clip window in z-units

class PolynomialRootsArchetype implements Archetype {
  readonly kind = 'flow' as const;
  readonly id = 'polynomialRoots';
  readonly particleCount: number;

  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly re: Float64Array; // root real parts (render-plane x)
  private readonly im: Float64Array; // root imag parts (render-plane y)
  private readonly lift: Float64Array; // per-root density relief (z), normalised 0..1
  private readonly jz: Float64Array; // per-root fixed unit jitter (−0.5..0.5), baked once at build
  private readonly rng: Rng;
  private relief = 0.18;
  private jitter = 0.012;
  private nRoots = 0;

  constructor(config: ArchetypeConfig) {
    const n = config.particleCount;
    this.particleCount = n;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.lift = new Float64Array(n);
    this.jz = new Float64Array(n);
    this.rng = mulberry32(config.seed);
    this.relief = config.params.relief ?? 0.18;
    this.jitter = config.params.jitter ?? 0.012;
    this.build(config.params);
  }

  // Generate K = floor(N/d) random polynomials, solve each, accumulate roots, colour once.
  private build(p: ResolvedParams): void {
    const d = Math.max(2, Math.min(40, Math.round(p.degree ?? 24)));
    const bohemian = (p.coeffFamily ?? 0) >= 0.5;
    const N = this.particleCount;
    const K = Math.max(1, Math.floor(N / d));
    const re = this.re;
    const im = this.im;
    const rng = this.rng;

    // scratch for one polynomial's coefficients + its root estimates (reused across polys, no GC churn)
    const coeff = new Float64Array(d + 1);
    const zr = new Float64Array(d);
    const zi = new Float64Array(d);

    let w = 0; // write cursor into re/im
    for (let s = 0; s < K; s++) {
      // sample coefficients; leading coeff forced non-zero so the degree (and root count) is exactly d
      for (let k = 0; k <= d; k++) {
        coeff[k] = bohemian ? (((rng() * 3) | 0) - 1) : (rng() < 0.5 ? -1 : 1);
      }
      if (coeff[d] === 0) coeff[d] = rng() < 0.5 ? -1 : 1;
      this.durandKerner(coeff, d, zr, zi);
      for (let k = 0; k < d && w < N; k++, w++) {
        re[w] = zr[k];
        im[w] = zi[k];
      }
    }
    this.nRoots = w;

    // density histogram (counts roots per cell) → drives both colour and the relief height
    const dens = new Float32Array(GRID * GRID);
    const toCell = (v: number): number => Math.max(0, Math.min(GRID - 1, ((v / SPAN) * 0.5 + 0.5) * GRID | 0));
    let dmax = 1;
    for (let i = 0; i < w; i++) {
      if (Math.abs(re[i]) > SPAN || Math.abs(im[i]) > SPAN) continue;
      const c = toCell(im[i]) * GRID + toCell(re[i]);
      dens[c] += 1;
      if (dens[c] > dmax) dmax = dens[c];
    }
    const ldmax = Math.log(dmax + 1);
    const col = this.colors;
    const lift = this.lift;
    const jz = this.jz;
    for (let i = 0; i < w; i++) {
      const r = Math.hypot(re[i], im[i]);
      const ring = Math.exp(-Math.abs(r - 1) * 4); // 1 on the unit circle → 0 away from it
      const inBox = Math.abs(re[i]) <= SPAN && Math.abs(im[i]) <= SPAN;
      const dn = inBox ? Math.log(dens[toCell(im[i]) * GRID + toCell(re[i])] + 1) / ldmax : 0; // 0..1 local density
      lift[i] = dn; // relief height
      jz[i] = rng() - 0.5; // fixed per-root jitter (baked once → no per-frame buzz)
      // hue sweeps purple → magenta → orange (wrapping past 1.0) as ring-proximity + density rise; kept
      // saturated so the colour reads, moderate luminance so only the densest ridge blows to white (additive)
      const heat = Math.min(1, 0.5 * ring + 0.8 * dn);
      const hue = (0.75 + 0.33 * heat) % 1; // 0.75 (purple) → 0.85 (magenta) → 0.08 (orange)
      const sat = 0.92 - 0.32 * heat; // stays vivid; mild desaturation only at the hottest
      const lum = 0.4 + 0.45 * heat; // bright enough to read at thumbnail scale; ring blows to white (additive)
      hslToRgb(hue, sat, lum, col, i * 3);
    }
    // hide any unused tail (when N isn't an exact multiple of d) below the camera
    for (let i = w; i < N; i++) {
      col[i * 3] = 0;
      col[i * 3 + 1] = 0;
      col[i * 3 + 2] = 0;
    }
    this.syncPositions();
  }

  // Durand–Kerner / Weierstrass: find all d roots of the monic-normalised polynomial simultaneously.
  private durandKerner(coeff: Float64Array, d: number, zr: Float64Array, zi: Float64Array): void {
    const lead = coeff[d];
    // monic-normalised real coeffs a[k] = coeff[k]/lead (a[d] = 1)
    const a = new Float64Array(d + 1);
    for (let k = 0; k <= d; k++) a[k] = coeff[k] / lead;
    // seed guesses on a circle of radius ~1 (Littlewood/Bohemian roots cluster near |z|=1); the 0.4 rad
    // offset keeps any two seeds from coinciding (which would zero the Weierstrass denominator)
    for (let i = 0; i < d; i++) {
      const ang = (TAU * i) / d + 0.4;
      zr[i] = Math.cos(ang);
      zi[i] = Math.sin(ang);
    }
    const MAXIT = 50;
    const TOL = 1e-9;
    for (let it = 0; it < MAXIT; it++) {
      let maxDelta = 0;
      for (let i = 0; i < d; i++) {
        const xr = zr[i];
        const xi = zi[i];
        // p(x) by complex Horner (real coeffs, complex x)
        let pr = a[d];
        let pi = 0;
        for (let k = d - 1; k >= 0; k--) {
          const npr = pr * xr - pi * xi + a[k];
          pi = pr * xi + pi * xr;
          pr = npr;
        }
        // denom = Π_{j≠i} (x − z_j)
        let dr = 1;
        let di = 0;
        for (let j = 0; j < d; j++) {
          if (j === i) continue;
          const er = xr - zr[j];
          const ei = xi - zi[j];
          const ndr = dr * er - di * ei;
          di = dr * ei + di * er;
          dr = ndr;
        }
        const dmag = dr * dr + di * di;
        if (dmag < 1e-30) continue; // two estimates momentarily coincide → skip this correction
        // correction = p(x) / denom
        const cr = (pr * dr + pi * di) / dmag;
        const ci = (pi * dr - pr * di) / dmag;
        zr[i] = xr - cr;
        zi[i] = xi - ci;
        const dl = cr * cr + ci * ci;
        if (dl > maxDelta) maxDelta = dl;
      }
      if (maxDelta < TOL * TOL) break;
    }
  }

  private syncPositions(): void {
    const pos = this.positions;
    const re = this.re;
    const im = this.im;
    const lift = this.lift;
    const jz = this.jz;
    const relief = this.relief;
    const jitter = this.jitter;
    for (let i = 0; i < this.nRoots; i++) {
      const o = i * 3;
      pos[o] = re[i] * SCALE;
      pos[o + 1] = im[i] * SCALE;
      pos[o + 2] = lift[i] * relief + jz[i] * jitter; // density ridge + thin (fixed) thickness
    }
    for (let i = this.nRoots; i < this.particleCount; i++) {
      const o = i * 3;
      pos[o] = 0;
      pos[o + 1] = -30; // park unused tail off-screen below
      pos[o + 2] = 0;
    }
  }

  step(_dt: number, p: ResolvedParams): void {
    // static cloud — just re-apply the live relief/jitter (no root recompute; rebuild handled by the engine on rebuild-params)
    this.relief = p.relief ?? this.relief;
    this.jitter = p.jitter ?? this.jitter;
    this.syncPositions();
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return new Float64Array([this.nRoots]);
  }
  loadState(_s: Float64Array): void {
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Polynomial roots (${this.nRoots})`, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.015 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const polynomialRootsFactory: ArchetypeFactory = {
  id: 'polynomialRoots',
  label: 'Polynomial Root Cloud',
  category: 'Sampler',
  kind: 'flow',
  params: [
    { key: 'degree', label: 'degree', min: 4, max: 32, step: 1, default: 24, rebuild: true },
    { key: 'coeffFamily', label: 'coeffs', min: 0, max: 1, step: 1, default: 0, rebuild: true, options: { 'Littlewood ±1': 0, 'Bohemian -1,0,1': 1 } },
    { key: 'relief', label: 'relief', min: 0, max: 0.6, step: 0.02, default: 0.18 },
    { key: 'jitter', label: 'thickness', min: 0, max: 0.05, step: 0.005, default: 0.012 },
  ],
  defaultParticleCount: 90_000,
  particleCountOptions: [40_000, 90_000, 250_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the static root cloud IS the visual
  create: (config) => new PolynomialRootsArchetype(config),
};

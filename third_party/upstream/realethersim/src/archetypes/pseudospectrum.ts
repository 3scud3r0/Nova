import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';
import { hslToRgb } from '../core/color';

// Pseudospectral landscape. Eigenvalues are only the bait: for a NON-NORMAL matrix the real story is
// the pseudospectrum — how close zI−A comes to singular across the whole complex plane, measured by the
// smallest singular value σ_min(zI−A) (the resolvent norm is 1/σ_min). We render the height field
// h(z) = −log₁₀ σ_min over ℂ: it spikes to infinity at the true eigenvalues (the bright peaks) and
// swells into broad "continents" of near-instability around a strongly non-normal matrix. For a 2×2
// upper-triangular A = [[a, g],[0, d]] (eigenvalues a, d; off-diagonal g = non-normality) σ_min is
// closed-form, so the whole grid is exact and cheap. Bounded by construction (h is capped).
const EXTENT = 1.45; // render half-width of the plane (x,z) — tight so the cones dominate, not the flat skirt
const R = 1.55; // complex-plane half-width sampled (eigenvalues sit near ±0.85)
const HMAX = 3.6; // resolvent-norm height cap so the eigenvalue cones stay finite

const PARAM_SPEC: ParamSpec[] = [
  { key: 'matrix', label: 'matrix', min: 1, max: 200, step: 1, default: 5, rebuild: true }, // seed: eigenvalue layout
  { key: 'nonNormal', label: 'non-normality', min: 0, max: 3, step: 0.05, default: 1.3 }, // |g| — continent spread
  { key: 'relief', label: 'relief', min: 0.1, max: 1.2, step: 0.02, default: 0.7 },
  { key: 'drift', label: 'drift', min: 0, max: 1, step: 0.01, default: 0.25 }, // eigenvalues wander → terrain morphs
];

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

class PseudospectrumArchetype implements Archetype {
  readonly id = 'pseudospectrum';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly W: number;
  private readonly h: Float64Array; // height field h(z) per grid cell
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // base 2×2 upper-triangular A = [[a,g],[0,d]]: eigenvalues a, d (complex). Only |g| affects σ_min
  // (rotation symmetry), so the off-diagonal carries no direction — non-normality is just its magnitude.
  private aRe = 0; private aIm = 0; private dRe = 0; private dIm = 0;
  private relief = 0.7;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const w = Math.max(24, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    this.h = new Float64Array(this.particleCount);
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.seedMatrix(config.seed, Math.round(config.params.matrix ?? 5));
    this.computeField(config.params, 0);
    this.colorByHeight(); // colours upload once at build → key off the initial landscape
    this.relief = config.params.relief ?? 0.7;
    this.syncPositions();
  }

  private seedMatrix(seed: number, matrix: number): void {
    const rng = mulberry32((seed ^ 0x5bd1e995) + matrix * 2654435761);
    // two eigenvalues placed on opposite sides → always two distinct, separated cones
    this.aRe = -(0.35 + 0.5 * rng());
    this.aIm = (rng() - 0.5) * 0.9;
    this.dRe = 0.35 + 0.5 * rng();
    this.dIm = (rng() - 0.5) * 0.9;
  }

  // h(z) = −log10 σ_min(zI−A) over the W×W grid, for the current params + time (drift wanders the
  // eigenvalues so the pseudospectral continents grow/split/collapse).
  private computeField(p: ResolvedParams, t: number): void {
    const w = this.W;
    const g = p.nonNormal ?? 1.3;
    const gsq = g * g;
    const drift = (p.drift ?? 0.25) * 0.35;
    // wandered eigenvalues (small Lissajous orbits)
    const aRe = this.aRe + drift * Math.sin(0.6 * t);
    const aIm = this.aIm + drift * Math.cos(0.47 * t);
    const dRe = this.dRe + drift * Math.sin(0.41 * t + 1.7);
    const dIm = this.dIm + drift * Math.cos(0.53 * t + 0.8);
    const h = this.h;
    for (let j = 0; j < w; j++) {
      const y = (j / (w - 1) - 0.5) * 2 * R; // Im(z)
      for (let i = 0; i < w; i++) {
        const x = (i / (w - 1) - 0.5) * 2 * R; // Re(z)
        const dxa = x - aRe, dya = y - aIm;
        const m11 = dxa * dxa + dya * dya; // |z−a|²
        const dxd = x - dRe, dyd = y - dIm;
        const m22 = dxd * dxd + dyd * dyd; // |z−d|²
        const T = m11 + m22 + gsq; // trace(MᴴM)
        const D = m11 * m22; // |det M|²  (upper-triangular ⇒ det = (z−a)(z−d))
        const disc = Math.max(0, T * T - 4 * D);
        const smin2 = 0.5 * (T - Math.sqrt(disc)); // smaller eigenvalue of MᴴM = σ_min²
        const smin = Math.sqrt(Math.max(0, smin2));
        // height ∝ resolvent norm 1/σ_min, smoothly saturated by tanh → broad cones with ROUNDED tips
        // (no flat clip) peaking at the eigenvalues, with wide pseudospectral skirts for a non-normal A.
        h[j * w + i] = HMAX * Math.tanh(0.35 / (smin + 0.02));
      }
    }
  }

  private colorByHeight(): void {
    const col = this.colors;
    const h = this.h;
    const HCOLOR = 3.2; // height that maps to a full cone (tip → white)
    for (let i = 0; i < this.particleCount; i++) {
      const t = Math.min(1, Math.max(0, h[i] / HCOLOR));
      // orange valley + contour rings → glowing teal cone bodies → white eigenvalue tips
      const band = 0.8 + 0.2 * Math.cos(h[i] * 11.0); // log-height contour rings
      const hue = 0.06 + 0.46 * smoothstep(0.22, 0.65, t); // orange → teal/cyan up the cone
      const sat = 0.85 - 0.55 * smoothstep(0.82, 1.0, t); // tips desaturate toward white
      const light = (0.24 + 0.72 * t) * band; // brighter floor so the continents read
      hslToRgb(hue, Math.max(0, Math.min(1, sat)), Math.max(0, Math.min(1, light)), col, i * 3);
    }
  }

  private syncPositions(): void {
    const w = this.W;
    const h = this.h;
    const pos = this.positions;
    const relief = this.relief;
    const yOff = -HMAX * relief * 0.42; // recentre the terrain on the origin
    for (let j = 0; j < w; j++) {
      const z = (j / (w - 1) - 0.5) * 2 * EXTENT;
      for (let i = 0; i < w; i++) {
        const o = (j * w + i) * 3;
        pos[o] = (i / (w - 1) - 0.5) * 2 * EXTENT;
        pos[o + 1] = h[j * w + i] * relief + yOff;
        pos[o + 2] = z;
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.relief = p.relief ?? 0.7;
    this.t += dt;
    this.computeField(p, this.t);
    this.syncPositions();
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return new Float64Array([this.t]);
  }
  loadState(s: Float64Array): void {
    this.t = s[0] ?? 0;
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Pseudospectrum ${this.W}²`, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', exposesField: true, pointSize: 0.012 };
  }
  readField(): { texture: unknown; width: number; height: number } {
    return { texture: this.h, width: this.W, height: this.W };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const pseudospectrumFactory: ArchetypeFactory = {
  id: 'pseudospectrum',
  label: 'Pseudospectrum',
  category: 'Spectral',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 40_000, // W ≈ 200
  particleCountOptions: [10_000, 40_000, 90_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the landscape surface IS the visual
  create: (config) => new PseudospectrumArchetype(config),
};

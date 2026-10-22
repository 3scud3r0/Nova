import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { spectralGradient } from '../core/color';
import { mulberry32 } from '../state/rng';

// Chimera states (Kuramoto & Battogtokh 2002; named by Abrams & Strogatz 2004): identical
// oscillators on a ring, coupled NONLOCALLY with a phase lag, spontaneously split into a
// synchronised arc coexisting with an incoherent arc — symmetry-broken order and chaos side by side
// on the same ring. Famous because it "shouldn't" happen: every oscillator is identical and coupled
// the same way, yet some lock while others drift forever.
//
//   ∂θ_i/∂t = ω − (K/N) Σ_j [1 + A cos(x_i − x_j)] · sin(θ_i − θ_j + α)
//
// The cosine kernel makes the nonlocal sum collapse to SIX global order-parameter sums, so the step
// is O(N) (no all-pairs loop). We render a ring "crown": angle = ring position, height = sin θ_i, so
// the coherent arc is a smooth band and the incoherent arc is jagged.
const TWO_PI = Math.PI * 2;
const R = 1.3; // crown radius
const HV = 0.42; // phase → height scale

const PARAM_SPEC: ParamSpec[] = [
  { key: 'alpha', label: 'phase lag α', min: 1.3, max: 1.57, step: 0.001, default: 1.46 },
  { key: 'kernelA', label: 'kernel A', min: 0, max: 1, step: 0.01, default: 0.9 },
  { key: 'coupling', label: 'coupling', min: 0.3, max: 2, step: 0.01, default: 1.0 },
];

class ChimeraArchetype implements Archetype {
  readonly id = 'chimera';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly theta: Float64Array; // evolving phase (authoritative state)
  private readonly cosx: Float64Array; // ring-position cosines (static)
  private readonly sinx: Float64Array; // ring-position sines (static)
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  constructor(config: ArchetypeConfig) {
    const n = config.particleCount;
    this.particleCount = n;
    this.theta = new Float64Array(n);
    this.cosx = new Float64Array(n);
    this.sinx = new Float64Array(n);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);

    const rng = mulberry32(config.seed);
    // Chimera-nucleating init (Abrams–Strogatz): coherent (θ≈0) everywhere except a Gaussian-localized
    // random perturbation around the ring centre — that arc seeds the incoherent region.
    for (let i = 0; i < n; i++) {
      const x = (TWO_PI * i) / n;
      this.cosx[i] = Math.cos(x);
      this.sinx[i] = Math.sin(x);
      const d = x - Math.PI; // distance from ring centre, ∈ [−π, π)
      this.theta[i] = 6 * (rng() - 0.5) * Math.exp(-0.76 * d * d);
    }
    spectralGradient(n, this.colors); // static rainbow by ring position (GPU path recolours by phase)
    this.writePositions();
  }

  step(dt: number, p: ResolvedParams): void {
    const n = this.particleCount;
    const th = this.theta;
    const cx = this.cosx;
    const sx = this.sinx;
    // Six global sums that the cosine-kernel coupling decomposes into.
    let Sc = 0;
    let Ss = 0;
    let Scc = 0;
    let Scs = 0;
    let Ssc = 0;
    let Sss = 0;
    for (let j = 0; j < n; j++) {
      const cj = Math.cos(th[j]);
      const sj = Math.sin(th[j]);
      Sc += cj;
      Ss += sj;
      Scc += cx[j] * cj;
      Scs += cx[j] * sj;
      Ssc += sx[j] * cj;
      Sss += sx[j] * sj;
    }
    Sc /= n;
    Ss /= n;
    Scc /= n;
    Scs /= n;
    Ssc /= n;
    Sss /= n;

    const A = p.kernelA;
    const K = p.coupling;
    const alpha = p.alpha;
    for (let i = 0; i < n; i++) {
      const cxi = cx[i];
      const sxi = sx[i];
      const termC = Sc + A * cxi * Scc + A * sxi * Ssc;
      const termS = Ss + A * cxi * Scs + A * sxi * Sss;
      const t = th[i];
      const ci = Math.sin(t + alpha) * termC - Math.cos(t + alpha) * termS;
      let nt = (t - K * ci * dt) % TWO_PI; // ω = 0 (co-rotating frame)
      if (nt < 0) nt += TWO_PI;
      th[i] = nt;
    }
    this.writePositions();
  }

  private writePositions(): void {
    const n = this.particleCount;
    const th = this.theta;
    const cx = this.cosx;
    const sx = this.sinx;
    const pos = this.positions;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      pos[o] = cx[i] * R;
      pos[o + 1] = Math.sin(th[i]) * HV;
      pos[o + 2] = sx[i] * R;
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return this.theta;
  }
  loadState(s: Float64Array): void {
    this.theta.set(s.subarray(0, this.theta.length));
    this.writePositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Chimera (${this.particleCount})`, stateOffset: 0, stateLength: this.particleCount }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.012 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const chimeraFactory: ArchetypeFactory = {
  id: 'chimera',
  label: 'Chimera States',
  category: 'Oscillator',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 60_000,
  particleCountOptions: [20_000, 60_000, 120_000],
  defaultDt: 0.05,
  create: (config) => new ChimeraArchetype(config),
};

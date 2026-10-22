import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';
import { mulberry32 } from '../state/rng';

// Kuramoto model (1975): N phase oscillators, each with its own natural frequency ωᵢ, coupled
// through the global mean field. Below a critical coupling K they drift incoherently; above it they
// spontaneously synchronise — the canonical model of emergent sync (fireflies, metronomes, neurons,
// power grids). We lay them on a cylinder: angle = phase θᵢ, height = natural-frequency seed gᵢ. As
// K rises the central frequencies lock and the cylinder "zips up" into a rotating coherent sheet
// while the fast/slow wings keep drifting. Colour encodes natural frequency.
//
// Mean-field form (no all-pairs loop): with the order parameter (m_c, m_s) = mean(cosθ, sinθ),
//   dθᵢ/dt = ωᵢ + K·(m_s·cosθᵢ − m_c·sinθᵢ)        [= ωᵢ + K·r·sin(ψ − θᵢ)]
const TWO_PI = Math.PI * 2;
const R = 1.3; // cylinder radius
const HV = 0.45; // natural-frequency → height scale

const PARAM_SPEC: ParamSpec[] = [
  { key: 'coupling', label: 'K (coupling)', min: 0, max: 5, step: 0.01, default: 1.8 },
  { key: 'omega0', label: 'ω₀ (mean freq)', min: 0, max: 3, step: 0.01, default: 1.0 },
  { key: 'spread', label: 'freq spread', min: 0.05, max: 2, step: 0.01, default: 0.6 },
];

// Standard-normal sample (Box–Muller) for the natural-frequency distribution.
function boxMuller(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-6);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
}

class KuramotoArchetype implements Archetype {
  readonly id = 'kuramoto';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly theta: Float64Array; // evolving phase (authoritative state)
  private readonly g: Float64Array; // fixed standard-gaussian frequency seed (ωᵢ = ω₀ + spread·gᵢ)
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  constructor(config: ArchetypeConfig) {
    const n = config.particleCount;
    this.particleCount = n;
    this.theta = new Float64Array(n);
    this.g = new Float64Array(n);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);

    const rng = mulberry32(config.seed);
    for (let i = 0; i < n; i++) {
      this.theta[i] = rng() * TWO_PI;
      this.g[i] = boxMuller(rng);
      // colour by natural frequency: slow (blue) → fast (red)
      const hue = Math.min(1, Math.max(0, 0.5 + this.g[i] * 0.16)) * 0.8;
      hslToRgb(hue, 0.85, 0.6, this.colors, i * 3);
    }
    this.writePositions();
  }

  step(dt: number, p: ResolvedParams): void {
    const n = this.particleCount;
    const th = this.theta;
    // order parameter: mean of (cosθ, sinθ) over all oscillators
    let sc = 0;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      sc += Math.cos(th[i]);
      ss += Math.sin(th[i]);
    }
    const mc = sc / n;
    const ms = ss / n;
    const K = p.coupling;
    const w0 = p.omega0;
    const spread = p.spread;
    for (let i = 0; i < n; i++) {
      const t = th[i];
      const omega = w0 + spread * this.g[i];
      const dtheta = omega + K * (ms * Math.cos(t) - mc * Math.sin(t));
      let nt = (t + dtheta * dt) % TWO_PI;
      if (nt < 0) nt += TWO_PI;
      th[i] = nt;
    }
    this.writePositions();
  }

  private writePositions(): void {
    const n = this.particleCount;
    const th = this.theta;
    const g = this.g;
    const pos = this.positions;
    for (let i = 0; i < n; i++) {
      const t = th[i];
      const o = i * 3;
      pos[o] = Math.cos(t) * R;
      pos[o + 1] = g[i] * HV;
      pos[o + 2] = Math.sin(t) * R;
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
    return [{ id: 'root', parentId: null, label: `Kuramoto (${this.particleCount})`, stateOffset: 0, stateLength: this.particleCount }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.012 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const kuramotoFactory: ArchetypeFactory = {
  id: 'kuramoto',
  label: 'Kuramoto Sync',
  category: 'Oscillator',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 80_000,
  particleCountOptions: [40_000, 80_000, 120_000],
  defaultDt: 0.012,
  create: (config) => new KuramotoArchetype(config),
};

import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  Derivative,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { spectralGradient } from '../core/color';
import { IRRATIONAL_DRIVERS } from '../physics/constants';
import { rk4Step } from '../physics/integrators/rk4';
import { mulberry32 } from '../state/rng';

// Hierarchical hyper-oscillator (PRD §2): each particle carries L nested phase angles. Level k
// runs at ωₖ = ω₀·S_f^k·driverₖ (driver ∈ {φ, π, e, δ}), frequency-modulated by its parent
// level's phase (coupling ε). The 3D position is a nested epicycle sum with amplitude Aₖ = S_a^k,
// giving quasi-periodic, non-repeating orbital swarms. Bounded by construction (cos/sin), so no
// blow-up regardless of dt — and the L levels form a genuine parent→child hierarchy (FR-3.2).
const PARAM_SPEC: ParamSpec[] = [
  { key: 'omega0', label: 'ω₀', min: 0.1, max: 4, step: 0.05, default: 1.0 },
  { key: 'freqScale', label: 'S_f', min: 1.0, max: 2.5, step: 0.01, default: 1.2 },
  { key: 'ampScale', label: 'S_a', min: 0.2, max: 0.9, step: 0.01, default: 0.6 },
  { key: 'eps', label: 'ε', min: 0, max: 1.5, step: 0.01, default: 0.35 },
  { key: 'levels', label: 'levels', min: 3, max: 6, step: 1, default: 4, options: { '3': 3, '4': 4, '5': 5, '6': 6 }, rebuild: true },
];

const TWO_PI = Math.PI * 2;
const RENDER_SCALE = 0.8;

class HyperOscillatorArchetype implements Archetype {
  readonly id = 'hyperOscillator';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly levels: number;
  private readonly state: Float64Array; // particleCount * levels phase angles
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly omega: Float64Array; // per-level angular frequency, recomputed per step
  private readonly deriv: Derivative;
  private ampScale: number;

  constructor(config: ArchetypeConfig) {
    this.particleCount = config.particleCount;
    const L = Math.max(2, Math.min(6, Math.round(config.params.levels ?? 4)));
    this.levels = L;
    this.ampScale = config.params.ampScale ?? 0.6;

    const n = this.particleCount;
    this.state = new Float64Array(n * L);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.omega = new Float64Array(L);

    // ωₖ is precomputed per step (state-independent), so the per-particle hot path is alloc- and pow-free.
    this.deriv = (out, x, p) => {
      const eps = p.eps;
      const om = this.omega;
      let parent = 0;
      for (let k = 0; k < L; k++) {
        out[k] = om[k] * (1 + eps * Math.sin(parent));
        parent = x[k];
      }
    };

    const rng = mulberry32(config.seed);
    for (let i = 0; i < n * L; i++) this.state[i] = rng() * TWO_PI;
    spectralGradient(n, this.colors);
    this.writePositions();
  }

  step(dt: number, p: ResolvedParams): void {
    const L = this.levels;
    const w0 = p.omega0;
    const sf = p.freqScale;
    for (let k = 0; k < L; k++) {
      this.omega[k] = w0 * Math.pow(sf, k) * IRRATIONAL_DRIVERS[k % IRRATIONAL_DRIVERS.length];
    }
    this.ampScale = p.ampScale;
    const n = this.particleCount;
    for (let i = 0; i < n; i++) rk4Step(this.state, i * L, L, this.deriv, p, dt);
    this.writePositions();
  }

  private writePositions(): void {
    const L = this.levels;
    const n = this.particleCount;
    const st = this.state;
    const pos = this.positions;
    const aScale = this.ampScale;
    for (let i = 0; i < n; i++) {
      const so = i * L;
      let x = 0;
      let y = 0;
      let z = 0;
      let amp = 1;
      let prev = 0;
      for (let k = 0; k < L; k++) {
        const th = st[so + k];
        x += amp * Math.cos(th);
        y += amp * Math.sin(th);
        z += amp * Math.sin(th - prev);
        prev = th;
        amp *= aScale;
      }
      const po = i * 3;
      pos[po] = x * RENDER_SCALE;
      pos[po + 1] = y * RENDER_SCALE;
      pos[po + 2] = z * RENDER_SCALE;
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }

  readColors(): Float32Array {
    return this.colors;
  }

  readState(): Float64Array {
    return this.state;
  }

  loadState(s: Float64Array): void {
    this.state.set(s.subarray(0, this.state.length));
    this.writePositions();
  }

  getHierarchy(): NodeSpec[] {
    const nodes: NodeSpec[] = [];
    for (let k = 0; k < this.levels; k++) {
      nodes.push({
        id: `L${k}`,
        parentId: k === 0 ? null : `L${k - 1}`,
        label: `Level ${k}`,
        stateOffset: k,
        stateLength: 1,
        params: { omega: this.omega[k] },
      });
    }
    return nodes;
  }

  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.012 };
  }

  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const hyperOscillatorFactory: ArchetypeFactory = {
  id: 'hyperOscillator',
  label: 'Hyper-Oscillator',
  category: 'Oscillator',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 80_000,
  defaultDt: 0.006,
  create: (config) => new HyperOscillatorArchetype(config),
};

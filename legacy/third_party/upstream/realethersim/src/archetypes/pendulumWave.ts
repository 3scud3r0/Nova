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

// Pendulum wave ("pendulum snake", the Harvard demo): a row of simple pendulums whose lengths are
// graduated so pendulum i completes (baseOsc + i) swings in one cycle time T. They start aligned,
// drift out of phase into a traveling wave, knot into apparent chaos, then exactly re-synchronise
// every T seconds — a hypnotic, fully deterministic pattern. Each pendulum is a DIFFERENT oscillator
// (its frequency comes from the index i), which is why this can't be a shared-ODE AttractorSystem.
//
// Render: each pendulum hangs as a STRING of points from a top rail and swings in z (toward/away from
// the camera), staying in its own x-column. WebGPU draws points at ~1px regardless of size, so we use
// many points (string resolution × pendulum count) for a bright, readable, recognisable row of bobs.
//
// We integrate nothing: the motion is exact SHM θᵢ(t) = amp·cos(φᵢ), with phase φᵢ advanced by
// ωᵢ·dt each step and wrapped to [0,2π). Closed-form ⇒ zero energy drift ⇒ can never blow up.
const TWO_PI = Math.PI * 2;
const SPP = 40; // points per pendulum string (pivot → bob) — solid, bright strings
const COL_W = 3.2; // fixed render width of the row
const PIVOT_Y = 1.0; // top rail height
const STRING_L = 2.0; // string length (rest bob at y = PIVOT_Y − STRING_L = −1.0; row centred on 0)

const PARAM_SPEC: ParamSpec[] = [
  { key: 'baseOsc', label: 'base swings', min: 10, max: 120, step: 1, default: 51 },
  { key: 'cycleTime', label: 'cycle (s)', min: 10, max: 120, step: 1, default: 30 },
  { key: 'amplitude', label: 'amplitude', min: 0.2, max: 1.4, step: 0.01, default: 1.0 },
];

class PendulumWaveArchetype implements Archetype {
  readonly id = 'pendulumWave';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly pendCount: number;
  private readonly omega: Float64Array; // per-pendulum angular frequency (rad/s)
  private readonly phase: Float64Array; // evolving phase (authoritative state)
  private amp = 1.0;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  constructor(config: ArchetypeConfig) {
    const pend = Math.max(2, Math.round(config.particleCount / SPP));
    this.pendCount = pend;
    this.particleCount = pend * SPP;
    this.omega = new Float64Array(pend);
    this.phase = new Float64Array(pend);
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);

    const baseOsc = config.params.baseOsc ?? 51;
    const cycle = config.params.cycleTime ?? 30;
    this.amp = config.params.amplitude ?? 1.0;
    const denom = Math.max(1, pend - 1);
    for (let p = 0; p < pend; p++) {
      this.omega[p] = (TWO_PI * (baseOsc + p)) / cycle;
      this.phase[p] = 0; // all aligned at t=0 → clean "launch from a straight line"
      // rainbow along the row; every point of a string shares its pendulum's colour
      for (let j = 0; j < SPP; j++) hslToRgb((p / denom) * 0.85, 0.9, 0.66, this.colors, (p * SPP + j) * 3);
    }
    this.writePositions();
  }

  step(dt: number, p: ResolvedParams): void {
    const pend = this.pendCount;
    const baseOsc = p.baseOsc ?? 51;
    const cycle = p.cycleTime ?? 30;
    this.amp = p.amplitude ?? 1.0;
    const twoPiOverT = TWO_PI / cycle;
    const ph = this.phase;
    const om = this.omega;
    for (let i = 0; i < pend; i++) {
      om[i] = twoPiOverT * (baseOsc + i); // honour live param edits
      let np = ph[i] + om[i] * dt;
      np %= TWO_PI;
      if (np < 0) np += TWO_PI;
      ph[i] = np;
    }
    this.writePositions();
  }

  private writePositions(): void {
    const pend = this.pendCount;
    const ph = this.phase;
    const pos = this.positions;
    const amp = this.amp;
    const denom = Math.max(1, pend - 1);
    for (let p = 0; p < pend; p++) {
      const x = (p / denom - 0.5) * COL_W; // which pendulum (fixed column; guarantees spread)
      const theta = amp * Math.cos(ph[p]); // swing angle
      const sy = -Math.cos(theta) * STRING_L; // bob drop
      const sz = Math.sin(theta) * STRING_L; // bob swing in z (toward/away)
      const base = p * SPP * 3;
      for (let j = 0; j < SPP; j++) {
        const t = j / (SPP - 1); // 0 = pivot, 1 = bob
        const o = base + j * 3;
        pos[o] = x;
        pos[o + 1] = PIVOT_Y + t * sy;
        pos[o + 2] = t * sz;
      }
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return this.phase;
  }
  loadState(s: Float64Array): void {
    this.phase.set(s.subarray(0, this.phase.length));
    this.writePositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Pendulum Wave (${this.pendCount})`, stateOffset: 0, stateLength: this.pendCount }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.03 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const pendulumWaveFactory: ArchetypeFactory = {
  id: 'pendulumWave',
  label: 'Pendulum Wave',
  category: 'Oscillator',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 2000, // ≈ 50 pendulums × 40 string points
  particleCountOptions: [1000, 2000, 4000],
  defaultDt: 0.02,
  defaultTrail: 0, // the row IS the visual; trails would smear it
  create: (config) => new PendulumWaveArchetype(config),
};

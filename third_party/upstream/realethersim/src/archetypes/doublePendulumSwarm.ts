import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';

// Double Pendulum Swarm — sensitive dependence, rendered literally. Tens of thousands of double
// pendulums start from almost exactly the same angle (a spread far thinner than a pixel), so the
// swarm of lower-bob tips begins as a single bright dot. Each obeys the same conservative equations,
// yet the double pendulum is chaotic: the tiniest difference grows exponentially, and within a few
// swings the dot smears, then detonates into a fog that fills the whole reachable region — the
// Lyapunov horizon you can time by eye. Unlike the phase-space Double Pendulum attractor (which plots
// the abstract 4-D state), this shows the bobs swinging in REAL space. Colour is baked across the
// initial bundle so you watch the ordering dissolve into mixing. The swarm periodically re-collapses
// to replay the divergence. Energy-conserving RK4. Bounded (tips lie within L₁+L₂). (m₁=m₂, L₁=L₂.)
const G = 1.0, L1 = 0.95, L2 = 0.95;
const CYCLE = 10; // sim-seconds before re-collapsing the bundle to replay the divergence

class DoublePendulumSwarmArchetype implements Archetype {
  readonly id = 'doublePendulumSwarm';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly a1: Float64Array; private readonly a2: Float64Array; // θ₁, θ₂
  private readonly w1: Float64Array; private readonly w2: Float64Array; // ω₁, ω₂
  private readonly a1_0: Float64Array; // per-point initial θ₁ (for the re-collapse)
  private spread = 1;
  private rate = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(2048, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.a1 = new Float64Array(N); this.a2 = new Float64Array(N);
    this.w1 = new Float64Array(N); this.w2 = new Float64Array(N);
    this.a1_0 = new Float64Array(N);
    this.readParams(config.params);
    const base1 = 2.3, base2 = 2.3; // both arms raised near horizontal → energetic, fully chaotic
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      this.a1_0[i] = base1 + (f - 0.5) * 0.02 * this.spread; // a hair-thin fan of start angles
      // colour baked across the bundle → the gradient shears and mixes as they diverge (turbo-ish)
      const o = i * 3;
      const h = f;
      this.colors[o] = 0.6 + 0.4 * Math.cos(6.2831853 * (h + 0.0));
      this.colors[o + 1] = 0.55 + 0.4 * Math.cos(6.2831853 * (h + 0.33));
      this.colors[o + 2] = 0.6 + 0.4 * Math.cos(6.2831853 * (h + 0.66));
    }
    this.resetBundle(base2);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.spread = p.spread ?? 1;
    this.rate = p.rate ?? 1;
  }

  private resetBundle(base2: number): void {
    for (let i = 0; i < this.particleCount; i++) {
      this.a1[i] = this.a1_0[i]; this.a2[i] = base2;
      this.w1[i] = 0; this.w2[i] = 0;
    }
  }

  // angular accelerations for equal masses (m₁=m₂=1) and equal arms
  private accel(a1: number, a2: number, w1: number, w2: number, out: [number, number]): void {
    const d = a1 - a2;
    const cd = Math.cos(d), sd = Math.sin(d);
    const den = 3 - Math.cos(2 * d); // L·(2m₁+m₂ − m₂cos2Δ) with the shared L factored out
    const n1 = -G * 3 * Math.sin(a1) - G * Math.sin(a1 - 2 * a2) - 2 * sd * (w2 * w2 + w1 * w1 * cd);
    const n2 = 2 * sd * (w1 * w1 * 2 + G * 2 * Math.cos(a1) + w2 * w2 * cd);
    out[0] = n1 / (L1 * den);
    out[1] = n2 / (L2 * den);
  }

  private syncPositions(): void {
    const pos = this.positions;
    for (let i = 0; i < this.particleCount; i++) {
      const x1 = L1 * Math.sin(this.a1[i]), y1 = -L1 * Math.cos(this.a1[i]);
      const o = i * 3;
      pos[o] = x1 + L2 * Math.sin(this.a2[i]);        // lower-bob tip, real space
      pos[o + 1] = y1 - L2 * Math.cos(this.a2[i]);
      pos[o + 2] = 0;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt * this.rate;
    if (this.t >= CYCLE) { this.t -= CYCLE; this.resetBundle(this.a2[0]); }
    const N = this.particleCount;
    const K = 6; // RK4 substeps for stability on this stiff chaotic ODE
    // integrate dynamical time faster than the reset clock so the swarm fully detonates into its
    // fog within a few real seconds (the reset clock `t` above stays on real time)
    const h = (dt * this.rate * 4.5) / K;
    const acc: [number, number] = [0, 0];
    for (let s = 0; s < K; s++) {
      for (let i = 0; i < N; i++) {
        const a1 = this.a1[i], a2 = this.a2[i], w1 = this.w1[i], w2 = this.w2[i];
        this.accel(a1, a2, w1, w2, acc);
        const k1a1 = w1, k1a2 = w2, k1w1 = acc[0], k1w2 = acc[1];
        this.accel(a1 + 0.5 * h * k1a1, a2 + 0.5 * h * k1a2, w1 + 0.5 * h * k1w1, w2 + 0.5 * h * k1w2, acc);
        const k2a1 = w1 + 0.5 * h * k1w1, k2a2 = w2 + 0.5 * h * k1w2, k2w1 = acc[0], k2w2 = acc[1];
        this.accel(a1 + 0.5 * h * k2a1, a2 + 0.5 * h * k2a2, w1 + 0.5 * h * k2w1, w2 + 0.5 * h * k2w2, acc);
        const k3a1 = w1 + 0.5 * h * k2w1, k3a2 = w2 + 0.5 * h * k2w2, k3w1 = acc[0], k3w2 = acc[1];
        this.accel(a1 + h * k3a1, a2 + h * k3a2, w1 + h * k3w1, w2 + h * k3w2, acc);
        const k4a1 = w1 + h * k3w1, k4a2 = w2 + h * k3w2, k4w1 = acc[0], k4w2 = acc[1];
        this.a1[i] = a1 + (h / 6) * (k1a1 + 2 * k2a1 + 2 * k3a1 + k4a1);
        this.a2[i] = a2 + (h / 6) * (k1a2 + 2 * k2a2 + 2 * k3a2 + k4a2);
        this.w1[i] = w1 + (h / 6) * (k1w1 + 2 * k2w1 + 2 * k3w1 + k4w1);
        this.w2[i] = w2 + (h / 6) * (k1w2 + 2 * k2w2 + 2 * k3w2 + k4w2);
      }
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'double-pendulum ensemble (sensitive dependence)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.006 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const doublePendulumSwarmFactory: ArchetypeFactory = {
  id: 'doublePendulumSwarm',
  label: 'Double Pendulum Swarm',
  category: 'Oscillator',
  kind: 'flow',
  params: [
    { key: 'spread', label: 'initial spread', min: 0.2, max: 4, step: 0.05, default: 1 },
    { key: 'rate', label: 'time rate', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 60_000,
  particleCountOptions: [30_000, 60_000, 120_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new DoublePendulumSwarmArchetype(config),
};

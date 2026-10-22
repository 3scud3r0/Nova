import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Firefly Synchronization. In parts of the world, thousands of fireflies in a single forest flash
// in perfect unison — a wave of light, then darkness, then light. No conductor: each firefly is an
// oscillator that nudges its own rhythm toward the flashes it sees, and above a threshold of
// coupling the whole population locks. It is the same Kuramoto mean-field law the abstract
// "Kuramoto Sync" system draws as a phase portrait — here it is the fireflies themselves, scattered
// through a dark wood, blinking. Watch them arrive out of phase (a scatter of random sparks) and
// pull, over seconds, into a single shared pulse. Each firefly is a little cluster of points that
// gathers into a bright blob when it flashes and is parked out of sight when dark; the colour (the
// ~560 nm yellow-green of luciferase) is baked once. See also [[kuramoto]]. Bounded.
const TAU = Math.PI * 2;
const PARK_Y = -40; // dark fireflies are parked far below the frustum

class FirefliesArchetype implements Archetype {
  readonly id = 'fireflies';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly nFlies: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly fx: Float64Array; // firefly positions
  private readonly fy: Float64Array;
  private readonly fz: Float64Array;
  private readonly om: Float64Array; // natural frequency
  private readonly th: Float64Array; // phase
  private readonly ox: Float64Array; // per-point blob offset
  private readonly oy: Float64Array;
  private readonly oz: Float64Array;
  private readonly fi: Int32Array; // per-point firefly index
  private coupling = 1.3;
  private spread = 0.6;
  private rate = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(2048, config.particleCount);
    this.particleCount = N;
    const perFly = 170;
    const F = Math.max(24, Math.floor(N / perFly));
    this.nFlies = F;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.fx = new Float64Array(F);
    this.fy = new Float64Array(F);
    this.fz = new Float64Array(F);
    this.om = new Float64Array(F);
    this.th = new Float64Array(F);
    this.ox = new Float64Array(N);
    this.oy = new Float64Array(N);
    this.oz = new Float64Array(N);
    this.fi = new Int32Array(N);
    const rng = mulberry32((config.seed ^ 0x632be5ab) >>> 0);
    this.readParams(config.params);
    for (let j = 0; j < F; j++) {
      this.fx[j] = (rng() * 2 - 1) * 2.3;
      this.fy[j] = -1.0 + Math.pow(rng(), 0.8) * 2.1; // denser near the forest floor
      this.fz[j] = (rng() * 2 - 1) * 1.7;
      // natural frequencies scattered about a mean flash rate (Gaussian via Box–Muller)
      const u1 = Math.max(1e-6, rng()), u2 = rng();
      this.om[j] = 1.0 + this.spread * Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
      this.th[j] = rng() * TAU; // arrive out of phase
    }
    for (let i = 0; i < N; i++) {
      const j = Math.min(F - 1, Math.floor(i / perFly));
      this.fi[i] = j;
      // blob offset: a small fuzzy ball (uniform-in-sphere)
      const dir = rng() * TAU, cz = rng() * 2 - 1, sr = Math.sqrt(1 - cz * cz), rr = Math.cbrt(rng());
      this.ox[i] = sr * Math.cos(dir) * rr;
      this.oy[i] = sr * Math.sin(dir) * rr;
      this.oz[i] = cz * rr;
      // luciferase yellow-green, a touch of per-point variation
      const b = 0.9 + 0.5 * rng();
      const o = i * 3;
      this.colors[o] = 0.62 * b; this.colors[o + 1] = 1.0 * b; this.colors[o + 2] = 0.22 * b;
    }
    // start part-way into the synchronisation so the capture lands on a collective flash
    this.t = 7.0;
    this.advanceTo(this.t);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.coupling = p.coupling ?? 1.3;
    this.spread = p.spread ?? 0.6;
    this.rate = p.rate ?? 1;
  }

  // integrate the mean-field Kuramoto phases up to time tt (used once at construction)
  private advanceTo(tt: number): void {
    const steps = Math.min(1200, Math.max(1, Math.floor(tt / 0.02)));
    const h = tt / steps;
    for (let s = 0; s < steps; s++) this.integrate(h);
  }

  private integrate(dt: number): void {
    const F = this.nFlies;
    let mc = 0, ms = 0;
    for (let j = 0; j < F; j++) { mc += Math.cos(this.th[j]); ms += Math.sin(this.th[j]); }
    mc /= F; ms /= F;
    const K = this.coupling * this.rate;
    const w = this.rate;
    for (let j = 0; j < F; j++) {
      const c = Math.cos(this.th[j]), s = Math.sin(this.th[j]);
      // dθ = ω + K·(m_s·cosθ − m_c·sinθ)   [= ω + K·r·sin(ψ − θ)]
      this.th[j] += dt * (this.om[j] * w + K * (ms * c - mc * s));
    }
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    const R_ON = 0.05;
    for (let i = 0; i < N; i++) {
      const j = this.fi[i];
      // flash pulse: bright only near θ = 0 (a firefly is dark most of its cycle)
      const s = Math.exp(-2.0 * (1 - Math.cos(this.th[j])));
      const vis = s <= 0.18 ? 0 : s >= 0.72 ? 1 : (() => { const u = (s - 0.18) / 0.54; return u * u * (3 - 2 * u); })();
      const o = i * 3;
      if (vis <= 0) { pos[o] = 0; pos[o + 1] = PARK_Y; pos[o + 2] = 0; continue; }
      // gentle hover so the lit swarm breathes
      const hv = 0.03 * Math.sin(this.t * 0.6 + j * 1.3);
      const tx = this.fx[j] + this.ox[i] * R_ON;
      const ty = this.fy[j] + this.oy[i] * R_ON + hv;
      const tz = this.fz[j] + this.oz[i] * R_ON;
      // lerp up from the parked point as it lights
      pos[o] = tx * vis;
      pos[o + 1] = PARK_Y + (ty - PARK_Y) * vis;
      pos[o + 2] = tz * vis;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt;
    this.integrate(dt);
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const s = new Float64Array(1 + this.nFlies);
    s[0] = this.t; s.set(this.th, 1);
    return s;
  }
  loadState(s: Float64Array): void {
    this.t = s[0] ?? 0;
    if (s.length >= 1 + this.nFlies) this.th.set(s.subarray(1, 1 + this.nFlies));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'synchronising fireflies', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.014 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const firefliesFactory: ArchetypeFactory = {
  id: 'fireflies',
  label: 'Firefly Synchronization',
  category: 'Life',
  kind: 'flow',
  params: [
    { key: 'coupling', label: 'coupling', min: 0, max: 4, step: 0.05, default: 1.3 }, // K — sync strength
    { key: 'spread', label: 'freq spread', min: 0.05, max: 1.2, step: 0.05, default: 0.6 },
    { key: 'rate', label: 'flash rate', min: 0.3, max: 2.5, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.6, // the flashes should bloom in the dark
  create: (config) => new FirefliesArchetype(config),
};

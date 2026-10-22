import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Black Hole Ringdown. When two black holes merge, the newborn horizon does not settle silently —
// it RINGS, shedding its distortion as gravitational waves in a handful of fading tones called
// quasinormal modes: damped sinusoids A·e^{−t/τ}·cos(ωt) whose frequencies ω and decay times τ are
// fixed by just the final mass and spin (this is why LIGO calls reading them "black-hole
// spectroscopy" — the bell tells you what struck it). We render spacetime as a membrane: a central
// well for the remnant, and the dominant ℓ=2 quadrupole mode ringing outward from it as an
// expanding, damping wave (retarded time, so nothing outruns light), re-struck each cycle. Colours
// bake once (teal lattice, a warm accretion glow in the throat); the height re-evaluates its
// closed form each frame. Bounded.
const RMAX = 3.4; // membrane radius
const CS = 1.0; // wave speed on the sheet (retarded time r/CS)

class RingdownArchetype implements Archetype {
  readonly id = 'ringdown';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly gx: Float64Array; // baked grid x
  private readonly gz: Float64Array; // baked grid z
  private readonly gr: Float64Array; // radius
  private readonly gth: Float64Array; // angle
  private depth = 1;
  private ringing = 1; // amplitude of the quasinormal ring
  private tau = 1; // decay-time scale
  private period = 1; // re-strike cadence
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(1024, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.gx = new Float64Array(N);
    this.gz = new Float64Array(N);
    this.gr = new Float64Array(N);
    this.gth = new Float64Array(N);
    const rng = mulberry32((config.seed ^ 0x7feb352d) >>> 0);
    this.readParams(config.params);
    // lay the membrane out as an actual wireframe — points strung ALONG grid lines of both families,
    // so the lattice reads as lines rather than speckle (the way the gravity-well sheet does)
    const G = 48; // grid lines per family
    const half = Math.floor(N / 2);
    for (let i = 0; i < N; i++) {
      const family = i < half ? 0 : 1;
      const g = Math.floor(rng() * G);
      const c = -RMAX + (2 * RMAX) * (g + 0.5) / G; // the line's fixed coordinate
      const f = (rng() * 2 - 1) * RMAX; // position along the line
      let x = family === 0 ? c : f;
      let z = family === 0 ? f : c;
      const rr0 = Math.hypot(x, z);
      if (rr0 > RMAX) { const k = RMAX / rr0; x *= k; z *= k; } // keep it a disc
      x += (rng() - 0.5) * 0.012; z += (rng() - 0.5) * 0.012; // a hair off the line
      this.gx[i] = x; this.gz[i] = z;
      this.gr[i] = Math.hypot(x, z); this.gth[i] = Math.atan2(z, x);
      const warm = Math.max(0, 1 - this.gr[i] / 0.8); // accretion glow near the throat
      const b = 0.55 + 0.35 * rng();
      const o = i * 3;
      this.colors[o] = 0.2 * b + 1.1 * warm * warm + 0.25 * warm;
      this.colors[o + 1] = 0.8 * b + 0.4 * warm;
      this.colors[o + 2] = 1.05 * b - 0.3 * warm;
    }
    // start so the ~3 s thumbnail capture lands early in a strike cycle — a fresh, big ring
    this.t = 0.2;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.depth = p.depth ?? 1;
    this.ringing = p.ringing ?? 1;
    this.tau = p.decay ?? 1;
    this.period = p.period ?? 1;
  }

  private height(r: number, th: number, t: number): number {
    // the remnant's well — shallow and wide, so the RINGING is the star, not the funnel
    const well = -this.depth * 0.42 / Math.sqrt(r * r + 0.32);
    // quasinormal ring: struck at the centre each cycle, radiating out at CS with retarded time,
    // the dominant ℓ=2 quadrupole (cos 2θ) as a damped sinusoid e^{−t/τ}·cos(ωt) plus one overtone
    const cyc = ((t / (this.period * 2.6)) % 1) * (this.period * 2.6);
    const tr = cyc - r / CS; // retarded time — nothing outruns the wavefront
    if (tr <= 0) return well;
    const decay = Math.exp(-tr / (1.7 * this.tau));
    const w0 = 3.4, w1 = 5.6; // fundamental + first overtone frequencies
    const env = (1 - Math.exp(-r * 2.6)) * Math.exp(-r * 0.32); // 0 at throat, peaks ~r=1, fades outward
    const quad = Math.cos(2 * th);
    const ring = this.ringing * 2.4 * decay * env *
      (Math.cos(w0 * tr) * quad + 0.4 * Math.exp(-tr / (0.9 * this.tau)) * Math.cos(w1 * tr) * Math.cos(2 * th + 0.8));
    return well + ring;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    const t = this.t;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      pos[o] = this.gx[i];
      pos[o + 1] = this.height(this.gr[i], this.gth[i], t);
      pos[o + 2] = this.gz[i];
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
    return [{ id: 'root', parentId: null, label: 'ringing horizon (quasinormal modes)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.011 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const ringdownFactory: ArchetypeFactory = {
  id: 'ringdown',
  label: 'Black Hole Ringdown',
  category: 'Spacetime',
  kind: 'flow',
  params: [
    { key: 'ringing', label: 'ring amplitude', min: 0, max: 2.5, step: 0.05, default: 1 },
    { key: 'decay', label: 'decay time', min: 0.3, max: 3, step: 0.05, default: 1 }, // τ
    { key: 'depth', label: 'well depth', min: 0.3, max: 2, step: 0.05, default: 1 },
    { key: 'period', label: 're-strike', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 160_000,
  particleCountOptions: [90_000, 160_000, 260_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the membrane IS the visual
  bloom: 0.4,
  clock: { scale: 5.0, unit: 'ms', cycle: 2.6 }, // ringdown plays out in milliseconds
  create: (config) => new RingdownArchetype(config),
};

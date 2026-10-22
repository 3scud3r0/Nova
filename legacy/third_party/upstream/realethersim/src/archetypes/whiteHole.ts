import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// White Hole. The time-reverse of a black hole — the OTHER half of the full Schwarzschild solution.
// A black hole's horizon lets everything in and nothing out; run the geometry backward and you get a
// horizon that lets everything OUT and nothing in: "the equations allow a horizon that throws the
// universe outward." No one has ever observed one — it may be mathematics rather than nature — but
// the mathematics is exact, and this is it: the spatial geometry is Flamm's paraboloid (the same
// funnel as our wormhole's bridge), and the ejecta ride the TIME-REVERSED rain-frame trajectories.
// Reversed radial free-fall obeys dr/dτ = +√(2M/r), whose exact solution is r^{3/2} linear in τ —
// so each particle's flight is analytic (no integration, no drift): it erupts through the horizon at
// escape speed and decelerates forever as it climbs, never to return. Colours bake once (slate mesh,
// molten horizon ring, white-hot ejecta); all motion is the exact geodesic phase. Bounded by design.
const R_MAX = 1.9; // outer edge of the embedded region
const TAU = Math.PI * 2;

class WhiteHoleArchetype implements Archetype {
  readonly id = 'whiteHole';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // static furniture (baked): funnel mesh + horizon ring
  private nMesh = 0;
  private nRing = 0;
  private nEject = 0;
  private meshPos: Float64Array = new Float64Array(0);
  private ringPos: Float64Array = new Float64Array(0);
  // ejecta launch data (analytic trajectories, phase-cycled)
  private ejPhase: Float64Array = new Float64Array(0);
  private ejTheta: Float64Array = new Float64Array(0);
  private ejLift: Float64Array = new Float64Array(0);
  private mass = 0.22;
  private rs = 0.44;
  private spin = 0.6;
  private speed = 1;
  private t = 0;
  private buildKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(64, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.seed = config.seed;
    this.rebuild(config.params);
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round((p.mass ?? 0.22) * 200)}`;
  }

  // Flamm's paraboloid, embedded with the throat as the funnel's bottom lip
  private surfaceY(r: number): number {
    const w = 2 * Math.sqrt(Math.max(0, 2 * this.mass * (r - this.rs)));
    return 0.55 * w - 0.55;
  }

  private rebuild(p: ResolvedParams): void {
    this.mass = p.mass ?? 0.22;
    this.rs = 2 * this.mass;
    this.spin = p.spin ?? 0.6;
    this.speed = p.speed ?? 1;
    this.buildKey = this.keyOf(p);
    const rng = mulberry32((this.seed ^ 0x77a1ce11) >>> 0);
    const N = this.particleCount;
    this.nRing = Math.floor(N * 0.06);
    this.nEject = Math.floor(N * 0.34);
    this.nMesh = N - this.nRing - this.nEject;
    this.meshPos = new Float64Array(this.nMesh * 3);
    this.ringPos = new Float64Array(this.nRing * 3);
    this.ejPhase = new Float64Array(this.nEject);
    this.ejTheta = new Float64Array(this.nEject);
    this.ejLift = new Float64Array(this.nEject);
    const col = this.colors;
    let o = 0;
    // ── the funnel: Flamm's paraboloid sampled area-uniformly, brightness banded into a faint mesh ──
    for (let i = 0; i < this.nMesh; i++) {
      const r = Math.sqrt(this.rs * this.rs + (R_MAX * R_MAX - this.rs * this.rs) * rng());
      const th = rng() * TAU;
      this.meshPos[i * 3] = r * Math.cos(th);
      this.meshPos[i * 3 + 1] = this.surfaceY(r) + (rng() - 0.5) * 0.006;
      this.meshPos[i * 3 + 2] = r * Math.sin(th);
      // wireframe illusion: brightness peaks along ring + spoke lines of the embedding grid
      const rings = Math.pow(Math.abs(Math.sin(r * 34)), 6);
      const spokes = Math.pow(Math.abs(Math.sin(th * 14)), 6);
      const grid = Math.min(1, rings + spokes);
      const v = 0.05 + 0.3 * grid + 0.05 * rng();
      col[o * 3] = v * 0.55; col[o * 3 + 1] = v * 0.75; col[o * 3 + 2] = v * 0.85; // cool slate mesh
      o++;
    }
    // ── the horizon: a molten ring at r_s — the surface everything leaves and nothing crosses ──
    for (let i = 0; i < this.nRing; i++) {
      const th = rng() * TAU;
      const rr = this.rs + 0.012 + 0.025 * rng() * rng();
      this.ringPos[i * 3] = rr * Math.cos(th);
      this.ringPos[i * 3 + 1] = this.surfaceY(rr) + (rng() - 0.5) * 0.02;
      this.ringPos[i * 3 + 2] = rr * Math.sin(th);
      const v = 0.9 + 0.6 * rng();
      col[o * 3] = v * 1.15; col[o * 3 + 1] = v * 0.52; col[o * 3 + 2] = v * 0.12; // molten orange (blooms)
      o++;
    }
    // ── the ejecta: analytic reversed rain-frame flights, phase-staggered into continuous streams ──
    for (let i = 0; i < this.nEject; i++) {
      this.ejPhase[i] = rng();
      this.ejTheta[i] = rng() * TAU;
      this.ejLift[i] = 0.01 + 0.05 * rng() * rng(); // slight lift off the surface → a glowing sheath
      const v = 0.85 + 0.65 * rng();
      col[o * 3] = v * 1.0; col[o * 3 + 1] = v * 0.9; col[o * 3 + 2] = v * 0.72; // white-gold plasma
      o++;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const pos = this.positions;
    let o = 0;
    for (let i = 0; i < this.nMesh; i++, o++) {
      pos[o * 3] = this.meshPos[i * 3]; pos[o * 3 + 1] = this.meshPos[i * 3 + 1]; pos[o * 3 + 2] = this.meshPos[i * 3 + 2];
    }
    for (let i = 0; i < this.nRing; i++, o++) {
      pos[o * 3] = this.ringPos[i * 3]; pos[o * 3 + 1] = this.ringPos[i * 3 + 1]; pos[o * 3 + 2] = this.ringPos[i * 3 + 2];
    }
    // reversed Lemaître flight: r^{3/2} advances linearly in proper time (exact solution of
    // dr/dτ = +√(2M/r)), so each particle erupts fast and decelerates as it climbs
    const s0 = Math.pow(this.rs, 1.5);
    const s1 = Math.pow(R_MAX, 1.5);
    for (let i = 0; i < this.nEject; i++, o++) {
      const tau = (this.t * 0.22 + this.ejPhase[i]) % 1;
      const r = Math.pow(s0 + tau * (s1 - s0), 2 / 3);
      // small angular momentum → the fountain fans into spirals that tighten near the throat
      const th = this.ejTheta[i] + this.spin * (1 - r / R_MAX) * 2.2;
      pos[o * 3] = r * Math.cos(th);
      pos[o * 3 + 1] = this.surfaceY(r) + this.ejLift[i] * (1 + 2 * tau);
      pos[o * 3 + 2] = r * Math.sin(th);
    }
  }

  step(dt: number, p: ResolvedParams): void {
    if (this.keyOf(p) !== this.buildKey) { this.rebuild(p); return; }
    this.spin = p.spin ?? 0.6;
    this.speed = p.speed ?? 1;
    this.t += dt * this.speed;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'White hole (time-reversed Schwarzschild)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.008 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const whiteHoleFactory: ArchetypeFactory = {
  id: 'whiteHole',
  label: 'White Hole',
  category: 'Spacetime',
  kind: 'flow',
  params: [
    { key: 'mass', label: 'mass', min: 0.12, max: 0.4, step: 0.01, default: 0.22, rebuild: true }, // sets r_s = 2M
    { key: 'spin', label: 'ejecta spin', min: 0, max: 2, step: 0.05, default: 0.6 }, // angular momentum of the fountain
    { key: 'speed', label: 'eruption rate', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 90_000,
  particleCountOptions: [40_000, 90_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the fountain + funnel ARE the visual
  bloom: 0.5, // dark spacetime mesh + molten horizon → let the ring blaze
  create: (config) => new WhiteHoleArchetype(config),
};

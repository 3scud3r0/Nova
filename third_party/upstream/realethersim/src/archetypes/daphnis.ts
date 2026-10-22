import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Daphnis and the Keeler Gap. An 8-kilometre moon holds open a 42-kilometre gap in Saturn's A
// ring, and the physics of the waves it raises is pure Kepler: ring particles just inside the gap
// orbit FASTER than Daphnis, particles outside orbit slower, so everything streams past the moon
// and receives a small gravitational kick as it goes. The kicks organise into the classic
// shepherd-moon wake — scalloped edge waves whose azimuthal wavelength is 3π times the distance
// from the moon's orbit (each wavelength is one epicyclic bounce per synodic drift), trailing
// AHEAD of the moon on the inner edge and BEHIND it on the outer edge, damping downstream as ring
// collisions thermalise the kick. Daphnis' slightly inclined orbit even pulls the inner-edge
// waves out of the ring plane — the kilometre-high walls whose shadows Cassini photographed at
// Saturn's equinox. Everything here is that closed form; no integrator. Bounded.
const TAU = Math.PI * 2;
const A0 = 1.0; // Daphnis' orbit (Keeler gap centre)
const GAP = 0.03; // gap half-width
const W_EDGE = 0.028; // wave amplitude e-folding distance from the edge
const OM0 = 0.5; // moon angular speed at a = 1

class DaphnisArchetype implements Archetype {
  readonly id = 'daphnis';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly moonStart: number; // particles from here on are the moon itself
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly a: Float64Array; // semi-major axis
  private readonly th0: Float64Array; // initial longitude
  private readonly y0: Float64Array; // baked ring thickness
  private mass = 1;
  private tilt = 1;
  private speed = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(1024, config.particleCount);
    this.particleCount = N;
    const NM = Math.max(180, Math.floor(N * 0.004)); // the moon: a tiny cluster
    this.moonStart = N - NM;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.a = new Float64Array(this.moonStart);
    this.th0 = new Float64Array(this.moonStart);
    this.y0 = new Float64Array(this.moonStart);
    const rng = mulberry32((config.seed ^ 0x5bd1e995) >>> 0);
    for (let i = 0; i < this.moonStart; i++) {
      // ring annulus around the gap, gap itself swept clean; extra density near the edges
      let a: number;
      do {
        a = rng() < 0.55
          ? A0 + (GAP + 0.07 * Math.pow(rng(), 1.6)) * (rng() < 0.5 ? -1 : 1) // edge-hugging
          : 0.72 + 0.6 * rng(); // broad ring
      } while (Math.abs(a - A0) < GAP);
      this.a[i] = a;
      this.th0[i] = rng() * TAU;
      this.y0[i] = (rng() - 0.5) * 0.006;
      // ringlet banding, baked: interference of a few radial frequencies + grain
      const band =
        0.55 +
        0.24 * Math.sin(a * 61.0) +
        0.14 * Math.sin(a * 23.7 + 1.3) +
        0.07 * Math.sin(a * 151.0 + 4.1);
      const bri = Math.max(0.16, band) * (0.75 + 0.5 * rng()) * 1.55;
      const o = i * 3;
      this.colors[o] = 1.0 * bri; // Saturn's rings: sunlit water-ice cream
      this.colors[o + 1] = 0.93 * bri;
      this.colors[o + 2] = 0.8 * bri;
    }
    for (let i = this.moonStart; i < N; i++) {
      const o = i * 3;
      const b = 1.6 + 0.7 * rng();
      this.colors[o] = b; this.colors[o + 1] = b * 0.97; this.colors[o + 2] = b * 0.9;
    }
    this.readParams(config.params);
    // waves already developed all round the gap (closed form — any t is valid)
    this.t = 10.9;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.mass = p.mass ?? 1;
    this.tilt = p.tilt ?? 1;
    this.speed = p.speed ?? 1;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const t = this.t * this.speed;
    const thM = OM0 * t; // Daphnis' longitude
    const amp0 = this.mass * 0.026;
    for (let i = 0; i < this.moonStart; i++) {
      const a = this.a[i];
      const th = this.th0[i] + OM0 * Math.pow(a, -1.5) * t; // Kepler shear
      const d = Math.abs(a - A0);
      // downstream angle since the last moon encounter: inner particles overtake the moon
      // (wake trails ahead of it), outer particles fall behind (wake trails behind it)
      let chi = (a < A0 ? th - thM : thM - th) % TAU;
      if (chi < 0) chi += TAU;
      // edge wave: azimuthal wavelength 3π·Δa → phase = 2χ·a/(3Δa); amplitude peaked at the
      // edge, switched on smoothly past the moon, damped downstream by collisions
      const on = chi < 0.25 ? (chi / 0.25) * (chi / 0.25) * (3 - 2 * (chi / 0.25)) : 1;
      const amp = amp0 * Math.exp(-(d - GAP) / W_EDGE) * on * Math.exp(-chi * 0.32);
      const phase = (2 / 3) * (chi * a) / d;
      const r = a + amp * Math.cos(phase) * (a < A0 ? 1 : -1); // edges bulge INTO the gap first
      const y = this.y0[i] + this.tilt * amp * 1.2 * Math.sin(phase);
      const o = i * 3;
      pos[o] = r * Math.cos(th);
      pos[o + 1] = y;
      pos[o + 2] = r * Math.sin(th);
    }
    // the moon itself: a tiny ball riding the gap centre
    const mx = Math.cos(thM), mz = Math.sin(thM);
    const rngM = mulberry32(0x9d2c5680);
    for (let i = this.moonStart; i < this.particleCount; i++) {
      const u = rngM() * TAU, v = Math.acos(2 * rngM() - 1), rr = 0.012 * Math.cbrt(rngM());
      const o = i * 3;
      pos[o] = mx + rr * Math.sin(v) * Math.cos(u);
      pos[o + 1] = rr * Math.cos(v);
      pos[o + 2] = mz + rr * Math.sin(v) * Math.sin(u);
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
    return [{ id: 'root', parentId: null, label: 'Keeler gap + Daphnis', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.008 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const daphnisFactory: ArchetypeFactory = {
  id: 'daphnis',
  label: 'Shepherd Moon',
  category: 'Orbital',
  kind: 'flow',
  params: [
    { key: 'mass', label: 'moon mass', min: 0.2, max: 3, step: 0.05, default: 1 }, // wave amplitude
    { key: 'tilt', label: 'inclination', min: 0, max: 2, step: 0.05, default: 1 }, // vertical walls
    { key: 'speed', label: 'orbit speed', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 160_000,
  particleCountOptions: [80_000, 160_000, 260_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the ring is a continuous sheet — trails would smear the banding
  bloom: 0.3, // sunlit ice, not neon
  create: (config) => new DaphnisArchetype(config),
};

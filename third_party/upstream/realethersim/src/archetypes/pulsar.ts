import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Pulsar. A city-sized star, heavier than the Sun, spinning up to hundreds of times a second, with a
// magnetic field a trillion times Earth's. Its radio beams pour out of the MAGNETIC poles — and
// because the magnetic axis is tilted against the spin axis, the beams sweep the sky like a
// lighthouse: if one happens to cross Earth, we hear a metronome tick. That lighthouse geometry is
// the whole system here, drawn honestly: a dipole magnetosphere (field lines r = L·sin²θ — the exact
// vacuum-dipole shape), two beams streaming from the tilted magnetic poles, and an equatorial wind
// spiralling out where the corotating field flings plasma away. Everything is baked in the MAGNETIC
// frame; per frame two rotations (tilt about z, then spin about y) turn the whole magnetosphere —
// the sweep IS the physics. Bounded (fixed shells; beams and wind phase-cycle within the frame).
const R_NS = 0.1; // neutron star radius (render units)
const BEAM_LEN = 2.1; // beam extent
const TAU = Math.PI * 2;

class PulsarArchetype implements Archetype {
  readonly id = 'pulsar';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // baked local coordinates in the MAGNETIC frame (dipole axis = local y)
  private nStar = 0;
  private nField = 0;
  private nBeam = 0;
  private nWind = 0;
  private starL: Float64Array = new Float64Array(0);
  private fieldL: Float64Array = new Float64Array(0);
  private beamFrac: Float64Array = new Float64Array(0); // fraction along the beam (streams)
  private beamAng: Float64Array = new Float64Array(0); // azimuth within the beam cone
  private beamRad: Float64Array = new Float64Array(0); // radial spread within the cone
  private beamSgn: Float64Array = new Float64Array(0); // +1 north pole, −1 south
  private windAng: Float64Array = new Float64Array(0); // wind spiral launch azimuth (spin frame)
  private windFrac: Float64Array = new Float64Array(0);
  private tilt = 0.7;
  private spin = 1.2;
  private wind = 0.8;
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
    return `${Math.round(p.shells ?? 5)}`;
  }

  private rebuild(p: ResolvedParams): void {
    const shells = Math.max(2, Math.round(p.shells ?? 5));
    this.tilt = p.tilt ?? 0.7;
    this.spin = p.spin ?? 1.2;
    this.wind = p.wind ?? 0.8;
    this.buildKey = this.keyOf(p);
    const rng = mulberry32((this.seed ^ 0x452821e6) >>> 0);
    const N = this.particleCount;
    this.nStar = Math.floor(N * 0.05);
    this.nBeam = Math.floor(N * 0.22);
    this.nWind = Math.floor(N * 0.12);
    this.nField = N - this.nStar - this.nBeam - this.nWind;
    this.starL = new Float64Array(this.nStar * 3);
    this.fieldL = new Float64Array(this.nField * 3);
    this.beamFrac = new Float64Array(this.nBeam);
    this.beamAng = new Float64Array(this.nBeam);
    this.beamRad = new Float64Array(this.nBeam);
    this.beamSgn = new Float64Array(this.nBeam);
    this.windAng = new Float64Array(this.nWind);
    this.windFrac = new Float64Array(this.nWind);
    const col = this.colors;
    let o = 0;
    // ── the star: a dense white-hot ball (bloom makes it a beacon) ──
    for (let i = 0; i < this.nStar; i++) {
      const u = rng() * 2 - 1, az = rng() * TAU;
      const sr = Math.sqrt(Math.max(0, 1 - u * u));
      const r = R_NS * Math.cbrt(rng());
      this.starL[i * 3] = r * sr * Math.cos(az);
      this.starL[i * 3 + 1] = r * u;
      this.starL[i * 3 + 2] = r * sr * Math.sin(az);
      const v = 1.1 + 0.5 * rng();
      col[o * 3] = v * 1.1; col[o * 3 + 1] = v * 0.55; col[o * 3 + 2] = v * 0.4; // red-hot surface
      o++;
    }
    // ── dipole field lines: r(θ) = L·sin²θ, several shells × many meridian planes (the teal cage) ──
    for (let i = 0; i < this.nField; i++) {
      const shell = 1 + Math.floor(rng() * shells);
      const L = 0.35 + 0.42 * shell + (rng() - 0.5) * 0.05; // shell apex radius
      const phi = Math.floor(rng() * 24) * (TAU / 24) + (rng() - 0.5) * 0.03; // meridian planes
      const th = 0.25 + rng() * (Math.PI - 0.5); // polar angle along the loop
      const r = Math.max(R_NS, L * Math.sin(th) * Math.sin(th));
      const x = r * Math.sin(th) * Math.cos(phi);
      const y = r * Math.cos(th);
      const z = r * Math.sin(th) * Math.sin(phi);
      this.fieldL[i * 3] = x; this.fieldL[i * 3 + 1] = y; this.fieldL[i * 3 + 2] = z;
      const v = (0.16 + 0.22 * rng()) * (1.15 - 0.12 * shell * 0.5);
      col[o * 3] = v * 0.4; col[o * 3 + 1] = v * 0.95; col[o * 3 + 2] = v * 1.05; // teal field cage
      o++;
    }
    // ── polar beams: streaming cones from the magnetic poles (the lighthouse) ──
    for (let i = 0; i < this.nBeam; i++) {
      this.beamFrac[i] = rng();
      this.beamAng[i] = rng() * TAU;
      this.beamRad[i] = Math.pow(rng(), 1.6); // dense spine, wispy edge
      this.beamSgn[i] = i % 2 === 0 ? 1 : -1;
      const v = 0.7 + 0.7 * rng();
      col[o * 3] = v * 0.85; col[o * 3 + 1] = v * 0.75; col[o * 3 + 2] = v * 1.15; // white-violet beam
      o++;
    }
    // ── equatorial wind: plasma flung along an Archimedean spiral in the SPIN equator ──
    for (let i = 0; i < this.nWind; i++) {
      this.windAng[i] = rng() * TAU;
      this.windFrac[i] = rng();
      const v = 0.14 + 0.2 * rng();
      col[o * 3] = v * 0.5; col[o * 3 + 1] = v * 0.95; col[o * 3 + 2] = v * 1.0; // cyan wind sheet
      o++;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const pos = this.positions;
    const t = this.t;
    const phase = this.spin * t; // spin angle about the world y (rotation) axis
    const cs = Math.cos(phase), ss = Math.sin(phase);
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    // magnetic frame → world: tilt about z (magnetic axis leans), then spin about y
    const place = (o: number, lx: number, ly: number, lz: number): void => {
      const tx = lx * ct - ly * st; // tilt about z
      const ty = lx * st + ly * ct;
      const wx = tx * cs + lz * ss; // spin about y
      const wz = -tx * ss + lz * cs;
      pos[o * 3] = wx; pos[o * 3 + 1] = ty; pos[o * 3 + 2] = wz;
    };
    let o = 0;
    for (let i = 0; i < this.nStar; i++, o++) place(o, this.starL[i * 3], this.starL[i * 3 + 1], this.starL[i * 3 + 2]);
    for (let i = 0; i < this.nField; i++, o++) place(o, this.fieldL[i * 3], this.fieldL[i * 3 + 1], this.fieldL[i * 3 + 2]);
    // beams: points stream outward along the tilted magnetic axis (phase-cycled), slight cone spread
    for (let i = 0; i < this.nBeam; i++, o++) {
      const f = (this.beamFrac[i] + t * 0.55) % 1;
      const d = R_NS + f * BEAM_LEN;
      const spread = 0.03 + 0.09 * f; // gentle opening
      const rr = this.beamRad[i] * spread * d;
      const a = this.beamAng[i];
      const sgn = this.beamSgn[i];
      place(o, rr * Math.cos(a), sgn * d, rr * Math.sin(a));
    }
    // wind: Archimedean spiral in the SPIN equator (world frame) — a rotating sprinkler of plasma
    const windOut = 0.5 + this.wind;
    for (let i = 0; i < this.nWind; i++) {
      const f = (this.windFrac[i] + t * 0.16 * windOut) % 1;
      const r = 0.55 + f * 1.75;
      const a = this.windAng[i] + phase - f * (2.4 / windOut); // trailing spiral, corotating at launch
      const oo = o + i;
      pos[oo * 3] = r * Math.cos(a);
      pos[oo * 3 + 1] = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.04 - 0.02; // thin sheet
      pos[oo * 3 + 2] = r * Math.sin(a);
    }
  }

  step(dt: number, p: ResolvedParams): void {
    if (this.keyOf(p) !== this.buildKey) { this.rebuild(p); return; }
    this.tilt = p.tilt ?? 0.7;
    this.spin = p.spin ?? 1.2;
    this.wind = p.wind ?? 0.8;
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Pulsar (lighthouse magnetosphere)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.007 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const pulsarFactory: ArchetypeFactory = {
  id: 'pulsar',
  label: 'Pulsar',
  category: 'Plasma',
  kind: 'flow',
  params: [
    { key: 'tilt', label: 'magnetic tilt', min: 0, max: 1.5, step: 0.05, default: 0.7 }, // α between spin + magnetic axes
    { key: 'spin', label: 'spin rate', min: 0, max: 4, step: 0.05, default: 1.2 },
    { key: 'shells', label: 'field shells', min: 2, max: 8, step: 1, default: 5, rebuild: true },
    { key: 'wind', label: 'wind', min: 0, max: 2, step: 0.05, default: 0.8 },
  ],
  defaultParticleCount: 90_000,
  particleCountOptions: [40_000, 90_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the sweeping magnetosphere IS the visual
  create: (config) => new PulsarArchetype(config),
};

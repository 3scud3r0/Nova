import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';
import { mulberry32 } from '../state/rng';

// Dispersion. A point source on a disk emits a continuous circular wave; in a DISPERSIVE medium the
// phase speed depends on wavelength, so a pulse spreads and its colours sort by distance — long and
// short wavelengths end up at different radii (a spatial "chirp"). We render that as a slowly
// tumbling disk of points: the height is a travelling radial wave cos(k·r − ω·t) whose crests
// propagate outward from an off-centre source, and the colour is the dispersed spectrum baked by
// radius — so each crest RECOLOURS as it travels out through the spectrum. The disk rotates about
// the vertical axis, swinging its rippled face past edge-on to the smooth back. Grain comes from a
// jittered sunflower point layout. Bounded for all time (a cosine on a fixed disk).
const RDISK = 1.5; // disk radius in render units
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // golden angle → even, isotropic sunflower packing
const TAU = Math.PI * 2;
const DOME = 0.55; // base spherical-cap bulge → the disk is a shallow bowl, not a flat plane
const ROCK = 0.9; // peak rocking angle (rad) — rocks ±51°, so it never collapses to an edge-on line
const TILTX = 0.3; // fixed back-tilt → we look slightly into the bowl; foreshortens rings to ellipses

class DispersionArchetype implements Archetype {
  readonly id = 'dispersionWave';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly px: Float64Array; // baked disk-plane x (object space, pre-rotation)
  private readonly py: Float64Array; // baked disk-plane y
  private readonly rad: Float64Array; // baked distance from the source point
  private readonly jz: Float64Array; // baked per-point depth grain (no per-frame flicker)
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private k = 9; // spatial frequency → number of rings
  private omega = 2.2; // propagation speed
  private amp = 0.32; // relief amplitude
  private falloff = 0.7; // how fast the ripple decays away from the source
  private spin = 0.5; // tumble rate (rad/s)
  private t = 0;
  private buildKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    this.particleCount = Math.max(1, config.particleCount);
    this.px = new Float64Array(this.particleCount);
    this.py = new Float64Array(this.particleCount);
    this.rad = new Float64Array(this.particleCount);
    this.jz = new Float64Array(this.particleCount);
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.seed = config.seed;
    this.rebuild(config.params);
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round((p.offset ?? 0.55) * 100)},${Math.round((p.wavelength ?? 9) * 10)},${Math.round((p.dispersion ?? 0.62) * 100)}`;
  }

  // Re-bake the disk layout + colours on a structural change (source offset / wavelength /
  // dispersion). Colours upload once, so the dispersed spectrum is baked by radius here; only the
  // travelling relief (positions) animates per frame.
  private rebuild(p: ResolvedParams): void {
    const offset = p.offset ?? 0.55; // source distance from centre, as a fraction of RDISK
    const disp = p.dispersion ?? 0.62; // how far the spectrum sweeps from core to rim
    this.k = p.wavelength ?? 9;
    this.omega = p.speed ?? 2.2;
    this.amp = p.amp ?? 0.4;
    this.falloff = p.falloff ?? 0.55;
    this.spin = p.spin ?? 0.4;
    this.buildKey = this.keyOf(p);
    const rng = mulberry32((this.seed ^ 0x6d2b79f5) >>> 0);
    const N = this.particleCount;
    const sx = offset * RDISK; // source on the +x axis, off-centre
    const sy = 0;
    const rMax = RDISK + Math.abs(sx); // source-to-far-rim, for colour normalisation
    const col = this.colors;
    // Reserve a dense cluster AT the source so it blooms to an over-exposed white-hot point (uniform
    // disk density alone can't concentrate enough light there). The rest is the area-uniform sunflower.
    const nCore = Math.max(1, Math.floor(N * 0.025));
    const nDisk = N - nCore;
    const jitter = (RDISK / Math.sqrt(nDisk)) * 1.4; // radial jitter ≈ one point spacing → breaks spiral arms
    for (let i = 0; i < N; i++) {
      let x: number;
      let y: number;
      if (i < nCore) {
        const a = rng() * TAU; // tight Gaussian-ish blob at the source
        const rr = Math.sqrt(rng()) * 0.085;
        x = sx + rr * Math.cos(a);
        y = sy + rr * Math.sin(a);
      } else {
        const j = i - nCore;
        const rr = Math.sqrt((j + 0.5) / nDisk) * RDISK; // area-uniform radius
        const ang = j * GOLDEN + (rng() - 0.5) * 0.6;
        x = (rr + (rng() - 0.5) * jitter) * Math.cos(ang);
        y = (rr + (rng() - 0.5) * jitter) * Math.sin(ang);
      }
      this.px[i] = x;
      this.py[i] = y;
      const ri = Math.hypot(x - sx, y - sy);
      this.rad[i] = ri;
      this.jz[i] = (rng() - 0.5) * (i < nCore ? 0.02 : 0.04); // baked depth grain → dusty volumetric surface
      // ── dispersed spectrum baked by radius ──
      const rn = Math.min(1, ri / rMax);
      const rd = Math.pow(rn, 1.6); // warm hues linger near the core, then disperse outward
      const hue = (0.14 - disp * rd + 1) % 1; // yellow → orange → red → magenta → blue → cyan
      const sat = Math.min(1, 0.4 + 4 * rn); // saturate quickly past the white-hot core
      const band = 0.72 + 0.28 * Math.cos(this.k * ri); // concentric colour rings
      const core = Math.exp(-(rn * rn) * 40) * 2.2; // tight over-exposed source bloom (doesn't wash the warm rings)
      const light = Math.min(1, (0.16 + 0.5 * Math.exp(-rn * 1.4)) * band + core);
      hslToRgb(hue, sat, light, col, i * 3);
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const N = this.particleCount;
    const pos = this.positions;
    const th = ROCK * Math.sin(this.spin * this.t); // rock about the vertical axis (never full edge-on)
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const cx = Math.cos(TILTX);
    const sx = Math.sin(TILTX);
    const invR2 = 1 / (RDISK * RDISK);
    for (let i = 0; i < N; i++) {
      const x = this.px[i];
      const y = this.py[i];
      const ri = this.rad[i];
      // base bowl: a shallow domed cap so the object has DEPTH and reads as 3-D from every angle.
      const rc2 = x * x + y * y;
      const dome = DOME * (1 - rc2 * invR2);
      // travelling radial wave from the source: crests propagate outward, decaying with distance.
      const ripple = this.amp * Math.exp(-ri * this.falloff) * Math.cos(this.k * ri - this.omega * this.t);
      const z = dome + ripple + this.jz[i];
      // rock about Y, then lean back about X → a bowl rocking at a pleasing 3/4, rings foreshortened
      const rx = x * ct + z * st;
      const rz = -x * st + z * ct;
      const o = i * 3;
      pos[o] = rx;
      pos[o + 1] = y * cx - rz * sx;
      pos[o + 2] = y * sx + rz * cx;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const key = this.keyOf(p);
    if (key !== this.buildKey) {
      this.rebuild(p);
      return;
    }
    this.omega = p.speed ?? 2.2;
    this.amp = p.amp ?? 0.4;
    this.falloff = p.falloff ?? 0.55;
    this.spin = p.spin ?? 0.4;
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return new Float64Array([this.t]);
  }
  loadState(s: Float64Array): void {
    this.t = s[0] ?? 0;
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Dispersive wavefront', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.011 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const dispersionWaveFactory: ArchetypeFactory = {
  id: 'dispersionWave',
  label: 'Dispersion',
  category: 'Spectral',
  kind: 'flow',
  params: [
    { key: 'wavelength', label: 'rings', min: 3, max: 24, step: 0.5, default: 9, rebuild: true }, // spatial frequency k
    { key: 'dispersion', label: 'dispersion', min: 0, max: 1, step: 0.01, default: 0.62, rebuild: true }, // spectrum spread
    { key: 'offset', label: 'source offset', min: 0, max: 0.9, step: 0.02, default: 0.55, rebuild: true }, // source off-centre
    { key: 'speed', label: 'wave speed', min: 0, max: 6, step: 0.1, default: 2.2 }, // ω, crest propagation
    { key: 'amp', label: 'relief', min: 0, max: 0.8, step: 0.02, default: 0.4 }, // height amplitude
    { key: 'falloff', label: 'reach', min: 0.2, max: 2, step: 0.05, default: 0.55 }, // ripple decay (low = reaches further)
    { key: 'spin', label: 'tumble', min: 0, max: 2, step: 0.05, default: 0.4 }, // rotation rate
  ],
  defaultParticleCount: 90_000,
  particleCountOptions: [40_000, 90_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the wavefront IS the visual
  create: (config) => new DispersionArchetype(config),
};

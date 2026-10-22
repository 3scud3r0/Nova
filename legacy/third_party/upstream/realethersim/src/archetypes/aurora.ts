import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Aurora Borealis. Solar-wind electrons, funnelled along Earth's magnetic field lines, crash into
// the polar upper atmosphere and make it glow. The physics writes the picture: the vertical RAYS
// are the field lines themselves (precipitating electrons spiral tightly around them); the colours
// are atomic spectra by altitude — nitrogen's purple-magenta fringe at the lower border (~95 km),
// atomic oxygen's emerald 557.7 nm line through the body (100–250 km), and oxygen's slow red
// 630 nm line at the top, where the air is thin enough that the excited state survives its 110 s
// radiative lifetime without being collisionally quenched. The curtain's folds are travelling
// waves rippling along the arc (Alfvénic curls), and the whole sky is doubled in a still lake
// below. Every colour is baked once; the drapery motion and the downward streaming live entirely
// in positions. Bounded.
const TAU = Math.PI * 2;
const RAYS = 110; // discrete field-line striations along the arc
const SPAN = 4.4; // arc width
const Y_BASE = 0.06; // lower border height above the lake (y = 0 is the waterline)
const HGT = 1.7; // curtain height scale

class AuroraArchetype implements Archetype {
  readonly id = 'aurora';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly skyCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly s: Float64Array; // position along the arc (0..1)
  private readonly h: Float64Array; // baked altitude fraction (0..1, biased to the bright lower border)
  private readonly tall: Float64Array; // per-particle ray-height multiplier
  private readonly ph: Float64Array; // streaming / shimmer phase
  private activity = 1;
  private folds = 0.9;
  private streamers = 0.9;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(128, config.particleCount);
    this.particleCount = N;
    const NS = Math.ceil(N * 0.7); // sky particles; the rest are their lake reflections
    this.skyCount = NS;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.s = new Float64Array(NS);
    this.h = new Float64Array(NS);
    this.tall = new Float64Array(NS);
    this.ph = new Float64Array(NS);
    const rng = mulberry32((config.seed ^ 0x9e3779b9) >>> 0);
    // per-ray character: some rays tall and brilliant, some short and faint
    const rayTall = new Float64Array(RAYS);
    const rayBright = new Float64Array(RAYS);
    for (let r = 0; r < RAYS; r++) {
      rayTall[r] = 0.62 + 0.55 * rng() + 0.35 * rng() * rng(); // few tall searchlights, many modest
      rayBright[r] = 0.45 + 0.85 * rng();
    }
    for (let i = 0; i < NS; i++) {
      // 35% diffuse sheet between rays (the curtain is continuous), the rest bound to a field line
      const diffuse = rng() < 0.35;
      let bri: number;
      if (diffuse) {
        this.s[i] = rng();
        this.tall[i] = 0.6 + 0.6 * rng();
        bri = 0.55;
      } else {
        const ray = Math.floor(rng() * RAYS);
        this.s[i] = (ray + 0.5) / RAYS + (rng() - 0.5) * 0.007;
        this.tall[i] = rayTall[ray] * (0.85 + 0.3 * rng());
        bri = rayBright[ray];
      }
      const h = Math.pow(rng(), 1.35); // bottom-heavy, but the emerald body keeps the mass
      this.h[i] = h;
      this.ph[i] = rng();
      // altitude → atomic spectrum: N2+ purple fringe → O 557.7 nm green → O 630 nm red
      let cr: number, cg: number, cb: number;
      if (h < 0.07) {
        const f = h / 0.07;
        cr = 0.55 + (0.12 - 0.55) * f;
        cg = 0.28 + (1.0 - 0.28) * f;
        cb = 0.95 + (0.42 - 0.95) * f;
      } else if (h < 0.6) {
        cr = 0.12; cg = 1.0; cb = 0.42;
      } else {
        const f = (h - 0.6) / 0.4;
        cr = 0.12 + (0.85 - 0.12) * f;
        cg = 1.0 + (0.2 - 1.0) * f;
        cb = 0.42 + (0.32 - 0.42) * f;
      }
      // brightest at the lower border, fading with altitude (quenching wins down low for red,
      // recombination runs out up high for green)
      const glow = bri * (2.7 * Math.exp(-2.2 * Math.max(0, h - 0.1)) + 0.24) * (0.9 + 0.2 * rng());
      const o = i * 3;
      this.colors[o] = cr * glow;
      this.colors[o + 1] = cg * glow;
      this.colors[o + 2] = cb * glow;
      // the lake's copy: dimmed, slightly blue-shifted by the water
      const j = NS + i;
      if (j < N) {
        this.colors[j * 3] = cr * glow * 0.14;
        this.colors[j * 3 + 1] = cg * glow * 0.18;
        this.colors[j * 3 + 2] = cb * glow * 0.24;
      }
    }
    this.readParams(config.params);
    // start with the drapery already developed (pure closed-form — any t is valid)
    this.t = 8;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.activity = p.activity ?? 1;
    this.folds = p.folds ?? 0.9;
    this.streamers = p.streamers ?? 0.9;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const NS = this.skyCount;
    const N = this.particleCount;
    const t = this.t;
    const act = this.activity;
    const fold = this.folds;
    const stream = this.streamers;
    for (let i = 0; i < NS; i++) {
      const s = this.s[i];
      const x = (s - 0.5) * SPAN;
      // travelling folds along the arc: two long waves + a fine ripple, all drifting
      const z =
        fold * (0.5 * Math.sin(s * 6.8 + t * 0.33 * act) + 0.28 * Math.sin(s * 3.1 - t * 0.21 * act)) +
        0.09 * Math.sin(s * 19 + t * 0.9 * act) - 0.4;
      // precipitation: a desynchronised sawtooth slide down the field line — proportional to
      // altitude, so nothing piles up at the lower border (the clamp-accumulation bug)
      const cyc = (this.ph[i] + t * 0.14 * act) % 1;
      const y = Y_BASE + this.h[i] * this.tall[i] * HGT * (1 - 0.28 * stream * cyc);
      // the curtain leans a little more the higher you go
      const zLean = z + 0.15 * this.h[i] * Math.sin(t * 0.4 * act + s * 2.0);
      const o = i * 3;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = zLean;
      // lake reflection: mirrored below the waterline, slightly compressed, rippled by the water
      const j = NS + i;
      if (j < N) {
        const q = j * 3;
        pos[q] = x + 0.025 * Math.sin(t * 2.6 * act + this.ph[i] * TAU + y * 3.0);
        pos[q + 1] = -y * 0.97;
        pos[q + 2] = zLean;
      }
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
    return [{ id: 'root', parentId: null, label: 'auroral curtain + lake', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.022 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const auroraFactory: ArchetypeFactory = {
  id: 'aurora',
  label: 'Aurora Borealis',
  category: 'Plasma',
  kind: 'flow',
  params: [
    { key: 'activity', label: 'activity', min: 0.2, max: 3, step: 0.05, default: 1 }, // substorm tempo
    { key: 'folds', label: 'curtain folds', min: 0, max: 1.5, step: 0.05, default: 0.9 },
    { key: 'streamers', label: 'streamers', min: 0, max: 2, step: 0.05, default: 0.9 }, // precipitation depth
  ],
  defaultParticleCount: 160_000,
  particleCountOptions: [90_000, 160_000, 320_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the curtain is continuous — trails would smear the rays
  bloom: 0.75, // emerald glow against polar night
  create: (config) => new AuroraArchetype(config),
};

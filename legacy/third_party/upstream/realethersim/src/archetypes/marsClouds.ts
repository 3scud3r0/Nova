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

// Martian Iridescent Clouds. In 2021 the Curiosity rover photographed something almost nobody
// expected on a desert planet: noctilucent "mother-of-pearl" clouds, shimmering in pastel bands at
// twilight, ~60–80 km up where CO₂ ice can condense. The iridescence is real optics: when a young
// cloud's droplets are all nearly the SAME size, each size diffracts sunlight at its own angle, so
// bands of uniform droplet size paint bands of soft colour — pearl pinks, teals and golds (the same
// physics as Earth's polar stratospheric clouds). We model the phenomenon honestly and keep it
// subtle, the way Curiosity saw it: a thin high cloud sheet undulating on atmospheric GRAVITY WAVES
// (buoyancy oscillations — the wave-trains Mars' thin air carries beautifully), drifting with the
// wind over a dim rust horizon. Droplet-size bands (→ colour) are baked per parcel and ride the
// cloud; the waves and the wind are the motion. Bounded (waves on a fixed sheet, wrapped drift).
const XW = 1.8; // half-width of the sheet
const ZW = 0.55; // half-depth
const Y0 = 0.42; // sheet altitude in frame

class MarsCloudsArchetype implements Archetype {
  readonly id = 'marsClouds';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private nGround = 0;
  private nCloud = 0;
  private gnd: Float64Array = new Float64Array(0); // static rusty horizon haze
  private cx: Float64Array = new Float64Array(0); // cloud parcel rest positions
  private cz: Float64Array = new Float64Array(0);
  private cyj: Float64Array = new Float64Array(0); // per-parcel altitude jitter
  private waviness = 0.5;
  private wind = 0.35;
  private shimmer = 1;
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
    return `${Math.round((p.bands ?? 3) * 10)}`;
  }

  private rebuild(p: ResolvedParams): void {
    const bands = p.bands ?? 3; // droplet-size band frequency across the sheet
    this.waviness = p.waviness ?? 0.5;
    this.wind = p.wind ?? 0.35;
    this.shimmer = p.shimmer ?? 1;
    this.buildKey = this.keyOf(p);
    const rng = mulberry32((this.seed ^ 0x3c6ef372) >>> 0);
    const N = this.particleCount;
    this.nGround = Math.floor(N * 0.07);
    this.nCloud = N - this.nGround;
    this.gnd = new Float64Array(this.nGround * 3);
    this.cx = new Float64Array(this.nCloud);
    this.cz = new Float64Array(this.nCloud);
    this.cyj = new Float64Array(this.nCloud);
    const col = this.colors;
    let o = 0;
    // ── the rusty horizon: a dim regolith haze strip (twilight Mars below the cloud deck) ──
    for (let i = 0; i < this.nGround; i++) {
      this.gnd[i * 3] = (rng() * 2 - 1) * XW * 1.05;
      this.gnd[i * 3 + 1] = -0.85 - 0.25 * rng() * rng();
      this.gnd[i * 3 + 2] = (rng() * 2 - 1) * ZW;
      const v = 0.05 + 0.09 * rng();
      col[o * 3] = v * 1.5; col[o * 3 + 1] = v * 0.75; col[o * 3 + 2] = v * 0.45; // dim rust
      o++;
    }
    // ── the cloud sheet: patchy density, mother-of-pearl bands baked by droplet-size proxy ──
    for (let i = 0; i < this.nCloud; i++) {
      const x = (rng() * 2 - 1) * XW;
      const z = (rng() * 2 - 1) * ZW;
      this.cx[i] = x;
      this.cz[i] = z;
      this.cyj[i] = (rng() - 0.5) * 0.05;
      // patchy wisps: a few interfering long waves make some regions dense, some near-empty
      const dens =
        0.5 +
        0.5 * Math.sin(x * 2.1 + 4.7) * Math.sin(z * 5.3 + 1.3) +
        0.35 * Math.sin(x * 4.6 + z * 3.1 + 2.2);
      const d = Math.max(0, Math.min(1, dens));
      // droplet-size bands → iridescent hue, drifting diagonally across the sheet with the parcel
      const b = (x * 0.9 + z * 0.55) * bands + 0.8 * Math.sin(x * 1.7 - z * 2.4);
      const hue = (0.52 + 0.16 * Math.sin(b) + 0.09 * Math.sin(2.3 * b + 1.1) + 1) % 1; // teal↔pink↔gold pastels
      const sat = 0.48 + 0.32 * Math.abs(Math.sin(b * 0.5 + 0.7)); // band cores most uniform → most saturated
      const light = 0.2 + 0.66 * d * d + 0.08 * rng(); // wispy edges stay dim
      hslToRgb(hue, sat, Math.min(0.82, light), col, o * 3);
      o++;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const pos = this.positions;
    let o = 0;
    for (let i = 0; i < this.nGround; i++, o++) {
      pos[o * 3] = this.gnd[i * 3]; pos[o * 3 + 1] = this.gnd[i * 3 + 1]; pos[o * 3 + 2] = this.gnd[i * 3 + 2];
    }
    // gravity-wave trains: a few coherent buoyancy waves undulate the sheet while the wind advects it
    const t = this.t;
    const A = 0.09 * this.waviness;
    const w1 = 1.1 * this.shimmer, w2 = 0.7 * this.shimmer, w3 = 1.7 * this.shimmer;
    for (let i = 0; i < this.nCloud; i++, o++) {
      // wind drift with seamless wrap (parcels — and their baked colours — ride the wind)
      let x = this.cx[i] + this.wind * t * 0.2;
      x = ((x + XW) % (2 * XW) + 2 * XW) % (2 * XW) - XW;
      const z = this.cz[i];
      const y =
        Y0 +
        this.cyj[i] +
        A * Math.sin(x * 3.4 + z * 1.2 - w1 * t) +
        A * 0.7 * Math.sin(x * 1.6 - z * 2.8 + w2 * t) +
        A * 0.45 * Math.sin(x * 6.2 + z * 4.1 + w3 * t);
      pos[o * 3] = x;
      pos[o * 3 + 1] = y;
      pos[o * 3 + 2] = z + 0.03 * Math.sin(x * 2.2 + w2 * t); // gentle depth sway
    }
  }

  step(dt: number, p: ResolvedParams): void {
    if (this.keyOf(p) !== this.buildKey) { this.rebuild(p); return; }
    this.waviness = p.waviness ?? 0.5;
    this.wind = p.wind ?? 0.35;
    this.shimmer = p.shimmer ?? 1;
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Martian iridescent clouds', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.009 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const marsCloudsFactory: ArchetypeFactory = {
  id: 'marsClouds',
  label: 'Martian Clouds',
  category: 'Atmosphere',
  kind: 'flow',
  params: [
    { key: 'bands', label: 'iridescent bands', min: 1, max: 6, step: 0.5, default: 3, rebuild: true }, // droplet-size band frequency
    { key: 'waviness', label: 'gravity waves', min: 0, max: 1.2, step: 0.05, default: 0.5 }, // undulation amplitude
    { key: 'wind', label: 'wind', min: 0, max: 1.5, step: 0.05, default: 0.35 }, // drift speed
    { key: 'shimmer', label: 'shimmer', min: 0.2, max: 3, step: 0.05, default: 1 }, // wave speed
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the cloud sheet IS the visual
  create: (config) => new MarsCloudsArchetype(config),
};

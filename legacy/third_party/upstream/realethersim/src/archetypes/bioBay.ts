import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Bioluminescent Bay. In a handful of bays (Vieques' Mosquito Bay most famously) the water is thick
// with dinoflagellates — single cells that FLASH blue when mechanically disturbed. The luciferin
// flash is a shear-stress response: nothing glows until something moves, and then the water answers —
// a swimmer's hand, a paddle stroke, a fish, each trailing a wake of light that blooms and fades.
// We simulate exactly that stimulus–response: invisible swimmers roam the dark surface, and a pool of
// flash points activates along their wakes. Colours are baked once, so the fade is choreographed with
// POSITIONS: each flash slot cycles on a fixed phase offset — while lit it holds the spot where the
// swimmer passed (rising, then diffusing outward as it sinks), and when its glow ends it parks in a
// deep scattered layer where its light thins into the bay's faint ambient sea-sparkle. Bounded ∀t.
const TAU = Math.PI * 2;
const CYCLE = 2.4; // seconds per flash-slot cycle — most of the pool is lit in the wake (~⅔ duty), the rest is ambient sparkle
const BAY = 1.5; // half-extent of the water surface

class BioBayArchetype implements Archetype {
  readonly id = 'bioBay';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // slot layout: [surface field][swimmer blobs][flash pool]
  private readonly nSurf: number;
  private readonly nSwim: number;
  private readonly nFlash: number;
  private readonly surfXZ: Float64Array; // baked surface scatter (x,z)
  private readonly swimJit: Float64Array; // baked swimmer-blob jitter (x,y,z)
  private readonly flashOff: Float64Array; // baked phase offset per flash slot
  private readonly flashJit: Float64Array; // baked jitter direction (x,z) + magnitude
  private readonly deepPark: Float64Array; // baked deep ambient parking spot (x,y,z)
  private t = 0;
  private swimmers = 2;
  private glow = 1.6;
  private speed = 1;

  constructor(config: ArchetypeConfig) {
    this.particleCount = Math.max(64, config.particleCount);
    const N = this.particleCount;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.nSurf = Math.floor(N * 0.5);
    this.nSwim = Math.floor(N * 0.02);
    this.nFlash = N - this.nSurf - this.nSwim;
    this.surfXZ = new Float64Array(this.nSurf * 2);
    this.swimJit = new Float64Array(this.nSwim * 3);
    this.flashOff = new Float64Array(this.nFlash);
    this.flashJit = new Float64Array(this.nFlash * 3);
    this.deepPark = new Float64Array(this.nFlash * 3);

    const rng = mulberry32((config.seed ^ 0x1f83d9ab) >>> 0);
    const col = this.colors;
    let o = 0;
    for (let i = 0; i < this.nSurf; i++, o++) {
      // the dark bay surface: a near-invisible speckle that gives the water a presence
      this.surfXZ[i * 2] = (rng() * 2 - 1) * BAY;
      this.surfXZ[i * 2 + 1] = (rng() * 2 - 1) * BAY;
      const v = 0.02 + 0.05 * rng();
      col[o * 3] = v * 0.5; col[o * 3 + 1] = v * 0.9; col[o * 3 + 2] = v * 1.3;
    }
    for (let i = 0; i < this.nSwim; i++, o++) {
      // the swimmers themselves glow faintly — they're coated in flashing plankton
      const a = rng() * TAU;
      const r = Math.sqrt(rng()) * 0.06;
      this.swimJit[i * 3] = Math.cos(a) * r;
      this.swimJit[i * 3 + 1] = -0.02 - rng() * 0.05;
      this.swimJit[i * 3 + 2] = Math.sin(a) * r;
      const v = 0.35 + 0.3 * rng();
      col[o * 3] = v * 0.45; col[o * 3 + 1] = v * 1.0; col[o * 3 + 2] = v * 0.95;
    }
    for (let i = 0; i < this.nFlash; i++, o++) {
      // the flash pool: hot cyan-blue (mild HDR overdrive — bloom finishes the job)
      this.flashOff[i] = rng() * CYCLE;
      const a = rng() * TAU;
      this.flashJit[i * 3] = Math.cos(a);
      this.flashJit[i * 3 + 1] = Math.sin(a);
      this.flashJit[i * 3 + 2] = 0.4 + rng() * 0.6; // per-slot jitter magnitude scale
      this.deepPark[i * 3] = (rng() * 2 - 1) * BAY;
      this.deepPark[i * 3 + 1] = -0.6 - rng() * 0.9; // scattered well below the surface → recedes to faint ambient
      this.deepPark[i * 3 + 2] = (rng() * 2 - 1) * BAY;
      const v = 0.75 + 0.45 * rng();
      col[o * 3] = v * 0.4; col[o * 3 + 1] = v * 1.05; col[o * 3 + 2] = v * 1.0;
    }
    this.readParams(config.params);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.swimmers = Math.max(1, Math.min(3, Math.round(p.swimmers ?? 2)));
    this.glow = p.glow ?? 1.6;
    this.speed = p.stir ?? 1;
  }

  // swimmer s position at time tt: a bounded organic roam (two-tone Lissajous, per-swimmer phase)
  private swimPos(s: number, tt: number): [number, number] {
    const ph = s * 2.61;
    const x = Math.sin(tt * 0.31 + ph) * 0.85 + Math.sin(tt * 0.173 + ph * 1.7 + 1.3) * 0.45;
    const z = Math.sin(tt * 0.227 + ph + 0.7) * 0.85 + Math.sin(tt * 0.409 + ph * 0.6) * 0.45;
    return [x * BAY * 0.72, z * BAY * 0.72];
  }

  private surfaceY(x: number, z: number, t: number): number {
    return 0.015 * (Math.sin(3.1 * x + 0.8 * t) + Math.sin(4.3 * z + 0.6 * t + 1.1)); // gentle swell
  }

  private syncPositions(): void {
    const pos = this.positions;
    const t = this.t;
    let o = 0;
    for (let i = 0; i < this.nSurf; i++, o++) {
      const x = this.surfXZ[i * 2];
      const z = this.surfXZ[i * 2 + 1];
      pos[o * 3] = x;
      pos[o * 3 + 1] = this.surfaceY(x, z, t);
      pos[o * 3 + 2] = z;
    }
    for (let i = 0; i < this.nSwim; i++, o++) {
      const s = i % this.swimmers;
      const [sx, sz] = this.swimPos(s, t * this.speed);
      pos[o * 3] = sx + this.swimJit[i * 3];
      pos[o * 3 + 1] = this.surfaceY(sx, sz, t) + this.swimJit[i * 3 + 1];
      pos[o * 3 + 2] = sz + this.swimJit[i * 3 + 2];
    }
    const glow = Math.min(CYCLE * 0.92, Math.max(0.2, this.glow)); // must fit inside the recycle window
    for (let i = 0; i < this.nFlash; i++, o++) {
      const phase = (t + this.flashOff[i]) % CYCLE;
      if (phase < glow) {
        // lit: hold the spot where the swimmer passed (t − phase is constant while this slot burns),
        // rising with the flash then sinking as the glow diffuses outward
        const s = i % this.swimmers;
        const [wx, wz] = this.swimPos(s, (t - phase) * this.speed);
        const u = phase / glow; // 0 → 1 across the glow
        const spread = (0.015 + 0.11 * u * u) * this.flashJit[i * 3 + 2];
        const x = wx + this.flashJit[i * 3] * spread;
        const z = wz + this.flashJit[i * 3 + 1] * spread;
        pos[o * 3] = x;
        pos[o * 3 + 1] = this.surfaceY(x, z, t) + 0.045 * Math.sin(Math.PI * Math.min(1, u * 1.6)) - 0.06 * u * u;
        pos[o * 3 + 2] = z;
      } else {
        // spent: park deep and scattered — collective faint under-glow, the bay's ambient sea-sparkle
        pos[o * 3] = this.deepPark[i * 3];
        pos[o * 3 + 1] = this.deepPark[i * 3 + 1];
        pos[o * 3 + 2] = this.deepPark[i * 3 + 2];
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
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
    return [{ id: 'root', parentId: null, label: 'Bioluminescent bay (dinoflagellates)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.008 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const bioBayFactory: ArchetypeFactory = {
  id: 'bioBay',
  label: 'Bioluminescent Bay',
  category: 'Life',
  kind: 'flow',
  params: [
    { key: 'swimmers', label: 'swimmers', min: 1, max: 3, step: 1, default: 2 }, // stirring bodies
    { key: 'glow', label: 'glow time', min: 0.4, max: 2.2, step: 0.1, default: 1.6 }, // flash duration (wake length)
    { key: 'stir', label: 'stir speed', min: 0.2, max: 3, step: 0.05, default: 1 }, // how fast the swimmers roam
  ],
  defaultParticleCount: 80_000,
  particleCountOptions: [40_000, 80_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the glowing wake IS the visual
  bloom: 0.5, // cyan flashes on black water — let them bloom
  create: (config) => new BioBayArchetype(config),
};

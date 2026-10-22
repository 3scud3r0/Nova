import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Aurora from Orbit. The same auroral curtain as seen from the ground, but now from the ISS —
// looking down and outward along the curve of the planet. From here the aurora is a luminous ribbon
// following the auroral oval around the pole, its field-aligned rays reaching UP through the orbit
// toward you (Chris Hadfield described flying right through the upper tendrils). Below is the dark,
// cloud-mottled night side; along the horizon, a razor-thin band of red-orange AIRGLOW (the OH layer
// at ~90 km, always there, aurora or not); above, the black of space and a scatter of stars. The
// colours are the same atomic spectra — emerald oxygen through the body, the slow red 630 nm crown,
// a violet nitrogen base — baked once; the ribbon's undulation and the rays' precipitation live in
// positions. Bounded.
const TAU = Math.PI * 2;
const RP = 7.0; // planet radius (curves the horizon)
const CY = -RP; // planet centre below the origin, so the surface sits near y = 0

class AuroraOrbitArchetype implements Archetype {
  readonly id = 'auroraOrbit';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // role: 0 ray, 1 surface, 2 airglow limb, 3 star
  private readonly role: Uint8Array;
  private readonly u: Float64Array; // along-oval parameter (rays) / generic
  private readonly h: Float64Array; // altitude fraction (rays) / radius (surface)
  private readonly ph: Float64Array; // precipitation / misc phase
  private activity = 1;
  private folds = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(2048, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.role = new Uint8Array(N);
    this.u = new Float64Array(N);
    this.h = new Float64Array(N);
    this.ph = new Float64Array(N);
    const rng = mulberry32((config.seed ^ 0xc2b2ae35) >>> 0);
    for (let i = 0; i < N; i++) {
      const r = rng();
      const o = i * 3;
      if (r < 0.72) {
        // auroral ray
        this.role[i] = 0;
        this.u[i] = rng();
        const hgt = Math.pow(rng(), 1.12);
        this.h[i] = hgt;
        this.ph[i] = rng();
        // altitude spectrum: violet base → emerald body → red crown
        let cr: number, cg: number, cb: number;
        if (hgt < 0.12) { const f = hgt / 0.12; cr = 0.6 + (0.12 - 0.6) * f; cg = 0.28 + (1 - 0.28) * f; cb = 1 + (0.45 - 1) * f; }
        else if (hgt < 0.62) { cr = 0.12; cg = 1.0; cb = 0.45; }
        else { const f = (hgt - 0.62) / 0.38; cr = 0.12 + (0.95 - 0.12) * f; cg = 1 + (0.2 - 1) * f; cb = 0.45 + (0.32 - 0.45) * f; }
        const glow = (3.2 * Math.exp(-1.7 * hgt) + 0.3) * (0.85 + 0.3 * rng());
        this.colors[o] = cr * glow; this.colors[o + 1] = cg * glow; this.colors[o + 2] = cb * glow;
      } else if (r < 0.93) {
        // night-side surface (dim, cloud-mottled)
        this.role[i] = 1;
        const rad = Math.sqrt(rng()) * 5.0;
        this.u[i] = rng() * TAU;
        this.h[i] = rad;
        this.ph[i] = rng();
        const cloud = 0.5 + 0.5 * Math.sin(rad * 3.1 + this.u[i] * 2.0) * Math.sin(this.u[i] * 3.0);
        const b = (0.03 + 0.06 * cloud) * (0.7 + 0.6 * rng());
        this.colors[o] = b * 0.7; this.colors[o + 1] = b * 0.85; this.colors[o + 2] = b * 1.0; // moonlit blue
      } else if (r < 0.975) {
        // airglow limb band
        this.role[i] = 2;
        this.u[i] = rng();
        this.h[i] = rng();
        const b = 1.1 + 0.6 * rng();
        this.colors[o] = 1.0 * b; this.colors[o + 1] = 0.3 * b; this.colors[o + 2] = 0.12 * b; // red-orange OH airglow
      } else {
        // star
        this.role[i] = 3;
        this.u[i] = rng();
        this.h[i] = rng();
        this.ph[i] = rng();
        const b = 0.5 + 0.7 * rng() * rng();
        this.colors[o] = b; this.colors[o + 1] = b; this.colors[o + 2] = b * (0.9 + 0.15 * rng());
      }
    }
    this.readParams(config.params);
    this.t = 6;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.activity = p.activity ?? 1;
    this.folds = p.folds ?? 1;
  }

  // the oval base curve on the planet surface, parameterised by w ∈ [0,1]
  private oval(w: number, t: number): [number, number, number, number, number, number] {
    const x = (w - 0.5) * 7.0; // sweeps across the near limb
    // sinuous drape of the oval, drifting
    const z = -1.1 + this.folds * (0.5 * Math.sin(w * 7.0 + t * 0.25 * this.activity) + 0.22 * Math.sin(w * 3.0 - t * 0.16 * this.activity));
    const rr = x * x + z * z;
    const under = RP * RP - rr;
    const sy = under > 0 ? Math.sqrt(under) : 0; // height of the sphere cap
    const y = CY + sy;
    // outward normal = (P − C)/RP
    const nx = x / RP, ny = (y - CY) / RP, nz = z / RP;
    return [x, y, z, nx, ny, nz];
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    const t = this.t;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const role = this.role[i];
      if (role === 0) {
        const w = this.u[i];
        const [bx, by, bz, nx, ny, nz] = this.oval(w, t);
        // precipitation: rays stream down their field line (outward normal is "up")
        const cyc = (this.ph[i] + t * 0.14 * this.activity) % 1;
        const hh = Math.max(0.01, this.h[i] * 1.7 - 0.2 * cyc);
        // small tangential wobble so rays read as a curtain, not a comb
        const wob = 0.05 * Math.sin(t * 0.5 * this.activity + this.ph[i] * TAU);
        pos[o] = bx + nx * hh + wob;
        pos[o + 1] = by + ny * hh;
        pos[o + 2] = bz + nz * hh;
      } else if (role === 1) {
        const rad = this.h[i], ang = this.u[i];
        const x = rad * Math.cos(ang), z = rad * Math.sin(ang) - 0.5;
        const under = RP * RP - x * x - z * z;
        pos[o] = x;
        pos[o + 1] = CY + (under > 0 ? Math.sqrt(under) : 0);
        pos[o + 2] = z;
      } else if (role === 2) {
        // airglow: a thin arc riding the visible limb (front hemisphere, low on the sphere)
        const a = (this.u[i] - 0.5) * 2.4; // angle across the limb
        const lr = 5.7 + 0.12 * this.h[i]; // just inside the limb radius
        const x = lr * Math.sin(a), z = lr * Math.cos(a) * 0.5 - 0.5;
        const under = RP * RP - x * x - z * z;
        pos[o] = x;
        pos[o + 1] = CY + (under > 0 ? Math.sqrt(under) : 0) + 0.02;
        pos[o + 2] = z;
      } else {
        // stars: fixed on a far shell in the upper background
        const a = this.u[i] * TAU, e = 0.15 + 0.75 * this.h[i];
        pos[o] = 9 * Math.cos(a) * Math.cos(e) * 0.6;
        pos[o + 1] = 1.5 + 7 * Math.sin(e);
        pos[o + 2] = -6 - 3 * this.ph[i];
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
    return [{ id: 'root', parentId: null, label: 'auroral oval from orbit', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.009 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const auroraOrbitFactory: ArchetypeFactory = {
  id: 'auroraOrbit',
  label: 'Aurora from Orbit',
  category: 'Atmosphere',
  kind: 'flow',
  params: [
    { key: 'activity', label: 'activity', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'folds', label: 'oval folds', min: 0, max: 1.6, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new AuroraOrbitArchetype(config),
};

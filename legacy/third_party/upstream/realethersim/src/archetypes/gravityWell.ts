import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Gravity Well — the rubber sheet, done as honestly as a rubber sheet can be done. This is the most
// famous image in physics outreach: the Sun's mass dents a membrane, and the planets circle the
// slope. It is an ANALOGY with well-known limits (it pictures gravity using gravity, and real orbits
// owe more to curved TIME than curved space) — the Learn panel says so plainly — but what it gets
// right, we do right: the sheet's depth is the actual Newtonian potential Φ = −Σ GM/r (softened), so
// the Sun digs the deep funnel and EVERY PLANET carries its own little moving dimple (watch the moon
// ride its planet's dimple around the Sun's well); and the planets obey Kepler honestly — angular
// speed ω ∝ a^{-3/2}, so the inner worlds visibly lap the outer ones, exactly as in the sky.
// Colours bake once (lavender grid, gold Sun, per-planet palettes); the membrane re-evaluates its
// closed-form height under the moving bodies each frame. Bounded (fixed sheet, circular orbits).
const HALF = 1.7; // membrane half-extent
const TAU = Math.PI * 2;
// per-planet look: orbital radius, body size, mass (dimple), colour
const PLANET_DEFS: { a: number; size: number; m: number; col: [number, number, number] }[] = [
  { a: 0.5, size: 0.028, m: 0.018, col: [0.75, 0.7, 0.66] }, // mercury-grey
  { a: 0.72, size: 0.038, m: 0.03, col: [1.0, 0.85, 0.55] }, // venus-cream
  { a: 0.98, size: 0.04, m: 0.035, col: [0.4, 0.65, 1.0] }, // earth-blue
  { a: 1.24, size: 0.033, m: 0.024, col: [1.0, 0.5, 0.32] }, // mars-red
  { a: 1.5, size: 0.055, m: 0.06, col: [0.95, 0.78, 0.58] }, // jupiter-tan
];

class GravityWellArchetype implements Archetype {
  readonly id = 'gravityWell';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private nGrid = 0;
  private nSun = 0;
  private nPlanet = 0; // per planet
  private nMoon = 0;
  private planetCount = 5;
  private gridXZ: Float64Array = new Float64Array(0);
  private sunL: Float64Array = new Float64Array(0);
  private bodyL: Float64Array = new Float64Array(0); // local ball offsets, shared per planet slot
  private moonL: Float64Array = new Float64Array(0);
  private phase0: Float64Array = new Float64Array(0); // per-planet starting angle
  private depth = 0.55;
  private speed = 1;
  private t = 0;
  private buildKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(256, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.seed = config.seed;
    this.rebuild(config.params);
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round(p.planets ?? 5)}`;
  }

  private rebuild(p: ResolvedParams): void {
    this.planetCount = Math.max(2, Math.min(PLANET_DEFS.length, Math.round(p.planets ?? 5)));
    this.depth = p.depth ?? 0.55;
    this.speed = p.speed ?? 1;
    this.buildKey = this.keyOf(p);
    const rng = mulberry32((this.seed ^ 0x6a09e667) >>> 0);
    const N = this.particleCount;
    this.nSun = Math.floor(N * 0.05);
    this.nMoon = Math.floor(N * 0.012);
    this.nPlanet = Math.floor((N * 0.115) / this.planetCount);
    this.nGrid = N - this.nSun - this.nMoon - this.nPlanet * this.planetCount;
    this.gridXZ = new Float64Array(this.nGrid * 2);
    this.sunL = new Float64Array(this.nSun * 3);
    this.bodyL = new Float64Array(this.nPlanet * 3);
    this.moonL = new Float64Array(this.nMoon * 3);
    this.phase0 = new Float64Array(this.planetCount);
    for (let k = 0; k < this.planetCount; k++) this.phase0[k] = rng() * TAU;
    const col = this.colors;
    let o = 0;
    // ── the membrane: jittered grid with a woven grid-line brightness pattern (the lattice look) ──
    for (let i = 0; i < this.nGrid; i++) {
      const x = (rng() * 2 - 1) * HALF;
      const z = (rng() * 2 - 1) * HALF;
      this.gridXZ[i * 2] = x;
      this.gridXZ[i * 2 + 1] = z;
      const lines =
        Math.pow(Math.abs(Math.sin(x * 18.5)), 8) + Math.pow(Math.abs(Math.sin(z * 18.5)), 8);
      const v = 0.07 + 0.38 * Math.min(1, lines) + 0.04 * rng();
      col[o * 3] = v * 0.78; col[o * 3 + 1] = v * 0.6; col[o * 3 + 2] = v * 1.0; // lavender weave
      o++;
    }
    // ── the Sun: a hot gold ball resting at the bottom of its own funnel ──
    for (let i = 0; i < this.nSun; i++) {
      const u = rng() * 2 - 1, az = rng() * TAU;
      const sr = Math.sqrt(Math.max(0, 1 - u * u));
      const r = 0.09 * Math.cbrt(rng());
      this.sunL[i * 3] = r * sr * Math.cos(az);
      this.sunL[i * 3 + 1] = r * u;
      this.sunL[i * 3 + 2] = r * sr * Math.sin(az);
      const v = 1.15 + 0.5 * rng();
      col[o * 3] = v * 1.05; col[o * 3 + 1] = v * 0.8; col[o * 3 + 2] = v * 0.42;
      o++;
    }
    // ── planets: one shared unit-ball sampling, scaled per planet at draw; colours per planet ──
    for (let i = 0; i < this.nPlanet; i++) {
      const u = rng() * 2 - 1, az = rng() * TAU;
      const sr = Math.sqrt(Math.max(0, 1 - u * u));
      const r = Math.cbrt(rng());
      this.bodyL[i * 3] = r * sr * Math.cos(az);
      this.bodyL[i * 3 + 1] = r * u;
      this.bodyL[i * 3 + 2] = r * sr * Math.sin(az);
    }
    for (let k = 0; k < this.planetCount; k++) {
      const def = PLANET_DEFS[k];
      for (let i = 0; i < this.nPlanet; i++) {
        const shade = 0.75 + 0.45 * rng();
        col[o * 3] = def.col[0] * shade;
        col[o * 3 + 1] = def.col[1] * shade;
        col[o * 3 + 2] = def.col[2] * shade;
        o++;
      }
    }
    // ── the moon (rides planet 3's dimple) ──
    for (let i = 0; i < this.nMoon; i++) {
      const u = rng() * 2 - 1, az = rng() * TAU;
      const sr = Math.sqrt(Math.max(0, 1 - u * u));
      const r = 0.014 * Math.cbrt(rng());
      this.moonL[i * 3] = r * sr * Math.cos(az);
      this.moonL[i * 3 + 1] = r * u;
      this.moonL[i * 3 + 2] = r * sr * Math.sin(az);
      const v = 0.55 + 0.3 * rng();
      col[o * 3] = v; col[o * 3 + 1] = v; col[o * 3 + 2] = v * 1.05;
      o++;
    }
    this.syncPositions();
  }

  // membrane height: the (softened) Newtonian potential of Sun + planets — honest well depths
  private sheet(x: number, z: number, px: Float64Array, pz: Float64Array): number {
    let y = -1.0 / Math.sqrt(x * x + z * z + 0.028); // the Sun (M = 1) — tight softening → a deep, dramatic funnel
    for (let k = 0; k < this.planetCount; k++) {
      const dx = x - px[k], dz = z - pz[k];
      // planet dimples: amplified so the analogy reads (true scale would be invisible)
      y -= (PLANET_DEFS[k].m * 4.5) / Math.sqrt(dx * dx + dz * dz + 0.003);
    }
    return y * this.depth * 0.28;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const t = this.t;
    const n = this.planetCount;
    // Kepler: ω ∝ a^{-3/2} — the inner worlds lap the outer ones
    const px = new Float64Array(n), pz = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const a = PLANET_DEFS[k].a;
      const ang = this.phase0[k] + (this.speed * 0.55 * t) / Math.pow(a, 1.5);
      px[k] = a * Math.cos(ang);
      pz[k] = a * Math.sin(ang);
    }
    let o = 0;
    for (let i = 0; i < this.nGrid; i++, o++) {
      const x = this.gridXZ[i * 2];
      const z = this.gridXZ[i * 2 + 1];
      pos[o * 3] = x;
      pos[o * 3 + 1] = this.sheet(x, z, px, pz);
      pos[o * 3 + 2] = z;
    }
    const ySun = this.sheet(0.02, 0.02, px, pz) + 0.1;
    for (let i = 0; i < this.nSun; i++, o++) {
      pos[o * 3] = this.sunL[i * 3];
      pos[o * 3 + 1] = ySun + this.sunL[i * 3 + 1];
      pos[o * 3 + 2] = this.sunL[i * 3 + 2];
    }
    for (let k = 0; k < n; k++) {
      const def = PLANET_DEFS[k];
      const yP = this.sheet(px[k] + 0.02, pz[k] + 0.02, px, pz) + def.size * 1.3;
      for (let i = 0; i < this.nPlanet; i++, o++) {
        pos[o * 3] = px[k] + this.bodyL[i * 3] * def.size;
        pos[o * 3 + 1] = yP + this.bodyL[i * 3 + 1] * def.size;
        pos[o * 3 + 2] = pz[k] + this.bodyL[i * 3 + 2] * def.size;
      }
    }
    // the moon: circles planet 3 (earth-blue) fast, riding its dimple around the big well
    const mk = Math.min(2, n - 1);
    const mAng = this.speed * 3.6 * t;
    const mx = px[mk] + 0.085 * Math.cos(mAng);
    const mz = pz[mk] + 0.085 * Math.sin(mAng);
    const yM = this.sheet(mx, mz, px, pz) + 0.03;
    for (let i = 0; i < this.nMoon; i++, o++) {
      pos[o * 3] = mx + this.moonL[i * 3];
      pos[o * 3 + 1] = yM + this.moonL[i * 3 + 1];
      pos[o * 3 + 2] = mz + this.moonL[i * 3 + 2];
    }
  }

  step(dt: number, p: ResolvedParams): void {
    if (this.keyOf(p) !== this.buildKey) { this.rebuild(p); return; }
    this.depth = p.depth ?? 0.55;
    this.speed = p.speed ?? 1;
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Gravity well (the rubber sheet, honestly)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.0085 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const gravityWellFactory: ArchetypeFactory = {
  id: 'gravityWell',
  label: 'Gravity Well',
  category: 'Orbital',
  kind: 'flow',
  params: [
    { key: 'depth', label: 'well depth', min: 0.2, max: 1.2, step: 0.02, default: 0.55 }, // potential scale
    { key: 'speed', label: 'orbit speed', min: 0.1, max: 3, step: 0.05, default: 1 },
    { key: 'planets', label: 'planets', min: 2, max: 5, step: 1, default: 5, rebuild: true },
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the dented membrane IS the visual
  create: (config) => new GravityWellArchetype(config),
};

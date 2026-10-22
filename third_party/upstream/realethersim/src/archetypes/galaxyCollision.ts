import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Galaxy Collision (Andromeda–Milky Way). Our galaxy and Andromeda (M31) are falling toward each
// other and will merge in a few billion years into a single elliptical — "Milkomeda." This is the
// classic way to simulate that (Toomre & Toomre, 1972): a RESTRICTED N-body model. Two massive cores
// carry the galaxies' mass and orbit each other; each is surrounded by a disk of near-massless stars
// on circular orbits. The stars feel the gravity of BOTH cores but not each other, so a light per-star
// integration reproduces the real spectacle — tidal tails flung out by the encounter, bridges of
// stars pulled between the two, and the final coalescence. A touch of dynamical friction drains the
// orbit so the cores spiral in and merge; the whole encounter then replays. Bounded (softened gravity).
const G = 1;
const SOFT2 = 0.12 * 0.12; // gravitational softening² (no singular kicks)
const D0 = 2.6; // initial core separation
// One encounter runs 24 model units before replaying — through first passage, the merger, and a long
// stretch of post-merger relaxation (shells + phase-mixing), so the story completes before it loops.
// TIME CALIBRATION: the default orbit reaches first pericenter at t = π·√(a³/GM) ≈ 4.8 model units;
// anchoring that to the published ≈4.3 Gyr for the real first Milky Way–Andromeda passage gives
// 0.895 Gyr per model unit (the factory `clock` below) — so the UI can show honest billions of years.
const CYCLE = 24;
const GYR_PER_UNIT = 0.895;
const TAU = Math.PI * 2;

class GalaxyCollisionArchetype implements Archetype {
  readonly id = 'galaxyCollision';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  // star state (absolute coords) + its initial copy for the replay
  private readonly px: Float64Array; private readonly py: Float64Array; private readonly pz: Float64Array;
  private readonly vx: Float64Array; private readonly vy: Float64Array; private readonly vz: Float64Array;
  private readonly px0: Float64Array; private readonly py0: Float64Array; private readonly pz0: Float64Array;
  private readonly vx0: Float64Array; private readonly vy0: Float64Array; private readonly vz0: Float64Array;
  private readonly positions: Float32Array; // render buffer (recentred on the core barycentre)
  private readonly colors: Float32Array;
  // two cores: [0] = Milky Way, [1] = Andromeda
  private readonly cX = new Float64Array(2); private readonly cY = new Float64Array(2); private readonly cZ = new Float64Array(2);
  private readonly cVX = new Float64Array(2); private readonly cVY = new Float64Array(2); private readonly cVZ = new Float64Array(2);
  private readonly cM = new Float64Array(2);
  private readonly c0 = new Float64Array(2 * 6); // initial core state for replay
  private friction = 0.6;
  private speed = 1;
  private t = 0;
  private buildKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(1, config.particleCount);
    this.particleCount = N;
    this.px = new Float64Array(N); this.py = new Float64Array(N); this.pz = new Float64Array(N);
    this.vx = new Float64Array(N); this.vy = new Float64Array(N); this.vz = new Float64Array(N);
    this.px0 = new Float64Array(N); this.py0 = new Float64Array(N); this.pz0 = new Float64Array(N);
    this.vx0 = new Float64Array(N); this.vy0 = new Float64Array(N); this.vz0 = new Float64Array(N);
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.seed = config.seed;
    this.rebuild(config.params);
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round((p.massRatio ?? 1.1) * 50)},${Math.round((p.pericenter ?? 0.8) * 50)},${Math.round((p.inclination ?? 0.9) * 50)}`;
  }

  // Set up the two galaxies + their encounter orbit, then bake the initial state for replay.
  private rebuild(p: ResolvedParams): void {
    this.friction = p.friction ?? 0.6;
    this.speed = p.speed ?? 0.6;
    this.buildKey = this.keyOf(p);
    const rng = mulberry32((this.seed ^ 0x2545f491) >>> 0);
    const N = this.particleCount;
    const mRatio = p.massRatio ?? 1.1;
    const peri = p.pericenter ?? 0.8;
    const incl = p.inclination ?? 0.9;
    const mA = 1, mB = mRatio, Mtot = mA + mB;
    const fA = mA / Mtot, fB = mB / Mtot;
    this.cM[0] = mA; this.cM[1] = mB;
    // elliptical encounter: start at apocenter D0, tangential relative velocity → pericenter `peri`
    const aOrb = (D0 + peri) / 2;
    const vrel = Math.sqrt(G * Mtot * (2 / D0 - 1 / aOrb));
    this.cX[0] = -fB * D0; this.cY[0] = 0; this.cZ[0] = 0; this.cVX[0] = 0; this.cVY[0] = -fB * vrel; this.cVZ[0] = 0;
    this.cX[1] = fA * D0; this.cY[1] = 0; this.cZ[1] = 0; this.cVX[1] = 0; this.cVY[1] = fA * vrel; this.cVZ[1] = 0;
    for (let g = 0; g < 2; g++) {
      this.c0[g * 6] = this.cX[g]; this.c0[g * 6 + 1] = this.cY[g]; this.c0[g * 6 + 2] = this.cZ[g];
      this.c0[g * 6 + 3] = this.cVX[g]; this.c0[g * 6 + 4] = this.cVY[g]; this.c0[g * 6 + 5] = this.cVZ[g];
    }
    // disk orientations (Euler tilt about X then Z) — the Milky Way near-prograde, Andromeda inclined
    const orient = [[0.4, 0.3], [incl, 2.1]];
    const col = this.colors;
    const half = Math.floor(N / 2);
    for (let i = 0; i < N; i++) {
      const g = i < half ? 0 : 1; // which galaxy
      const nG = g === 0 ? half : N - half;
      const iG = g === 0 ? i : i - half;
      const Mg = this.cM[g];
      const Rd = 0.7 * Math.cbrt(Mg / mA); // disk radius scales gently with mass
      const bulge = iG < nG * 0.16;
      let r: number, lz: number;
      if (bulge) {
        r = Rd * 0.28 * Math.sqrt(rng());
        lz = (rng() - 0.5) * Rd * 0.4 * Math.sqrt(Math.max(0, 1 - r / (Rd * 0.28))); // 3-D bulge
      } else {
        r = Rd * (0.12 + 0.95 * Math.pow(rng(), 0.7));
        lz = (rng() + rng() + rng() - 1.5) / 1.5 * 0.03; // thin flaring disk
      }
      const ang = rng() * TAU;
      const lx = r * Math.cos(ang), ly = r * Math.sin(ang);
      // circular speed (softened Kepler) + disk spin sense (both prograde w.r.t. their own disk)
      const vc = Math.sqrt((G * Mg) / Math.sqrt(r * r + SOFT2));
      const vlx = -Math.sin(ang) * vc, vly = Math.cos(ang) * vc;
      // rotate disk-local (x,y,z) + velocity into world by the galaxy's orientation
      const [ax, az] = orient[g];
      const rp = rotXZ(lx, ly, lz, ax, az);
      const rv = rotXZ(vlx, vly, 0, ax, az);
      const px = this.cX[g] + rp[0], py = this.cY[g] + rp[1], pz = this.cZ[g] + rp[2];
      const vx = this.cVX[g] + rv[0], vy = this.cVY[g] + rv[1], vz = this.cVZ[g] + rv[2];
      this.px0[i] = px; this.py0[i] = py; this.pz0[i] = pz;
      this.vx0[i] = vx; this.vy0[i] = vy; this.vz0[i] = vz;
      // colour: Milky Way blue-white, Andromeda gold; bright bulges; a few pink star-forming knots
      const f = r / Rd;
      let r0: number, g0: number, b0: number;
      if (bulge) {
        r0 = 1.0; g0 = 0.9; b0 = g === 0 ? 0.82 : 0.6;
      } else if (rng() < 0.03) {
        r0 = 1.0; g0 = 0.4; b0 = 0.55; // HII knot
      } else if (g === 0) {
        r0 = 0.5 + 0.15 * (1 - f); g0 = 0.68; b0 = 1.0; // MW: blue-white
      } else {
        r0 = 1.0; g0 = 0.78 - 0.12 * f; b0 = 0.44 + 0.1 * f; // Andromeda: gold
      }
      const bri = bulge ? 1.5 + 0.6 * rng() : 0.95 + 0.7 * rng();
      col[i * 3] = r0 * bri; col[i * 3 + 1] = g0 * bri; col[i * 3 + 2] = b0 * bri;
    }
    this.reset();
  }

  private reset(): void {
    this.px.set(this.px0); this.py.set(this.py0); this.pz.set(this.pz0);
    this.vx.set(this.vx0); this.vy.set(this.vy0); this.vz.set(this.vz0);
    for (let g = 0; g < 2; g++) {
      this.cX[g] = this.c0[g * 6]; this.cY[g] = this.c0[g * 6 + 1]; this.cZ[g] = this.c0[g * 6 + 2];
      this.cVX[g] = this.c0[g * 6 + 3]; this.cVY[g] = this.c0[g * 6 + 4]; this.cVZ[g] = this.c0[g * 6 + 5];
    }
    this.t = 0;
    this.fillPositions();
  }

  private integrate(sdt: number): void {
    // ── cores: mutual gravity + dynamical friction (drag that grows as they overlap → inspiral) ──
    const dx = this.cX[1] - this.cX[0], dy = this.cY[1] - this.cY[0], dz = this.cZ[1] - this.cZ[0];
    const r2 = dx * dx + dy * dy + dz * dz + SOFT2, r = Math.sqrt(r2), inv3 = 1 / (r2 * r);
    const fx = G * dx * inv3, fy = G * dy * inv3, fz = G * dz * inv3;
    const dfK = this.friction / (r2 + 0.5); // stronger when close
    const aX = [this.cM[1] * fx - dfK * this.cVX[0], -this.cM[0] * fx - dfK * this.cVX[1]];
    const aY = [this.cM[1] * fy - dfK * this.cVY[0], -this.cM[0] * fy - dfK * this.cVY[1]];
    const aZ = [this.cM[1] * fz - dfK * this.cVZ[0], -this.cM[0] * fz - dfK * this.cVZ[1]];
    for (let g = 0; g < 2; g++) {
      this.cVX[g] += aX[g] * sdt; this.cVY[g] += aY[g] * sdt; this.cVZ[g] += aZ[g] * sdt;
      this.cX[g] += this.cVX[g] * sdt; this.cY[g] += this.cVY[g] * sdt; this.cZ[g] += this.cVZ[g] * sdt;
    }
    // ── stars: gravity from both cores (softened), semi-implicit Euler ──
    const cx0 = this.cX[0], cy0 = this.cY[0], cz0 = this.cZ[0], m0 = G * this.cM[0];
    const cx1 = this.cX[1], cy1 = this.cY[1], cz1 = this.cZ[1], m1 = G * this.cM[1];
    const N = this.particleCount;
    for (let i = 0; i < N; i++) {
      const x = this.px[i], y = this.py[i], z = this.pz[i];
      let dx0 = cx0 - x, dy0 = cy0 - y, dz0 = cz0 - z;
      let s0 = dx0 * dx0 + dy0 * dy0 + dz0 * dz0 + SOFT2; s0 = m0 / (s0 * Math.sqrt(s0));
      let dx1 = cx1 - x, dy1 = cy1 - y, dz1 = cz1 - z;
      let s1 = dx1 * dx1 + dy1 * dy1 + dz1 * dz1 + SOFT2; s1 = m1 / (s1 * Math.sqrt(s1));
      let nvx = this.vx[i] + (dx0 * s0 + dx1 * s1) * sdt;
      let nvy = this.vy[i] + (dy0 * s0 + dy1 * s1) * sdt;
      let nvz = this.vz[i] + (dz0 * s0 + dz1 * s1) * sdt;
      const v2 = nvx * nvx + nvy * nvy + nvz * nvz;
      if (v2 > 64) { const k = 8 / Math.sqrt(v2); nvx *= k; nvy *= k; nvz *= k; } // clamp runaway kicks
      this.vx[i] = nvx; this.vy[i] = nvy; this.vz[i] = nvz;
      this.px[i] = x + nvx * sdt; this.py[i] = y + nvy * sdt; this.pz[i] = z + nvz * sdt;
    }
  }

  // fill the render buffer, recentred on the cores' barycentre so the encounter stays framed
  private fillPositions(): void {
    const Mtot = this.cM[0] + this.cM[1];
    const comx = (this.cM[0] * this.cX[0] + this.cM[1] * this.cX[1]) / Mtot;
    const comy = (this.cM[0] * this.cY[0] + this.cM[1] * this.cY[1]) / Mtot;
    const comz = (this.cM[0] * this.cZ[0] + this.cM[1] * this.cZ[1]) / Mtot;
    const pos = this.positions;
    const N = this.particleCount;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      pos[o] = this.px[i] - comx;
      pos[o + 1] = this.py[i] - comy;
      pos[o + 2] = this.pz[i] - comz;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    if (this.keyOf(p) !== this.buildKey) { this.rebuild(p); return; }
    this.friction = p.friction ?? 0.6;
    this.speed = p.speed ?? 0.6;
    const nsub = 3;
    const sdt = (dt * this.speed) / nsub;
    for (let s = 0; s < nsub; s++) this.integrate(sdt);
    this.t += dt * this.speed;
    if (this.t > CYCLE) this.reset();
    else this.fillPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { const tt = s[0] ?? 0; this.reset(); void tt; }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Galaxy collision (Milky Way × Andromeda)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.007 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

// rotate a vector about X by ax, then about Z by az
function rotXZ(x: number, y: number, z: number, ax: number, az: number): [number, number, number] {
  const cy = Math.cos(ax), sy = Math.sin(ax);
  const y1 = y * cy - z * sy, z1 = y * sy + z * cy;
  const cz = Math.cos(az), sz = Math.sin(az);
  return [x * cz - y1 * sz, x * sz + y1 * cz, z1];
}

export const galaxyCollisionFactory: ArchetypeFactory = {
  id: 'galaxyCollision',
  label: 'Galaxy Collision',
  category: 'Cosmology',
  kind: 'flow',
  params: [
    { key: 'massRatio', label: 'mass ratio', min: 0.5, max: 2, step: 0.05, default: 1.1, rebuild: true }, // M_And / M_MW
    { key: 'pericenter', label: 'pericenter', min: 0.4, max: 1.6, step: 0.05, default: 0.8, rebuild: true }, // closest approach
    { key: 'inclination', label: 'inclination', min: 0, max: 1.6, step: 0.05, default: 0.9, rebuild: true }, // Andromeda disk tilt
    { key: 'friction', label: 'friction', min: 0, max: 1.5, step: 0.05, default: 0.6 }, // dynamical friction → merger speed
    { key: 'speed', label: 'speed', min: 0.1, max: 3, step: 0.1, default: 0.6 }, // playback (slow: eons should feel like eons)
  ],
  defaultParticleCount: 80_000,
  particleCountOptions: [40_000, 80_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the star streams (tidal tails) ARE the visual
  clock: { scale: GYR_PER_UNIT, unit: 'Gyr', cycle: CYCLE }, // sim clock: "T + 4.3 Gyr" at first passage
  create: (config) => new GalaxyCollisionArchetype(config),
};

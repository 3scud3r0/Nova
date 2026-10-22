import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Gigantic Jet. The rarest and tallest of the "transient luminous events" — the family of exotic
// discharges (sprites, blue jets, ELVES) that fire UPWARD from thunderstorm tops instead of down to
// the ground. A gigantic jet bridges the whole gap: a blue-white leader punches out of the storm at
// ~20 km and races to the ionosphere near 90 km in a few milliseconds, fanning into red-tinged
// tendrils where it meets the charged upper air. Astronaut Nichole Ayers photographed one from the
// ISS — which is the view here: the curved night limb, city lights and lightning glinting in the
// cloud deck below, stars above, and the jet leaping toward you. Built as an event cycle
// (grow → flash → fade → dark), the way our Lightning is; colours bake once. Bounded.
const TAU = Math.PI * 2;
const RP = 7.0; // planet radius (curves the horizon)
const CY = -RP;
const H = 2.75; // jet height (storm top → ionosphere), render units

class GiganticJetArchetype implements Archetype {
  readonly id = 'giganticJet';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly role: Uint8Array; // 0 jet, 1 surface, 2 city, 3 star, 4 storm, 5 airglow
  private readonly s0: Float64Array; // jet height fraction / generic
  private readonly a0: Float64Array; // lateral phase / generic
  private readonly b0: Float64Array; // tendril spread / generic
  // storm base + local frame (fixed)
  private Bx = 0; private By = 0; private Bz = 0;
  private nx = 0; private ny = 1; private nz = 0;
  private t1x = 1; private t1y = 0; private t1z = 0;
  private t2x = 0; private t2y = 0; private t2z = 1;
  private rate = 1;
  private branch = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(2048, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.role = new Uint8Array(N);
    this.s0 = new Float64Array(N);
    this.a0 = new Float64Array(N);
    this.b0 = new Float64Array(N);
    const rng = mulberry32((config.seed ^ 0x2c1b3c6d) >>> 0);
    this.readParams(config.params);
    // storm site on the near surface, and its outward-normal frame
    const sx = 0, sz = -0.6;
    const sy = CY + Math.sqrt(RP * RP - sx * sx - sz * sz);
    this.Bx = sx; this.By = sy; this.Bz = sz;
    this.nx = sx / RP; this.ny = (sy - CY) / RP; this.nz = sz / RP;
    // tangent basis
    let ax = 1, ay = 0, az = 0;
    const d = ax * this.nx + ay * this.ny + az * this.nz;
    let ux = ax - d * this.nx, uy = ay - d * this.ny, uz = az - d * this.nz;
    const ul = Math.hypot(ux, uy, uz) || 1; this.t1x = ux / ul; this.t1y = uy / ul; this.t1z = uz / ul;
    this.t2x = this.ny * this.t1z - this.nz * this.t1y;
    this.t2y = this.nz * this.t1x - this.nx * this.t1z;
    this.t2z = this.nx * this.t1y - this.ny * this.t1x;
    const NBRANCH = 6;
    for (let i = 0; i < N; i++) {
      const u = rng();
      const o = i * 3;
      if (u < 0.5) {
        // jet channel + crown tendrils
        this.role[i] = 0;
        const s = Math.pow(rng(), 0.85);
        this.s0[i] = s;
        this.a0[i] = rng() * TAU; // lateral wander phase / tendril angle
        this.b0[i] = Math.floor(rng() * NBRANCH) + rng() * 0.4; // tendril id
        // colour by altitude: blue-white leader → blue column → violet/red ionospheric crown
        let cr: number, cg: number, cb: number;
        if (s < 0.12) { cr = 0.72; cg = 0.86; cb = 1.0; }
        else if (s < 0.62) { const f = (s - 0.12) / 0.5; cr = 0.72 + (0.4 - 0.72) * f; cg = 0.86 + (0.55 - 0.86) * f; cb = 1.0; }
        else { const f = (s - 0.62) / 0.38; cr = 0.4 + (1.0 - 0.4) * f; cg = 0.55 + (0.34 - 0.55) * f; cb = 1.0 + (0.5 - 1.0) * f; }
        const g = 0.9 + 0.4 * rng();
        this.colors[o] = cr * g; this.colors[o + 1] = cg * g; this.colors[o + 2] = cb * g;
      } else if (u < 0.72) {
        // night-side surface (dim, cloud-mottled)
        this.role[i] = 1;
        const rad = Math.sqrt(rng()) * 5.2, ang = rng() * TAU;
        this.s0[i] = rad; this.a0[i] = ang;
        const cloud = 0.5 + 0.5 * Math.sin(rad * 3.3 + ang * 2.0) * Math.sin(ang * 3.0);
        const bb = (0.03 + 0.06 * cloud) * (0.7 + 0.6 * rng());
        this.colors[o] = bb * 0.65; this.colors[o + 1] = bb * 0.8; this.colors[o + 2] = bb * 1.0;
      } else if (u < 0.82) {
        // city lights: warm clusters on the surface
        this.role[i] = 2;
        const cluster = Math.floor(rng() * 40);
        const crng = mulberry32((0x9e3779b9 ^ cluster) >>> 0);
        const crad = Math.sqrt(crng()) * 4.8, cang = crng() * TAU;
        const rad = crad + (rng() - 0.5) * 0.5, ang = cang + (rng() - 0.5) * 0.12;
        this.s0[i] = rad; this.a0[i] = ang;
        const b = (0.5 + 0.6 * rng() * rng());
        this.colors[o] = b * 1.0; this.colors[o + 1] = b * 0.82; this.colors[o + 2] = b * 0.5; // sodium-orange
      } else if (u < 0.9) {
        // storm glow: the lightning-lit thundercloud at the jet base
        this.role[i] = 4;
        const rr = 0.18 * Math.sqrt(rng()), aa = rng() * TAU;
        this.s0[i] = rr; this.a0[i] = aa; this.b0[i] = rng();
        const b = 0.8 + 0.7 * rng();
        this.colors[o] = 0.6 * b; this.colors[o + 1] = 0.75 * b; this.colors[o + 2] = 1.0 * b;
      } else if (u < 0.955) {
        // airglow limb band
        this.role[i] = 5;
        this.s0[i] = rng(); this.a0[i] = rng();
        const b = 1.0 + 0.6 * rng();
        this.colors[o] = 1.0 * b; this.colors[o + 1] = 0.3 * b; this.colors[o + 2] = 0.12 * b;
      } else {
        // stars
        this.role[i] = 3;
        this.s0[i] = rng(); this.a0[i] = rng(); this.b0[i] = rng();
        const b = 0.5 + 0.7 * rng() * rng();
        this.colors[o] = b; this.colors[o + 1] = b; this.colors[o + 2] = b * (0.9 + 0.15 * rng());
      }
    }
    // start so the ~3.2 s thumbnail capture lands on the flash (full jet lit)
    this.t = 0.9;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.rate = p.rate ?? 1;
    this.branch = p.branch ?? 1;
  }

  private surfaceY(x: number, z: number): number {
    const under = RP * RP - x * x - z * z;
    return CY + (under > 0 ? Math.sqrt(under) : 0);
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    const t = this.t;
    // event cycle: grow → flash → fade → dark
    const cyc = (t * this.rate * 0.5) % 1;
    let growFront = 0; // channel is lit up to this height fraction
    if (cyc < 0.3) growFront = cyc / 0.3; // leader climbs
    else if (cyc < 0.55) growFront = 1; // flash / hold
    else if (cyc < 0.8) growFront = (0.8 - cyc) / 0.25; // retract from the top
    else growFront = 0; // dark
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const role = this.role[i];
      if (role === 0) {
        const s = this.s0[i];
        if (s > growFront + 0.001) { pos[o] = 0; pos[o + 1] = -45; pos[o + 2] = 0; continue; }
        // climb along the outward normal, with a little wander and a fanned ionospheric crown
        const wob = 0.05 * Math.sin(s * 9 + this.a0[i]) + 0.02 * Math.sin(s * 23 + this.a0[i] * 2);
        let lx = wob * Math.cos(this.a0[i]), ly = wob * Math.sin(this.a0[i]);
        if (s > 0.6) {
          const f = (s - 0.6) / 0.4;
          const tAng = (this.b0[i] / 6) * TAU + 0.3 * Math.sin(this.a0[i]);
          const fan = this.branch * 0.55 * f * f;
          lx += Math.cos(tAng) * fan; ly += Math.sin(tAng) * fan;
        }
        const climb = s * H;
        pos[o] = this.Bx + this.nx * climb + this.t1x * lx + this.t2x * ly;
        pos[o + 1] = this.By + this.ny * climb + this.t1y * lx + this.t2y * ly;
        pos[o + 2] = this.Bz + this.nz * climb + this.t1z * lx + this.t2z * ly;
      } else if (role === 1) {
        const rad = this.s0[i], ang = this.a0[i];
        const x = rad * Math.cos(ang), z = rad * Math.sin(ang) - 0.4;
        pos[o] = x; pos[o + 1] = this.surfaceY(x, z); pos[o + 2] = z;
      } else if (role === 2) {
        const rad = this.s0[i], ang = this.a0[i];
        const x = rad * Math.cos(ang), z = rad * Math.sin(ang) - 0.4;
        pos[o] = x; pos[o + 1] = this.surfaceY(x, z) + 0.01; pos[o + 2] = z;
      } else if (role === 4) {
        // storm glow disc hugging the surface at the jet base
        const rr = this.s0[i], aa = this.a0[i];
        const lx = rr * Math.cos(aa), ly = rr * Math.sin(aa);
        const flick = 0.85 + 0.15 * Math.sin(t * 9 + this.b0[i] * TAU);
        pos[o] = (this.Bx + this.t1x * lx + this.t2x * ly) * flick;
        pos[o + 1] = this.By + this.ny * 0.02 + this.t1y * lx + this.t2y * ly;
        pos[o + 2] = this.Bz + this.t1z * lx + this.t2z * ly;
      } else if (role === 5) {
        const a = (this.s0[i] - 0.5) * 2.4;
        const lr = 5.75 + 0.12 * this.a0[i];
        const x = lr * Math.sin(a), z = lr * Math.cos(a) * 0.5 - 0.4;
        pos[o] = x; pos[o + 1] = this.surfaceY(x, z) + 0.02; pos[o + 2] = z;
      } else {
        const a = this.s0[i] * TAU, e = 0.12 + 0.8 * this.a0[i];
        pos[o] = 9 * Math.cos(a) * Math.cos(e) * 0.6;
        pos[o + 1] = 1.6 + 7 * Math.sin(e);
        pos[o + 2] = -6 - 3 * this.b0[i];
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
    return [{ id: 'root', parentId: null, label: 'gigantic jet (storm top → ionosphere)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.011 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const giganticJetFactory: ArchetypeFactory = {
  id: 'giganticJet',
  label: 'Gigantic Jet',
  category: 'Atmosphere',
  kind: 'flow',
  params: [
    { key: 'rate', label: 'strike rate', min: 0.3, max: 2.5, step: 0.05, default: 1 },
    { key: 'branch', label: 'crown spread', min: 0.3, max: 2, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 110_000,
  particleCountOptions: [60_000, 110_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.48, // the leader should bloom against the night
  create: (config) => new GiganticJetArchetype(config),
};

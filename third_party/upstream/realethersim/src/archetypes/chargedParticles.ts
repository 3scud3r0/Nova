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

// Charged Particles in Fields — the Lorentz force F = q(E + v × B), and the four motions every plasma physics
// course starts with. Cyclotron: in a uniform magnetic field a charge circles at the cyclotron frequency qB/m,
// whatever its speed — faster ones just make bigger circles, so every particle of a kind comes back to the
// start together (the principle of the cyclotron and the mass spectrometer); opposite charges circle opposite
// ways. E × B drift: add an electric field across the magnetic one and every particle — positive or negative,
// heavy or light — drifts the same way at the same speed E/B, along looping cycloids. Magnetic mirror: between
// two coils the field is weaker in the middle; a particle spiralling towards a coil is turned back where the
// field is strong enough, unless its path is too close to the field direction — inside the "loss cone" — and
// it escapes. Radiation belt: in the Earth's dipole field particles gyrate, bounce from hemisphere to
// hemisphere, and slowly drift round the planet — positive ions westward, negative charges eastward (the Van
// Allen belts and the ring current). Every path is integrated with the Boris scheme, the standard plasma
// pusher, which keeps a particle's speed exactly constant in a pure magnetic field.

const SCENES = { cyclotron: 0, 'E × B drift': 1, 'magnetic mirror': 2, 'radiation belt': 3 };
const RE = 0.55; // Earth radius (render units) in the radiation-belt scene
const COIL_Y = 1.45, COIL_A = 0.75; // magnetic mirror coils
const ZWRAP = 2.3; // E × B: the drift direction wraps at ±ZWRAP

// complete elliptic integrals K(k), E(k) by the arithmetic–geometric mean
function ellipKE(k2: number): [number, number] {
  let a = 1, b = Math.sqrt(Math.max(1e-300, 1 - k2)), sum = k2 / 2, pow = 0.5;
  for (let i = 0; i < 12; i++) {
    const an = (a + b) / 2, bn = Math.sqrt(a * b), cn = (a - b) / 2;
    pow *= 2; sum += pow * cn * cn;
    a = an; b = bn;
    if (cn < 1e-15) break;
  }
  const K = Math.PI / (2 * a);
  return [K, K * (1 - sum)];
}

/** Field of a circular current loop of radius a in the plane y = y0 (axis y), scaled so the field at its centre is 1
 *  (exact, via complete elliptic integrals). */
function loopField(x: number, y: number, z: number, a: number, y0: number, out: Float64Array): void {
  const rho = Math.hypot(x, z), dz = y - y0;
  const al2 = a * a + rho * rho + dz * dz - 2 * a * rho, be2 = a * a + rho * rho + dz * dz + 2 * a * rho, be = Math.sqrt(be2);
  const k2 = 1 - al2 / be2;
  const [K, E] = ellipKE(k2);
  const C = (2 * a) / Math.PI; // on the axis B = C·π·a² / (2(a² + dz²)^{3/2}), so 1 at the centre
  const bz = (C / (2 * al2 * be)) * ((a * a - rho * rho - dz * dz) * E + al2 * K);
  out[1] += bz;
  if (rho > 1e-9) {
    const br = ((C * dz) / (2 * al2 * be * rho)) * ((a * a + rho * rho + dz * dz) * E - al2 * K);
    out[0] += (br * x) / rho; out[2] += (br * z) / rho;
  }
}

interface Species { q: number; m: number; hue: number }

class ChargedParticlesArchetype implements Archetype {
  readonly id = 'chargedParticles';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly scene: number;
  private readonly rng: () => number;
  private readonly M: number; // particles
  private readonly TL: number; // trail samples per particle
  private readonly x: Float64Array; private readonly v: Float64Array; private readonly sp: Uint8Array; // state
  private readonly trail: Float32Array; private head = 0; // ring buffer [TL][M][3]
  private readonly species: Species[];
  private readonly guide0: number; private readonly guideN: number;
  private B = 1; private E = 0.4; private speed = 1;
  private t = 0; private sampleAcc = 0;
  private escaped = 0;
  private readonly bMid: number = 1; private readonly bMax: number = 1;
  private readonly tmpB = new Float64Array(3);

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    this.rng = mulberry32(config.seed);
    this.scene = Math.round(config.params.scene ?? 0);
    this.readParams(config.params);
    const col = this.colors;
    this.species = this.scene === 0
      ? [{ q: 1, m: 1, hue: 0.07 }, { q: -1, m: 1, hue: 0.52 }, { q: 1, m: 4, hue: 0.85 }]
      : [{ q: 1, m: 1, hue: 0.07 }, { q: -1, m: 1, hue: 0.52 }];
    this.M = this.scene === 0 ? 36 : this.scene === 1 ? 24 : this.scene === 2 ? 18 : 36;
    // guides (field lines, coils, the Earth) take a fixed share; the rest is trails
    this.guideN = Math.floor(P * (this.scene === 3 ? 0.16 : 0.1));
    // trails share what is left — capped per scene, because a compact bottle full of trails glares (unused points stay black)
    const cap = [0.6, 0.75, 0.32, 0.84][this.scene] * P;
    this.TL = Math.max(4, Math.floor(Math.min(P - this.guideN, cap) / this.M));
    this.x = new Float64Array(this.M * 3); this.v = new Float64Array(this.M * 3); this.sp = new Uint8Array(this.M);
    this.trail = new Float32Array(this.TL * this.M * 3);
    if (this.scene === 2) {
      const b = new Float64Array(3);
      this.fieldAt(0, 0, 0, b); this.bMid = b[1];
      b.fill(0); this.fieldAt(0, COIL_Y, 0, b); this.bMax = b[1];
    }
    for (let i = 0; i < this.M; i++) this.spawn(i, true);
    // trail colours: species hue, fading with age (index 0 = newest)
    for (let s = 0; s < this.TL; s++) for (let i = 0; i < this.M; i++) {
      const p = s * this.M + i, fade = 1 - s / this.TL, h = this.species[this.sp[i]].hue;
      hslToRgb(h, 0.85, 0.3 + 0.38 * fade, col, p * 3);
      for (let c = 0; c < 3; c++) col[p * 3 + c] *= 0.25 + 0.95 * fade;
    }
    this.guide0 = this.TL * this.M;
    this.buildGuides();
    // run a while so the paths are drawn when it opens
    // run long enough to fill every trail, so the paths are drawn when it opens
    const userSpeed = this.speed;
    this.speed = 1;
    const warm = Math.ceil((this.TL * this.sampleEvery()) / this.frameTime(0.016)) + 10;
    for (let k = 0; k < warm; k++) this.advance(0.016);
    this.speed = userSpeed;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.B = p.B ?? 1;
    this.E = p.E ?? 0.4;
    this.speed = p.speed ?? 1;
  }

  /** B (and E) at a point; returns E via the caller's knowledge of the scene (only E × B has one). */
  private fieldAt(x: number, y: number, z: number, out: Float64Array): void {
    out[0] = 0; out[1] = 0; out[2] = 0;
    if (this.scene === 0 || this.scene === 1) { out[1] = this.B; return; }
    if (this.scene === 2) {
      loopField(x, y, z, COIL_A, COIL_Y, out); loopField(x, y, z, COIL_A, -COIL_Y, out);
      const s = 22 * this.B; out[0] *= s; out[1] *= s; out[2] *= s;
      return;
    }
    // Earth's dipole with the field pointing north (+y) at the equator: B = B₀R³[3(m·r̂)r̂ − m]/r³, m = −ŷ
    const r2 = x * x + y * y + z * z, r = Math.sqrt(r2), r5 = r2 * r2 * r;
    const b0 = 250 * this.B * RE * RE * RE, my = -1;
    const mr = my * y;
    out[0] = (b0 * 3 * mr * x) / r5; out[1] = (b0 * (3 * mr * y - my * r2)) / r5; out[2] = (b0 * 3 * mr * z) / r5;
  }

  private spawn(i: number, first: boolean): void {
    const rng = this.rng, x = this.x, v = this.v, o = i * 3;
    if (this.scene === 0) {
      const s = i % 3, k = Math.floor(i / 3), n = this.M / 3;
      this.sp[i] = s;
      const a = (k / n) * Math.PI * 2, spd = (s === 2 ? 0.16 : 0.62) * (0.45 + 0.55 * ((k % 4) + 1) / 4);
      x[o] = 0; x[o + 1] = (1 - s) * 0.55; x[o + 2] = 0;
      v[o] = spd * Math.cos(a); v[o + 1] = 0; v[o + 2] = spd * Math.sin(a);
    } else if (this.scene === 1) {
      this.sp[i] = i % 2;
      const k = Math.floor(i / 2), n = this.M / 2;
      x[o] = -1.4 + 2.8 * (k / (n - 1)); x[o + 1] = this.sp[i] === 0 ? 0.35 : -0.35; x[o + 2] = -ZWRAP + 4.6 * rng();
      const u = (k % 3) * 0.25; // some start at rest, some moving
      v[o] = u * (rng() - 0.5); v[o + 1] = 0; v[o + 2] = u * (rng() - 0.5);
    } else if (this.scene === 2) {
      this.sp[i] = i % 2;
      const r = 0.22 * Math.sqrt(rng()), a = rng() * Math.PI * 2;
      x[o] = r * Math.cos(a); x[o + 1] = (rng() - 0.5) * 0.2; x[o + 2] = r * Math.sin(a);
      // speed 1, pitch angle α (to the field) spread evenly over 10°…80° either way along the axis
      const al = ((10 + 70 * rng()) * Math.PI) / 180, c = Math.cos(al) * (rng() < 0.5 ? 1 : -1), ph = rng() * Math.PI * 2, s = Math.sin(al);
      v[o] = s * Math.cos(ph); v[o + 1] = c; v[o + 2] = s * Math.sin(ph);
    } else {
      this.sp[i] = i % 2;
      const L = 2.2 + 1.2 * rng(), a = rng() * Math.PI * 2; // L-shell, in Earth radii
      x[o] = L * RE * Math.cos(a); x[o + 1] = 0; x[o + 2] = L * RE * Math.sin(a);
      const alpha = (35 + 50 * rng()) * Math.PI / 180, spd = 0.85; // equatorial pitch angle
      // velocity: v∥ along B (≈ ±y at the equator), v⊥ in the equatorial plane
      const g = rng() * Math.PI * 2, vp = spd * Math.sin(alpha);
      v[o] = vp * Math.cos(g); v[o + 2] = vp * Math.sin(g); v[o + 1] = spd * Math.cos(alpha) * (rng() < 0.5 ? 1 : -1);
    }
    // (a respawned particle's old trail is left to fade out behind it; the first trail is filled by the warm-up)
    void first;
  }

  /** One Boris step of particle i over h. */
  private push(i: number, h: number): void {
    const o = i * 3, x = this.x, v = this.v, b = this.tmpB, s = this.species[this.sp[i]], qm = s.q / s.m;
    this.fieldAt(x[o], x[o + 1], x[o + 2], b);
    const ex = this.scene === 1 ? this.E : 0;
    // half electric kick
    let vx = v[o] + qm * ex * h / 2, vy = v[o + 1], vz = v[o + 2];
    // magnetic rotation
    const tx = qm * b[0] * h / 2, ty = qm * b[1] * h / 2, tz = qm * b[2] * h / 2;
    const t2 = tx * tx + ty * ty + tz * tz, f = 2 / (1 + t2);
    const px = vx + (vy * tz - vz * ty), py = vy + (vz * tx - vx * tz), pz = vz + (vx * ty - vy * tx);
    vx += (py * tz - pz * ty) * f; vy += (pz * tx - px * tz) * f; vz += (px * ty - py * tx) * f;
    vx += qm * ex * h / 2;
    v[o] = vx; v[o + 1] = vy; v[o + 2] = vz;
    x[o] += vx * h; x[o + 1] += vy * h; x[o + 2] += vz * h;
  }

  private frameTime(dt: number): number { return dt * this.speed * (this.scene === 3 ? 6 : this.scene === 2 ? 2 : 3); }
  private sampleEvery(): number { return this.scene === 3 ? 0.06 : this.scene === 1 ? 0.004 : this.scene === 2 ? 0.02 : 0.012; }

  private advance(dt: number): void {
    const T = this.frameTime(dt); // simulated time this frame
    if (T <= 0) return;
    const sampleEvery = this.sampleEvery();
    const b = this.tmpB;
    for (let i = 0; i < this.M; i++) {
      let left = T;
      while (left > 1e-12) {
        const o = i * 3;
        // step so the gyration is resolved: ωh ≤ 0.2
        this.fieldAt(this.x[o], this.x[o + 1], this.x[o + 2], b);
        const s = this.species[this.sp[i]], om = Math.abs(s.q / s.m) * Math.hypot(b[0], b[1], b[2]);
        const h = Math.min(left, 0.2 / Math.max(om, 0.5), 0.02);
        this.push(i, h);
        left -= h;
      }
      const o = i * 3, x = this.x;
      if (this.scene === 1) { // the drift direction wraps (the trail draws across the seam point by point)
        if (x[o + 2] > ZWRAP) x[o + 2] -= 2 * ZWRAP; else if (x[o + 2] < -ZWRAP) x[o + 2] += 2 * ZWRAP;
      } else if (this.scene === 2 && (Math.abs(x[o + 1]) > 2.3 || Math.hypot(x[o], x[o + 2]) > 1.6)) {
        this.escaped++; this.spawn(i, false); // out through the loss cone: a fresh particle in the middle
      } else if (this.scene === 3) {
        const r = Math.hypot(x[o], x[o + 1], x[o + 2]);
        if (r < RE * 1.02 || r > 3.2) this.spawn(i, false); // lost to the atmosphere (or out): a fresh one
      }
    }
    this.t += T;
    this.sampleAcc += T;
    while (this.sampleAcc >= sampleEvery) {
      this.sampleAcc -= sampleEvery;
      this.head = (this.head + 1) % this.TL;
      const base = this.head * this.M * 3;
      for (let i = 0; i < this.M; i++) {
        const o = i * 3, q = base + o;
        let z = this.x[o + 2];
        if (this.scene === 1) z = ((z + ZWRAP) % (2 * ZWRAP) + 2 * ZWRAP) % (2 * ZWRAP) - ZWRAP;
        this.trail[q] = this.x[o]; this.trail[q + 1] = this.x[o + 1]; this.trail[q + 2] = z;
      }
    }
  }

  private buildGuides(): void {
    const pos = this.positions, col = this.colors, P = this.particleCount;
    let p = this.guide0;
    const put = (x: number, y: number, z: number, h: number, s: number, l: number, dim = 1): void => {
      if (p >= P) return;
      pos[p * 3] = x; pos[p * 3 + 1] = y; pos[p * 3 + 2] = z;
      hslToRgb(h, s, l, col, p * 3);
      if (dim !== 1) for (let c = 0; c < 3; c++) col[p * 3 + c] *= dim;
      p++;
    };
    const n = this.guideN;
    if (this.scene === 0 || this.scene === 1) {
      // vertical B arrows on a grid (and, for E × B, E arrows along x)
      const per = Math.floor(n / (this.scene === 1 ? 50 : 25));
      for (let g = 0; g < 25; g++) {
        const gx = ((g % 5) - 2) * 0.8, gz = (Math.floor(g / 5) - 2) * 0.8;
        for (let k = 0; k < per; k++) { const u = k / per; put(gx, -1.1 + 2.2 * u, gz, 0.6, 0.4, 0.4, 0.3 + 0.5 * u); }
      }
      if (this.scene === 1) for (let g = 0; g < 25; g++) {
        const gy = ((g % 5) - 2) * 0.45, gz = (Math.floor(g / 5) - 2) * 0.9;
        for (let k = 0; k < per; k++) { const u = k / per; put(-1.7 + 3.4 * u, gy, gz, 0.15, 0.5, 0.4, 0.3 + 0.5 * u); }
      }
    } else if (this.scene === 2) {
      // the two coils and a fan of field lines traced through the bottle
      const coilN = Math.floor(n * 0.25);
      for (let k = 0; k < coilN; k++) { const a = (k / (coilN / 2)) * Math.PI * 2, y = k < coilN / 2 ? COIL_Y : -COIL_Y; put(COIL_A * Math.cos(a), y, COIL_A * Math.sin(a), 0.1, 0.8, 0.55); }
      const lines = 16, per = Math.floor((n - coilN) / lines), b = new Float64Array(3);
      for (let l = 0; l < lines; l++) {
        const r0 = 0.12 + 0.42 * ((l % 4) / 3), a = (Math.floor(l / 4) / 4) * Math.PI * 2 + 0.3;
        let x = r0 * Math.cos(a), y = 0, z = r0 * Math.sin(a);
        // trace both ways from the mid-plane
        for (let k = 0; k < per; k++) {
          const dir = k < per / 2 ? 1 : -1;
          if (k === Math.floor(per / 2)) { x = r0 * Math.cos(a); y = 0; z = r0 * Math.sin(a); }
          this.fieldAt(x, y, z, b);
          const bm = Math.hypot(b[0], b[1], b[2]) || 1, ds = 2.4 / (per / 2);
          x += dir * b[0] / bm * ds; y += dir * b[1] / bm * ds; z += dir * b[2] / bm * ds;
          put(x, y, z, 0.6, 0.35, 0.42, 0.55);
        }
      }
    } else {
      // the Earth (a dim sphere with a brighter equator) and dipole field lines r = L cos²λ
      const earthN = Math.floor(n * 0.45);
      for (let k = 0; k < earthN; k++) {
        const y = 1 - (2 * (k + 0.5)) / earthN, r = Math.sqrt(1 - y * y), a = k * 2.399963229728653;
        const eq = Math.abs(y) < 0.02;
        put(RE * r * Math.cos(a), RE * y, RE * r * Math.sin(a), 0.58, 0.6, eq ? 0.6 : 0.3, eq ? 1 : 0.5);
      }
      const lines = 24, per = Math.floor((n - earthN) / lines);
      for (let l = 0; l < lines; l++) {
        const L = (2 + 0.8 * (l % 3)) * RE, ph = (Math.floor(l / 3) / 8) * Math.PI * 2; // shells at L = 2, 2.8, 3.6
        const lmax = Math.acos(Math.sqrt(RE / L));
        for (let k = 0; k < per; k++) {
          const lat = -lmax + 2 * lmax * (k / (per - 1)), r = L * Math.cos(lat) ** 2;
          put(r * Math.cos(lat) * Math.cos(ph), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(ph), 0.6, 0.3, 0.4, 0.45);
        }
      }
    }
    for (; p < P; p++) { pos[p * 3] = 0; pos[p * 3 + 1] = 0; pos[p * 3 + 2] = 0; col[p * 3] = col[p * 3 + 1] = col[p * 3 + 2] = 0; }
  }

  private syncPositions(): void {
    const pos = this.positions, M = this.M, TL = this.TL;
    for (let s = 0; s < TL; s++) {
      const src = ((this.head - s + TL) % TL) * M * 3, dst = s * M * 3;
      for (let k = 0; k < M * 3; k++) pos[dst + k] = this.trail[src + k];
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.advance(dt);
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const s = new Float64Array(1 + 6 * this.M);
    s[0] = this.t; s.set(this.x, 1); s.set(this.v, 1 + 3 * this.M);
    return s;
  }
  loadState(s: Float64Array): void {
    if (s.length !== 1 + 6 * this.M) return;
    this.t = s[0]; this.x.set(s.subarray(1, 1 + 3 * this.M)); this.v.set(s.subarray(1 + 3 * this.M));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    let label: string;
    const B = this.B;
    if (this.scene === 0) label = `uniform B = ${B.toFixed(2)}: ω = qB/m — light ions (orange, +) and (cyan, −) circle ${(2 * Math.PI / B).toFixed(2)} s per turn whatever their speed, opposite ways; the 4× heavier ions (magenta) take ${(8 * Math.PI / B).toFixed(2)} s`;
    else if (this.scene === 1) label = `E = ${this.E.toFixed(2)} across B = ${B.toFixed(2)}: every particle drifts at E/B = ${(this.E / B).toFixed(3)} in the E × B direction, whatever its charge or mass`;
    else if (this.scene === 2) {
      const R = this.bMax / this.bMid, cone = Math.asin(Math.sqrt(1 / R)) * 180 / Math.PI;
      label = `mirror ratio B_max/B_min = ${R.toFixed(2)} → loss cone ${cone.toFixed(1)}° (particles with a smaller pitch angle escape: ${(100 * (1 - Math.sqrt(1 - 1 / R))).toFixed(0)}% of an isotropic population) · ${this.escaped} escaped so far`;
    } else label = 'Earth dipole: gyrate, bounce between the hemispheres, drift round — positive ions westward, negative charges eastward';
    return [{ id: 'root', parentId: null, label, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const chargedParticlesFactory: ArchetypeFactory = {
  id: 'chargedParticles',
  label: 'Charged Particles in Fields',
  category: 'Plasma',
  kind: 'flow',
  params: [
    { key: 'scene', label: 'set-up', min: 0, max: 3, step: 1, default: 2, options: SCENES, rebuild: true },
    { key: 'B', label: 'magnetic field strength', min: 0.5, max: 2, step: 0.05, default: 1 },
    { key: 'E', label: 'electric field (E × B)', min: 0, max: 0.8, step: 0.02, default: 0.4 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 150_000,
  particleCountOptions: [80_000, 150_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.35,
  create: (config) => new ChargedParticlesArchetype(config),
};

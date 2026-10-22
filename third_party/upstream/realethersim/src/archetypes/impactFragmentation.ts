import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Impact Fragmentation. What happens when something hits an asteroid hard enough to shatter it —
// the physics behind asteroid families (whole clans of asteroids sharing one ancient breakup, like
// the Karin cluster) and behind NASA's DART impact. Fragmentation is CASCADING and statistical:
// the first break leaves large fragments laced with internal cracks, which fail again, and again —
// and the resulting fragment sizes follow the fragmentation power law N(>s) ∝ s^(−α) of Grady–Kipp
// and Turcotte theory. We run the whole event as choreography: at each replay a full fragmentation
// TREE is planned up front (who splits, when, into what, with what kicks — all deterministic), so
// every fragment's flight is closed-form piecewise-ballistic with a rigid tumble, and every point
// just follows its deepest-born ancestor. A projectile of white-hot points streaks in, becomes the
// impact-ejecta fan at the moment of contact, and the rock blows apart generation by generation —
// then the debris drifts, the cycle wraps, and a new impact is planned. Bounded (finite flights).
const R0 = 0.72; // target body radius
const T_IMPACT = 0.9; // impact moment within the cycle (s at speed 1)
const T_CYCLE = 6.5; // full event length before replay
const TAU = Math.PI * 2;

interface Frag {
  birth: number; // when this fragment becomes a free body
  cx: number; cy: number; cz: number; // centre at birth
  vx: number; vy: number; vz: number; // ballistic velocity
  ax: number; ay: number; az: number; // tumble axis (unit)
  rate: number; // tumble rate
  parent: number; // index into frags, -1 for the intact body
}

class ImpactFragmentationArchetype implements Archetype {
  readonly id = 'impactFragmentation';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private nRock = 0;
  private nHot = 0;
  // per rock point: local offsets w.r.t. each ancestor level + fragment indices per level
  private off0: Float64Array = new Float64Array(0); // w.r.t. body centre (intact phase)
  private f1: Int32Array = new Int32Array(0);
  private off1: Float64Array = new Float64Array(0); // w.r.t. gen-1 fragment centre
  private f2: Int32Array = new Int32Array(0); // -1 if the point's gen-1 fragment never splits
  private off2: Float64Array = new Float64Array(0);
  private frags: Frag[] = [];
  // hot pool: projectile flight → impact-ejecta fan (per point: fan direction + speed)
  private hotDir: Float64Array = new Float64Array(0);
  private hotSpd: Float64Array = new Float64Array(0);
  private impact: [number, number, number] = [0, 0, 0];
  private projFrom: [number, number, number] = [0, 0, 0];
  private fragility = 0.6;
  private power = 1;
  private spin = 1;
  private speed = 1;
  private t = 0;
  private strike = 0;
  private buildKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(64, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.nHot = Math.floor(N * 0.16);
    this.nRock = N - this.nHot;
    this.off0 = new Float64Array(this.nRock * 3);
    this.f1 = new Int32Array(this.nRock);
    this.off1 = new Float64Array(this.nRock * 3);
    this.f2 = new Int32Array(this.nRock);
    this.off2 = new Float64Array(this.nRock * 3);
    this.hotDir = new Float64Array(this.nHot * 3);
    this.hotSpd = new Float64Array(this.nHot);
    this.seed = config.seed;
    // ── colours bake ONCE (plan-independent): speckled rock + white-hot projectile/ejecta ──
    const rng = mulberry32((this.seed ^ 0x1f83d9ab) >>> 0);
    for (let i = 0; i < this.nRock; i++) {
      const v = 0.32 + 0.5 * rng() * rng();
      const warm = 0.9 + 0.25 * rng();
      this.colors[i * 3] = v * warm;
      this.colors[i * 3 + 1] = v * 0.82;
      this.colors[i * 3 + 2] = v * 0.66; // speckled regolith brown-grey
    }
    for (let i = this.nRock; i < N; i++) {
      const v = 1.0 + 0.55 * rng();
      this.colors[i * 3] = v * 1.05;
      this.colors[i * 3 + 1] = v * 0.82;
      this.colors[i * 3 + 2] = v * 0.5; // white-hot ejecta (blooms)
    }
    this.readParams(config.params);
    // Start late in a prior cycle: the offline thumbnail capture (~3.2 sim-seconds of development)
    // then lands ~1.5s after the NEXT impact — mid-shatter, the money shot — and a live visitor sees
    // a fresh impact within a couple of seconds of arriving.
    this.t = T_CYCLE - 3.2 + 1.5;
    this.plan();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.fragility = p.fragility ?? 0.6;
    this.power = p.power ?? 1;
    this.spin = p.spin ?? 1;
    this.speed = p.speed ?? 1;
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round((p.fragility ?? 0.6) * 100)},${Math.round((p.power ?? 1) * 100)}`;
  }

  // ── plan one complete impact: fragment tree, kicks, timings — all closed-form afterwards ──
  private plan(): void {
    const rng = mulberry32((this.seed ^ Math.imul(this.strike + 7, 0x9e3779b1)) >>> 0);
    const frags: Frag[] = [];
    this.frags = frags;
    // impact geometry: projectile arrives along a random direction, strikes the surface
    const iu = rng() * 2 - 1, ia = rng() * TAU;
    const isr = Math.sqrt(Math.max(0, 1 - iu * iu));
    const nx = isr * Math.cos(ia), ny = iu, nz = isr * Math.sin(ia); // impact normal (unit, outward)
    this.impact = [nx * R0, ny * R0, nz * R0];
    this.projFrom = [nx * 3.4, ny * 3.4, nz * 3.4];
    // ── gen-1: Voronoi-ish seeds inside the body; kicks ~ radial from impact + power law ──
    const n1 = 9 + Math.floor(rng() * 5);
    const seeds: number[][] = [];
    for (let k = 0; k < n1; k++) {
      const r = R0 * Math.cbrt(rng()) * 0.92;
      const u = rng() * 2 - 1, az = rng() * TAU;
      const sr = Math.sqrt(Math.max(0, 1 - u * u));
      seeds.push([r * sr * Math.cos(az), r * u, r * sr * Math.sin(az)]);
    }
    for (let k = 0; k < n1; k++) {
      const [sx, sy, sz] = seeds[k];
      // kick: mostly radial from the body centre (keeps the cloud framed) + a shove along the impact
      // axis, fastest for fragments nearest the impact (momentum share)
      const rd = Math.hypot(sx, sy, sz) || 1;
      let kx = sx - this.impact[0], ky = sy - this.impact[1], kz = sz - this.impact[2];
      const kd = Math.hypot(kx, ky, kz) || 1;
      const kick = (0.2 * this.power) / (0.35 + kd) * (0.75 + 0.5 * rng());
      kx = ((sx / rd) * 0.6 + (kx / kd) * 0.4) * kick;
      ky = ((sy / rd) * 0.6 + (ky / kd) * 0.4) * kick;
      kz = ((sz / rd) * 0.6 + (kz / kd) * 0.4) * kick;
      const u = rng() * 2 - 1, az = rng() * TAU;
      const sr = Math.sqrt(Math.max(0, 1 - u * u));
      frags.push({
        birth: T_IMPACT,
        cx: sx, cy: sy, cz: sz,
        vx: kx, vy: ky, vz: kz,
        ax: sr * Math.cos(az), ay: u, az: sr * Math.sin(az),
        rate: (rng() - 0.5) * 2.4 * this.spin,
        parent: -1,
      });
    }
    // ── gen-2: cascading failure — fragments crack again shortly after the impact ──
    const n1frags = frags.length;
    for (let k = 0; k < n1frags; k++) {
      if (rng() > this.fragility) continue;
      const pf = frags[k];
      const tb = T_IMPACT + 0.35 + rng() * 1.3; // secondary failure time
      const kids = 2 + Math.floor(rng() * 2);
      for (let c = 0; c < kids; c++) {
        const u = rng() * 2 - 1, az2 = rng() * TAU;
        const sr = Math.sqrt(Math.max(0, 1 - u * u));
        const dx = sr * Math.cos(az2), dy = u, dz = sr * Math.sin(az2);
        const dt = tb - pf.birth;
        const kick2 = 0.07 * this.power * (0.6 + 0.8 * rng());
        frags.push({
          birth: tb,
          // child is born at the parent's ballistic position, offset a little along its own kick
          cx: pf.cx + pf.vx * dt + dx * 0.06,
          cy: pf.cy + pf.vy * dt + dy * 0.06,
          cz: pf.cz + pf.vz * dt + dz * 0.06,
          vx: pf.vx + dx * kick2,
          vy: pf.vy + dy * kick2,
          vz: pf.vz + dz * kick2,
          ax: dx, ay: dy, az: dz,
          rate: (rng() - 0.5) * 3.4 * this.spin,
          parent: k,
        });
      }
    }
    // ── assign rock points: nearest gen-1 seed → fragment; nearest child (if any) → gen-2 ──
    // children of gen-1 fragment k live at indices > n1frags with parent === k
    const childrenOf: number[][] = Array.from({ length: n1frags }, () => []);
    for (let f = n1frags; f < frags.length; f++) childrenOf[frags[f].parent].push(f);
    for (let i = 0; i < this.nRock; i++) {
      // sample the body: slightly clumpy solid sphere
      const r = R0 * Math.cbrt(rng());
      const u = rng() * 2 - 1, az = rng() * TAU;
      const sr = Math.sqrt(Math.max(0, 1 - u * u));
      const x = r * sr * Math.cos(az), y = r * u, z = r * sr * Math.sin(az);
      this.off0[i * 3] = x; this.off0[i * 3 + 1] = y; this.off0[i * 3 + 2] = z;
      // nearest gen-1 seed
      let best = 0, bd = Infinity;
      for (let k = 0; k < n1frags; k++) {
        const d = (x - frags[k].cx) ** 2 + (y - frags[k].cy) ** 2 + (z - frags[k].cz) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      this.f1[i] = best;
      this.off1[i * 3] = x - frags[best].cx;
      this.off1[i * 3 + 1] = y - frags[best].cy;
      this.off1[i * 3 + 2] = z - frags[best].cz;
      // nearest gen-2 child of that fragment (each child claims a random sub-cluster direction)
      const kids = childrenOf[best];
      if (kids.length > 0) {
        const pick = kids[Math.floor(rng() * kids.length)];
        this.f2[i] = pick;
        // local offset shrinks: the child is a shard of the parent
        this.off2[i * 3] = this.off1[i * 3] * 0.55;
        this.off2[i * 3 + 1] = this.off1[i * 3 + 1] * 0.55;
        this.off2[i * 3 + 2] = this.off1[i * 3 + 2] * 0.55;
      } else {
        this.f2[i] = -1;
      }
    }
    // ── hot pool: ejecta fan directions (cone around the impact normal) + power-law speeds ──
    for (let i = 0; i < this.nHot; i++) {
      const cone = 0.55 + 0.5 * rng(); // opening of the fan
      const az = rng() * TAU;
      // basis around the outward normal
      const [t1x, t1y, t1z, t2x, t2y, t2z] = tangentBasis(nx, ny, nz);
      const dx = nx * cone + (t1x * Math.cos(az) + t2x * Math.sin(az)) * (1 - cone * 0.5);
      const dy = ny * cone + (t1y * Math.cos(az) + t2y * Math.sin(az)) * (1 - cone * 0.5);
      const dz = nz * cone + (t1z * Math.cos(az) + t2z * Math.sin(az)) * (1 - cone * 0.5);
      const dl = Math.hypot(dx, dy, dz) || 1;
      this.hotDir[i * 3] = dx / dl; this.hotDir[i * 3 + 1] = dy / dl; this.hotDir[i * 3 + 2] = dz / dl;
      this.hotSpd[i] = 0.5 * this.power * Math.pow(rng(), 1.6) * 2.2 + 0.12; // few fast, many slow
    }
  }

  private syncPositions(): void {
    const pos = this.positions;
    const tau = this.t % T_CYCLE;
    const frags = this.frags;
    // ── rock: intact spin before impact; after, follow the deepest-born ancestor fragment ──
    const bodySpin = 0.25 * tau;
    const cb = Math.cos(bodySpin), sb = Math.sin(bodySpin);
    for (let i = 0; i < this.nRock; i++) {
      let x: number, y: number, z: number;
      if (tau < T_IMPACT) {
        const ox = this.off0[i * 3], oz = this.off0[i * 3 + 2];
        x = ox * cb + oz * sb; y = this.off0[i * 3 + 1]; z = -ox * sb + oz * cb; // slow intact rotation
      } else {
        let f = this.f1[i];
        const f2 = this.f2[i];
        let offx: number, offy: number, offz: number;
        if (f2 >= 0 && frags[f2].birth <= tau) {
          f = f2;
          offx = this.off2[i * 3]; offy = this.off2[i * 3 + 1]; offz = this.off2[i * 3 + 2];
        } else {
          offx = this.off1[i * 3]; offy = this.off1[i * 3 + 1]; offz = this.off1[i * 3 + 2];
        }
        const fr = frags[f];
        const dt = tau - fr.birth;
        // Rodrigues tumble of the rigid offset about the fragment's axis
        const th = fr.rate * dt;
        const c = Math.cos(th), s = Math.sin(th), omc = 1 - c;
        const kx = fr.ax, ky = fr.ay, kz = fr.az;
        const kv = kx * offx + ky * offy + kz * offz;
        const rx = offx * c + (ky * offz - kz * offy) * s + kx * kv * omc;
        const ry = offy * c + (kz * offx - kx * offz) * s + ky * kv * omc;
        const rz = offz * c + (kx * offy - ky * offx) * s + kz * kv * omc;
        x = fr.cx + fr.vx * dt + rx;
        y = fr.cy + fr.vy * dt + ry;
        z = fr.cz + fr.vz * dt + rz;
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
    // ── hot pool: inbound projectile → ejecta fan at impact ──
    const o0 = this.nRock;
    for (let i = 0; i < this.nHot; i++) {
      const o = (o0 + i) * 3;
      if (tau < T_IMPACT) {
        // tight projectile cluster streaking in
        const f = tau / T_IMPACT;
        const jx = this.hotDir[i * 3] * 0.03, jy = this.hotDir[i * 3 + 1] * 0.03, jz = this.hotDir[i * 3 + 2] * 0.03;
        pos[o] = this.projFrom[0] + (this.impact[0] - this.projFrom[0]) * f + jx;
        pos[o + 1] = this.projFrom[1] + (this.impact[1] - this.projFrom[1]) * f + jy;
        pos[o + 2] = this.projFrom[2] + (this.impact[2] - this.projFrom[2]) * f + jz;
      } else {
        const dt = tau - T_IMPACT;
        const s = this.hotSpd[i];
        pos[o] = this.impact[0] + this.hotDir[i * 3] * s * dt;
        pos[o + 1] = this.impact[1] + this.hotDir[i * 3 + 1] * s * dt;
        pos[o + 2] = this.impact[2] + this.hotDir[i * 3 + 2] * s * dt;
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const key = this.keyOf(p);
    if (key !== this.buildKey) {
      this.buildKey = key;
      this.readParams(p);
      this.plan(); // live params reshape the NEXT plan too, but replan now for responsiveness
    }
    this.readParams(p);
    const before = Math.floor(this.t / T_CYCLE);
    this.t += dt * this.speed;
    if (Math.floor(this.t / T_CYCLE) !== before) {
      this.strike++;
      this.plan(); // a fresh impact every cycle
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t, this.strike]); }
  loadState(s: Float64Array): void {
    this.t = s[0] ?? 0;
    this.strike = s[1] ?? 0;
    this.plan();
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Impact fragmentation cascade', stateOffset: 0, stateLength: 2 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.0075 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

// orthonormal tangent basis at unit normal n
function tangentBasis(nx: number, ny: number, nz: number): number[] {
  let ax = 0, ay = 1, az = 0;
  if (Math.abs(ny) > 0.9) { ax = 1; ay = 0; az = 0; }
  const d = ax * nx + ay * ny + az * nz;
  let t1x = ax - d * nx, t1y = ay - d * ny, t1z = az - d * nz;
  const l1 = Math.hypot(t1x, t1y, t1z) || 1;
  t1x /= l1; t1y /= l1; t1z /= l1;
  return [t1x, t1y, t1z, ny * t1z - nz * t1y, nz * t1x - nx * t1z, nx * t1y - ny * t1x];
}

export const impactFragmentationFactory: ArchetypeFactory = {
  id: 'impactFragmentation',
  label: 'Impact Fragmentation',
  category: 'Matter',
  kind: 'flow',
  params: [
    { key: 'fragility', label: 'fragility', min: 0, max: 1, step: 0.05, default: 0.6 }, // cascade probability
    { key: 'power', label: 'impact power', min: 0.4, max: 2, step: 0.05, default: 1 }, // kick + ejecta scale
    { key: 'spin', label: 'tumble', min: 0, max: 2.5, step: 0.05, default: 1 }, // fragment rotation
    { key: 'speed', label: 'replay rate', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 90_000,
  particleCountOptions: [40_000, 90_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the shattering body IS the visual
  create: (config) => new ImpactFragmentationArchetype(config),
};

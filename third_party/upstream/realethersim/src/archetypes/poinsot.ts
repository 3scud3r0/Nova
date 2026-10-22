import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';
import { quatFromTo, quatToMatrix, rigidStep, type Inertia } from './rigidBody';

// Poinsot's Construction — how a free body wobbles (and why the Earth's pole wanders). Louis Poinsot
// (1834) found a purely geometric picture of torque-free rotation: attach to the body its inertia
// ellipsoid  xᵀ I x = 1. Then the ellipsoid ROLLS WITHOUT SLIPPING on a fixed plane — the invariable plane,
// perpendicular to the (constant) angular momentum — with its centre fixed. The point of contact is
// always on the instantaneous spin axis ω. Seen from the body, the contact point runs round a closed
// curve on the ellipsoid (the POLHODE, gold); seen from space it traces the HERPOLHODE on the plane
// (the fading pink rosette) — which, as Poinsot noted with delight, generally never closes. Make the body nearly
// symmetric (asymmetry → 0) and the herpolhode becomes a circle: the spin axis circles the momentum axis.
// That is the Earth's FREE NUTATION, the Chandler wobble — the pole wanders a few metres on a ~433-day
// cycle (longer than Euler's rigid-Earth 305 days, because the Earth is not rigid). Exact torque-free
// Euler equations + quaternion attitude (rigidBody.ts); the contact point is computed, not assumed.

const SCALE = 1.25; // render units per ellipsoid unit
const TAIL = 7000; // herpolhode samples

class PoinsotArchetype implements Archetype {
  readonly id = 'poinsot';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly I: Inertia;
  private readonly s: Float64Array; // [ω₁, ω₂, ω₃, q]
  private readonly L0: number;
  private readonly norm: number; // 1/√(2T): ω → ellipsoid coordinates
  private readonly d: number; // distance of the invariable plane below the centre (ellipsoid units)
  private readonly tail = new Float64Array(TAIL * 2); // herpolhode (x, z) on the plane
  private head = 0;
  private readonly role: Uint8Array; // 0 static (plane, L axis), 1 body (ellipsoid + polhode), 2 herpolhode, 3 ω rod
  private readonly bx: Float32Array; private readonly by: Float32Array; private readonly bz: Float32Array;
  private readonly m = new Float64Array(9);
  private spin = 1;
  private speed = 1;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const asym = Math.min(0.98, Math.max(0, config.params.asymmetry ?? 0.45));
    const start = Math.min(0.95, Math.max(0.05, config.params.start ?? 0.8));
    this.readParams(config.params);
    // principal moments: I₂ slides from I₁ (symmetric) toward I₃
    const I1 = 1, I3 = 2.2;
    this.I = [I1, I1 + asym * (I3 - I1) * 0.8, I3];
    const [a, , c] = [1 / this.I[0], 1 / this.I[1], 1 / this.I[2]];
    // choose the polhode by its energy: the momentum direction starts in the 1–3 plane
    const h = c + (a - c) * start * 0.5; // below the separatrix region: loops round the axis of largest I
    const L1 = Math.sqrt((h - c) / (a - c)), L3 = Math.sqrt(1 - L1 * L1);
    const Lb = [L1, 0.0, L3];
    const w = [Lb[0] / this.I[0], Lb[1] / this.I[1], Lb[2] / this.I[2]];
    // angular momentum points DOWN (−y) so the invariable plane is a floor under the ellipsoid
    const q = quatFromTo(Lb[0], Lb[1], Lb[2], 0, -1, 0);
    this.s = Float64Array.from([w[0], w[1], w[2], q[0], q[1], q[2], q[3]]);
    this.L0 = 1;
    const twoT = w[0] * Lb[0] + w[1] * Lb[1] + w[2] * Lb[2];
    this.norm = 1 / Math.sqrt(twoT);
    this.d = Math.sqrt(twoT) / this.L0; // contact point · L̂
    // pre-roll so the herpolhode opens already drawn
    for (let i = 0; i < TAIL; i++) this.advance(0.016 * 1.6);

    this.role = new Uint8Array(P);
    this.bx = new Float32Array(P); this.by = new Float32Array(P); this.bz = new Float32Array(P);
    const col = this.colors;
    let p = 0;
    const put = (role: number, x: number, y: number, z: number, hh: number, ss: number, ll: number, gain = 1): void => {
      if (p >= P) return;
      this.role[p] = role; this.bx[p] = x; this.by[p] = y; this.bz[p] = z;
      hslToRgb(hh, ss, ll, col, p * 3);
      col[p * 3] *= gain; col[p * 3 + 1] *= gain; col[p * 3 + 2] *= gain;
      p++;
    };
    const ax = [1 / Math.sqrt(this.I[0]), 1 / Math.sqrt(this.I[1]), 1 / Math.sqrt(this.I[2])]; // ellipsoid semi-axes
    // the ellipsoid as a lattice of latitude/longitude lines (body frame)
    const ellBudget = Math.floor(P * 0.3);
    const rings = 14, merid = 18;
    const perLine = Math.floor(ellBudget / (rings + merid));
    for (let r = 1; r <= rings; r++) {
      const th = (r / (rings + 1)) * Math.PI;
      for (let i = 0; i < perLine; i++) {
        const ph = (i / perLine) * Math.PI * 2;
        put(1, ax[0] * Math.sin(th) * Math.cos(ph), ax[1] * Math.sin(th) * Math.sin(ph), ax[2] * Math.cos(th), 0.58, 0.55, 0.42, 0.7);
      }
    }
    for (let m = 0; m < merid; m++) {
      const ph = (m / merid) * Math.PI * 2;
      for (let i = 0; i < perLine; i++) {
        const th = (i / perLine) * Math.PI;
        put(1, ax[0] * Math.sin(th) * Math.cos(ph), ax[1] * Math.sin(th) * Math.sin(ph), ax[2] * Math.cos(th), 0.58, 0.55, 0.42, 0.7);
      }
    }
    // the polhode on the ellipsoid (body frame): x = I⁻¹L/√h for L on the momentum-sphere curve of energy h.
    // Below the separatrix energy (h < 1/I₂) it loops round axis 3; above it, round axis 1.
    const b = 1 / this.I[1];
    const polBudget = Math.floor(P * 0.1);
    const sq = Math.sqrt(h);
    for (let i = 0; i < polBudget; i++) {
      const t = (i / polBudget) * Math.PI * 2;
      let l1: number, l2: number, l3: number;
      if (h <= b) {
        l1 = Math.sqrt((h - c) / (a - c)) * Math.cos(t);
        l2 = Math.sqrt((h - c) / Math.max(1e-9, b - c)) * Math.sin(t);
        l3 = Math.sqrt(Math.max(0, 1 - l1 * l1 - l2 * l2));
      } else {
        l2 = Math.sqrt((a - h) / Math.max(1e-9, a - b)) * Math.cos(t);
        l3 = Math.sqrt((a - h) / (a - c)) * Math.sin(t);
        l1 = Math.sqrt(Math.max(0, 1 - l2 * l2 - l3 * l3));
      }
      put(1, (l1 / this.I[0] / sq) * 1.004, (l2 / this.I[1] / sq) * 1.004, (l3 / this.I[2] / sq) * 1.004, 0.12, 0.95, 0.6, 1.5);
    }
    // the invariable plane (a faint disc of points) and the momentum axis through the centre
    const planeBudget = Math.floor(P * 0.12);
    for (let i = 0; i < planeBudget; i++) {
      const rr = 1.9 * Math.sqrt(i / planeBudget), ph = i * 2.39996323;
      put(0, rr * Math.cos(ph), -this.d, rr * Math.sin(ph), 0.6, 0.3, 0.25, 0.5);
    }
    const axisN = Math.max(8, Math.floor(P * 0.019)), rodN = Math.max(8, Math.floor(P * 0.022));
    for (let i = 0; i < axisN; i++) put(0, 0, -this.d + (i / axisN) * (this.d + 1.6), 0, 0.0, 0.0, 0.5, 0.45);
    // ω: a bright rod from the centre to the contact point
    for (let i = 0; i < rodN; i++) put(3, i / rodN, 0, 0, 0.0, 0.0, 0.9, 1.3);
    // the herpolhode on the plane, newest brightest
    const tailBudget = P - p;
    for (let i = 0; i < tailBudget; i++) {
      const age = (i / tailBudget) * (TAIL - 1);
      const fade = Math.pow(1 - age / TAIL, 1.1);
      put(2, age, 0, 0, 0.9, 0.85, 0.42 + 0.2 * fade, 0.18 + 0.8 * fade); // pink: distinct from the gold polhode
    }
    // static points once
    for (let q2 = 0; q2 < P; q2++) if (this.role[q2] === 0) {
      const o = q2 * 3;
      this.positions[o] = this.bx[q2] * SCALE; this.positions[o + 1] = this.by[q2] * SCALE; this.positions[o + 2] = this.bz[q2] * SCALE;
    }
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.spin = p.spin ?? 1;
    this.speed = p.speed ?? 1;
  }

  // contact point in space = R·(ω·norm); its (x, z) on the plane goes into the herpolhode
  private advance(h: number): void {
    for (let k = 0; k < 4; k++) rigidStep(this.s, this.I, h / 4, this.L0);
    quatToMatrix(this.s[3], this.s[4], this.s[5], this.s[6], this.m);
    const m = this.m, n = this.norm, w = this.s;
    const X = (m[0] * w[0] + m[1] * w[1] + m[2] * w[2]) * n;
    const Z = (m[6] * w[0] + m[7] * w[1] + m[8] * w[2]) * n;
    this.head = (this.head + 1) % TAIL;
    this.tail[this.head * 2] = X; this.tail[this.head * 2 + 1] = Z;
  }

  private syncPositions(): void {
    quatToMatrix(this.s[3], this.s[4], this.s[5], this.s[6], this.m);
    const m = this.m, pos = this.positions, n = this.norm, w = this.s;
    const cx = (m[0] * w[0] + m[1] * w[1] + m[2] * w[2]) * n;
    const cy = (m[3] * w[0] + m[4] * w[1] + m[5] * w[2]) * n;
    const cz = (m[6] * w[0] + m[7] * w[1] + m[8] * w[2]) * n;
    for (let p = 0; p < this.particleCount; p++) {
      const role = this.role[p], o = p * 3;
      if (role === 0) continue;
      if (role === 1) {
        const X = this.bx[p], Y = this.by[p], Z = this.bz[p];
        pos[o] = (m[0] * X + m[1] * Y + m[2] * Z) * SCALE;
        pos[o + 1] = (m[3] * X + m[4] * Y + m[5] * Z) * SCALE;
        pos[o + 2] = (m[6] * X + m[7] * Y + m[8] * Z) * SCALE;
      } else if (role === 3) {
        const t = this.bx[p];
        pos[o] = cx * t * SCALE; pos[o + 1] = cy * t * SCALE; pos[o + 2] = cz * t * SCALE;
      } else {
        const age = this.bx[p], a0 = age | 0, t = age - a0;
        let i0 = this.head - a0; if (i0 < 0) i0 += TAIL;
        let i1 = i0 - 1; if (i1 < 0) i1 += TAIL;
        pos[o] = (this.tail[i0 * 2] * (1 - t) + this.tail[i1 * 2] * t) * SCALE;
        pos[o + 1] = -this.d * SCALE + 0.004;
        pos[o + 2] = (this.tail[i0 * 2 + 1] * (1 - t) + this.tail[i1 * 2 + 1] * t) * SCALE;
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const h = dt * this.speed * this.spin * 1.6;
    if (h > 0) this.advance(h);
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return Float64Array.from([...this.s, this.head, ...this.tail]); }
  loadState(s: Float64Array): void {
    if (s.length !== 8 + TAIL * 2) return;
    this.s.set(s.subarray(0, 7)); this.head = s[7]; this.tail.set(s.subarray(8));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const [I1, I2, I3] = this.I;
    return [{ id: 'root', parentId: null, label: `I₁ : I₂ : I₃ = ${I1.toFixed(2)} : ${I2.toFixed(2)} : ${I3.toFixed(2)}${I2 - I1 < 1e-6 ? ' (symmetric: Chandler-style circle)' : ''}`, stateOffset: 0, stateLength: 7 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const poinsotFactory: ArchetypeFactory = {
  id: 'poinsot',
  label: "Poinsot's Rolling Ellipsoid",
  category: 'Rotation',
  kind: 'flow',
  params: [
    { key: 'asymmetry', label: 'asymmetry (0 = Earth-like)', min: 0, max: 0.95, step: 0.01, default: 0.45, rebuild: true },
    { key: 'start', label: 'wobble size', min: 0.05, max: 0.95, step: 0.01, default: 0.8, rebuild: true },
    { key: 'spin', label: 'spin rate', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 160_000,
  particleCountOptions: [80_000, 160_000, 240_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new PoinsotArchetype(config),
};

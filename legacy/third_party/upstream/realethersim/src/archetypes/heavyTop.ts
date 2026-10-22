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

// The Heavy Top — precession and nutation. A spinning top leaning over does not fall: gravity's torque
// turns its spin axis sideways, so the axis sweeps slowly round the vertical (PRECESSION). On top of that
// it nods up and down (NUTATION), and how it nods depends only on how it was let go. Three identical tops
// spin here, each released at the same tilt with the same spin; only the sideways push differs:
//   • pushed forward along the precession  → the axis tip traces gentle WAVES;
//   • let go with no push                   → it traces CUSPS (it stops dead at the top of each nod);
//   • pushed backward                       → it traces LOOPS (it briefly runs backwards each nod).
// This is Lagrange's top (a symmetric top on a fixed point under gravity), solved exactly from its two
// conserved angular momenta and energy: φ̇ = (b − a·cosθ)/sin²θ, and θ̈ = φ̇²·sinθ·cosθ − a·φ̇·sinθ + (mgl/I)·sinθ.
// Each top's spin axis leaves a fading trail on the sphere it moves on; a stripe on each disc shows its spin.

const TOP_X = [-2.1, 0, 2.1];
const PIVOT_Y = -0.75;
const AXIS_LEN = 0.95; // pivot → tip (render units)
const DISC_AT = 0.62; // disc centre along the axis
const DISC_R = 0.3;
const TAIL = 1500; // samples (one per step)
const TRAIL_HUE = [0.52, 0.11, 0.85]; // waves cyan, cusps gold, loops magenta
const PUSH = [1.9, 0, -1.0]; // initial φ̇ in units of the slow-precession rate

interface Top { s: Float64Array; b: number; tail: Float64Array; head: number; count: number } // s = [θ, θ̇, φ, ψ]

class HeavyTopArchetype implements Archetype {
  readonly id = 'heavyTop';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly tops: Top[] = [];
  private a: number; // p_ψ / I  (= I₃ω₃ / I)
  private I3 = 0.8; // spin moment (transverse I = 1)
  private grav = 1; // m g l / I
  private speed = 1;
  // points
  private readonly role: Uint8Array; // 0 static (sphere guide), 1 body, 2 trail
  private readonly owner: Uint8Array;
  private readonly u: Float32Array; private readonly v: Float32Array; private readonly w: Float32Array; private readonly x3: Float32Array; // role params

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    const spin = config.params.spin ?? 3;
    const tilt = config.params.tilt ?? 0.85;
    this.grav = config.params.gravity ?? 1;
    this.speed = config.params.speed ?? 1;
    this.a = (this.I3 * spin) / 1;
    const precess = this.grav / this.a; // slow-precession rate (fast-top limit) mgl/(I₃ω₃)
    for (let k = 0; k < 3; k++) {
      const phiDot = PUSH[k] * precess;
      const b = phiDot * Math.sin(tilt) ** 2 + this.a * Math.cos(tilt);
      const tail = new Float64Array(TAIL * 3);
      const top: Top = { s: Float64Array.from([tilt, 0, 0, 0]), b, tail, head: 0, count: 0 };
      this.tops.push(top);
    }
    // run the tops for a while so they open with their trails already drawn
    for (let s = 0; s < TAIL; s++) this.advance(0.016);

    this.role = new Uint8Array(P); this.owner = new Uint8Array(P);
    this.u = new Float32Array(P); this.v = new Float32Array(P); this.w = new Float32Array(P); this.x3 = new Float32Array(P);
    const col = this.colors;
    let p = 0;
    const put = (role: number, owner: number, u: number, v: number, w: number, h: number, s: number, l: number, gain = 1): void => {
      if (p >= P) return;
      this.role[p] = role; this.owner[p] = owner; this.u[p] = u; this.v[p] = v; this.w[p] = w;
      hslToRgb(h, s, l, col, p * 3);
      col[p * 3] *= gain; col[p * 3 + 1] *= gain; col[p * 3 + 2] *= gain;
      p++;
    };
    const trailBudget = Math.floor(P * 0.17); // per top
    const bodyBudget = Math.floor(P * 0.1); // per top
    for (let k = 0; k < 3; k++) {
      // the faint sphere the tip lives on: latitude rings + meridians (upper hemisphere and a little below)
      const ringN = Math.max(12, Math.floor(P * 0.0026)), meridN = Math.max(6, Math.floor(P * 0.001)); // ~3% of the points per sphere
      for (let r = 0; r < 7; r++) {
        const th = 0.15 + r * 0.24;
        for (let i = 0; i < ringN; i++) put(0, k, th, (i / ringN) * Math.PI * 2, 0, 0.6, 0.3, 0.3, 0.45);
      }
      for (let m = 0; m < 12; m++) for (let i = 0; i < meridN; i++) put(0, k, (i / meridN) * 1.75, (m / 12) * Math.PI * 2, 0, 0.6, 0.3, 0.3, 0.45);
      // body: the axle (pivot → tip), the disc rim + spokes, a coloured stripe, a ball at the tip
      const start = p;
      for (let i = 0; i < bodyBudget * 0.18; i++) put(1, k, 0, (i / (bodyBudget * 0.18)) * AXIS_LEN, (rng() - 0.5) * 0.01, 0.58, 0.15, 0.75);
      for (let i = 0; i < bodyBudget * 0.3; i++) put(1, k, 1, (i / (bodyBudget * 0.3)) * Math.PI * 2, 1, 0.58, 0.15, 0.7);
      for (let sp = 0; sp < 6; sp++) for (let i = 0; i < bodyBudget * 0.035; i++) {
        const stripe = sp === 0;
        put(1, k, 1, (sp / 6) * Math.PI * 2, i / (bodyBudget * 0.035), stripe ? TRAIL_HUE[k] : 0.58, stripe ? 0.95 : 0.15, stripe ? 0.6 : 0.55, stripe ? 1.6 : 0.8);
      }
      for (let i = 0; i < bodyBudget * 0.12; i++) { // a small ball at the tip: offset (v, w, x3)
        const uu = rng() * 2 - 1, th = rng() * Math.PI * 2, r = 0.05 * Math.cbrt(rng()), ss = Math.sqrt(1 - uu * uu) * r;
        put(1, k, 2, ss * Math.cos(th), uu * r, TRAIL_HUE[k], 0.5, 0.75, 1.4);
        this.x3[p - 1] = ss * Math.sin(th);
      }
      while (p < start + bodyBudget && p < P) put(1, k, 0, 0, 0, 0, 0, 0);
      // the trail of the axis tip, newest brightest (interpolated between samples so it reads as a line)
      for (let i = 0; i < trailBudget; i++) {
        const age = (i / trailBudget) * (TAIL - 1);
        const fade = Math.pow(1 - age / TAIL, 1.3);
        put(2, k, age, 0, 0, TRAIL_HUE[k], 0.85, 0.35 + 0.35 * fade, 0.3 + 1.3 * fade);
      }
    }
    while (p < P) put(0, 0, 0, 0, 0, 0, 0, 0);
    // the guide spheres never move: place them once
    for (let q = 0; q < P; q++) {
      if (this.role[q] !== 0) continue;
      const th = this.u[q], ph = this.v[q], st = Math.sin(th), o = q * 3;
      this.positions[o] = st * Math.cos(ph) * AXIS_LEN + TOP_X[this.owner[q]];
      this.positions[o + 1] = Math.cos(th) * AXIS_LEN + PIVOT_Y;
      this.positions[o + 2] = st * Math.sin(ph) * AXIS_LEN;
    }
    this.syncPositions();
  }

  private deriv(top: Top, s: Float64Array, out: Float64Array): void {
    const th = Math.min(Math.PI - 1e-3, Math.max(1e-3, s[0]));
    const st = Math.sin(th), ct = Math.cos(th);
    const phiDot = (top.b - this.a * ct) / (st * st);
    out[0] = s[1];
    out[1] = phiDot * phiDot * st * ct - this.a * phiDot * st + this.grav * st;
    out[2] = phiDot;
    out[3] = this.a / this.I3 - phiDot * ct; // ψ̇ = ω₃ − φ̇ cosθ  (I = 1)
  }

  private readonly k1 = new Float64Array(4); private readonly k2 = new Float64Array(4);
  private readonly k3 = new Float64Array(4); private readonly k4 = new Float64Array(4); private readonly tmp = new Float64Array(4);

  private advance(h: number): void {
    const sub = 8, hh = h / sub;
    for (const top of this.tops) {
      const s = top.s;
      for (let n = 0; n < sub; n++) {
        this.deriv(top, s, this.k1);
        for (let i = 0; i < 4; i++) this.tmp[i] = s[i] + 0.5 * hh * this.k1[i];
        this.deriv(top, this.tmp, this.k2);
        for (let i = 0; i < 4; i++) this.tmp[i] = s[i] + 0.5 * hh * this.k2[i];
        this.deriv(top, this.tmp, this.k3);
        for (let i = 0; i < 4; i++) this.tmp[i] = s[i] + hh * this.k3[i];
        this.deriv(top, this.tmp, this.k4);
        for (let i = 0; i < 4; i++) s[i] += (hh / 6) * (this.k1[i] + 2 * this.k2[i] + 2 * this.k3[i] + this.k4[i]);
      }
      if (s[0] < 0.02) { s[0] = 0.02; s[1] = Math.abs(s[1]); } // never through the vertical
      if (s[0] > Math.PI * 0.95) { s[0] = Math.PI * 0.95; s[1] = -Math.abs(s[1]); }
      s[2] %= Math.PI * 2; s[3] %= Math.PI * 2;
      top.head = (top.head + 1) % TAIL;
      const o = top.head * 3, st = Math.sin(s[0]);
      top.tail[o] = st * Math.cos(s[2]); top.tail[o + 1] = Math.cos(s[0]); top.tail[o + 2] = st * Math.sin(s[2]);
      if (top.count < TAIL) top.count++;
    }
  }

  private syncPositions(): void {
    const pos = this.positions;
    const frames = this.tops.map((t) => {
      const th = t.s[0], ph = t.s[2], ps = t.s[3];
      const e3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      const n = [-Math.sin(ph), 0, Math.cos(ph)]; // line of nodes (horizontal)
      const e2 = [e3[1] * n[2] - e3[2] * n[1], e3[2] * n[0] - e3[0] * n[2], e3[0] * n[1] - e3[1] * n[0]];
      return { e3, n, e2, ps };
    });
    for (let p = 0; p < this.particleCount; p++) {
      const k = this.owner[p], cx = TOP_X[k], o = p * 3;
      const role = this.role[p];
      let x = 0, y = 0, z = 0;
      if (role === 0) continue; // static, placed once
      if (role === 1) {
        const f = frames[k], kind = this.u[p];
        if (kind === 0) { const d = this.v[p]; x = f.e3[0] * d; y = f.e3[1] * d; z = f.e3[2] * d; }
        else if (kind === 1) {
          const ang = this.v[p] + f.ps, r = DISC_R * this.w[p];
          const c = Math.cos(ang) * r, s = Math.sin(ang) * r;
          x = f.e3[0] * DISC_AT + f.n[0] * c + f.e2[0] * s;
          y = f.e3[1] * DISC_AT + f.n[1] * c + f.e2[1] * s;
          z = f.e3[2] * DISC_AT + f.n[2] * c + f.e2[2] * s;
        } else {
          x = f.e3[0] * AXIS_LEN + this.v[p]; y = f.e3[1] * AXIS_LEN + this.w[p]; z = f.e3[2] * AXIS_LEN + this.x3[p];
        }
      } else {
        const top = this.tops[k], age = this.u[p]; // (the constructor pre-runs a full TAIL, so every age exists)
        const a0 = age | 0, t = age - a0;
        let i0 = top.head - a0; if (i0 < 0) i0 += TAIL;
        let i1 = i0 - 1; if (i1 < 0) i1 += TAIL;
        x = (top.tail[i0 * 3] * (1 - t) + top.tail[i1 * 3] * t) * AXIS_LEN;
        y = (top.tail[i0 * 3 + 1] * (1 - t) + top.tail[i1 * 3 + 1] * t) * AXIS_LEN;
        z = (top.tail[i0 * 3 + 2] * (1 - t) + top.tail[i1 * 3 + 2] * t) * AXIS_LEN;
      }
      pos[o] = x + cx; pos[o + 1] = y + PIVOT_Y; pos[o + 2] = z;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.speed = p.speed ?? 1;
    this.grav = p.gravity ?? this.grav;
    const h = dt * this.speed;
    if (h > 0) this.advance(h);
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const parts: number[] = [];
    for (const t of this.tops) parts.push(...t.s, t.head, t.count, ...t.tail);
    return Float64Array.from(parts);
  }
  loadState(s: Float64Array): void {
    const per = 4 + 2 + TAIL * 3;
    if (s.length !== 3 * per) return;
    this.tops.forEach((t, i) => {
      const o = i * per;
      t.s.set(s.subarray(o, o + 4)); t.head = s[o + 4]; t.count = s[o + 5]; t.tail.set(s.subarray(o + 6, o + per));
    });
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [
      { id: 'root', parentId: null, label: 'three identical tops, released three ways', stateOffset: 0, stateLength: 1 },
      { id: 'waves', parentId: 'root', label: 'pushed forward → waves', stateOffset: 0, stateLength: 1 },
      { id: 'cusps', parentId: 'root', label: 'no push → cusps', stateOffset: 0, stateLength: 1 },
      { id: 'loops', parentId: 'root', label: 'pushed backward → loops', stateOffset: 0, stateLength: 1 },
    ];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const heavyTopFactory: ArchetypeFactory = {
  id: 'heavyTop',
  label: 'Heavy Top: Precession & Nutation',
  category: 'Rotation',
  kind: 'flow',
  params: [
    { key: 'spin', label: 'spin ω₃', min: 1.5, max: 8, step: 0.1, default: 3, rebuild: true },
    { key: 'tilt', label: 'release tilt θ₀', min: 0.3, max: 1.4, step: 0.01, default: 0.85, rebuild: true },
    { key: 'gravity', label: 'gravity (mgl)', min: 0.3, max: 2.5, step: 0.05, default: 1, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 160_000,
  particleCountOptions: [80_000, 160_000, 240_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new HeavyTopArchetype(config),
};

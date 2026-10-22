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
import { quatFromTo, quatToMatrix, rigidStep, Tail, type Inertia } from './rigidBody';

// Why the Racket Flips — the Dzhanibekov effect (the tennis-racket / intermediate-axis theorem). Any rigid
// body has three principal axes: the one it is easiest to spin about (smallest moment of inertia, here
// RED), the hardest (largest, BLUE) and the one in between (YELLOW). Spin a phone, a book or a racket
// about the red or the blue axis and it spins steadily. Spin it about the yellow axis and every few turns
// it flips over by 180° — in space, with nothing touching it (cosmonaut Vladimir Dzhanibekov saw a wing
// nut do it on Salyut 7 in 1985). Three identical plates spin here about their three axes; only the
// middle one flips. The sphere below shows WHY: it is the direction of the angular momentum as seen from
// the body. Conservation of momentum keeps it on the sphere and conservation of energy keeps it on an
// ellipsoid, so it can only travel along their intersections (the polhodes). Around red and blue the
// polhodes are small closed loops — stable. Around yellow they cross in an X (the separatrix, white): a
// saddle, so the slightest wobble carries the spin all the way round to the opposite side — the flip.
// Exact torque-free Euler equations + quaternion attitude (rigidBody.ts).

const PLATE: [number, number, number] = [0.6, 0.36, 0.08]; // half-extents along body axes 1, 2, 3 (render units)
const BODY_Y = 0.95; // height of the row of plates
const BODY_X = [-2.05, 0, 2.05];
const SPHERE_C: [number, number, number] = [0, -1.25, 0];
const SPHERE_R = 0.92;
const AXIS_HUE = [0.0, 0.14, 0.6]; // red, yellow, blue for body axes 1, 2, 3
const TAIL = 900;

// Display frame for the momentum sphere: the saddle (yellow, axis 2) faces the viewer so the separatrix X
// is front and centre; red (axis 1) runs left–right, blue (axis 3) up–down; a slight tilt gives depth.
function sphereFrame(): Float64Array {
  const ax = 0.32, ay = -0.38;
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Perm = [1, 0, 0, 0, 0, 1, 0, 1, 0]; // display (x, y, z) ← body (L₁, L₃, L₂)
  const mul = (A: number[], B: number[]): number[] => {
    const C = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
    return C;
  };
  return Float64Array.from(mul(Ry, mul(Rx, Perm)));
}

class RacketFlipArchetype implements Archetype {
  readonly id = 'racketFlip';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly I: Inertia;
  private readonly bodies: { s: Float64Array; L0: number; tail: Tail }[] = [];
  // point roles
  private readonly role: Uint8Array; // 0 body point, 1 sphere (static), 2 tail point
  private readonly owner: Uint8Array; // which body (0..2)
  private readonly bx: Float32Array; private readonly by: Float32Array; private readonly bz: Float32Array; // body/sphere coords
  private readonly tailK: Int32Array; // tail age index
  private readonly D = sphereFrame();
  private readonly mats = [new Float64Array(9), new Float64Array(9), new Float64Array(9)];
  private readonly tmp = new Float64Array(3);
  private spin = 1;
  private speed = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    const thick = Math.max(0.02, config.params.thickness ?? 0.08);
    const width = Math.max(thick + 0.02, config.params.width ?? 0.36);
    const [A, B, C] = [PLATE[0], Math.min(width, PLATE[0] - 0.02), Math.min(thick, width - 0.01)];
    this.I = [B * B + C * C, A * A + C * C, A * A + B * B]; // a uniform box: I₁ < I₂ < I₃
    const wobble = Math.max(1e-4, config.params.wobble ?? 0.02);
    this.readParams(config.params);

    // three plates, each spun about one principal axis plus a tiny wobble; angular momentum points up (+y)
    for (let k = 0; k < 3; k++) {
      const w = [wobble, wobble * 0.7, wobble * 0.5];
      w[k] = 1;
      const Ib = this.I;
      const Lb = [Ib[0] * w[0], Ib[1] * w[1], Ib[2] * w[2]];
      const Ln = Math.hypot(Lb[0], Lb[1], Lb[2]);
      const q = quatFromTo(Lb[0] / Ln, Lb[1] / Ln, Lb[2] / Ln, 0, 1, 0);
      const s = Float64Array.from([w[0], w[1], w[2], q[0], q[1], q[2], q[3]]);
      const tail = new Tail(TAIL);
      tail.fill(Lb[0] / Ln, Lb[1] / Ln, Lb[2] / Ln);
      this.bodies.push({ s, L0: Ln, tail });
    }

    this.role = new Uint8Array(P); this.owner = new Uint8Array(P); this.tailK = new Int32Array(P);
    this.bx = new Float32Array(P); this.by = new Float32Array(P); this.bz = new Float32Array(P);
    const col = this.colors;
    let p = 0;
    const put = (role: number, owner: number, x: number, y: number, z: number, h: number, s: number, l: number, gain = 1): void => {
      if (p >= P) return;
      this.role[p] = role; this.owner[p] = owner;
      this.bx[p] = x; this.by[p] = y; this.bz[p] = z;
      hslToRgb(h, s, l, col, p * 3);
      col[p * 3] *= gain; col[p * 3 + 1] *= gain; col[p * 3 + 2] *= gain;
      p++;
    };

    // --- the plates (body frame): edges, a faint face, and the three coloured axis rods with ball tips ---
    const perBody = Math.floor(P * 0.13);
    for (let b = 0; b < 3; b++) {
      const start = p;
      const corners: [number, number, number][] = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx * A, sy * B, sz * C]);
      const edges: [number, number][] = [];
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
        const d = corners[i].map((v, k) => Math.abs(v - corners[j][k]) > 1e-9 ? 1 : 0);
        if (d[0] + d[1] + d[2] === 1) edges.push([i, j]);
      }
      const edgePts = Math.max(2, Math.floor(perBody * 0.34 / 12));
      for (const [i, j] of edges) for (let s = 0; s < edgePts; s++) {
        const t = s / (edgePts - 1);
        const a = corners[i], c = corners[j];
        put(0, b, a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t, 0.58, 0.35, 0.62);
      }
      const facePts = Math.floor(perBody * 0.22);
      for (let s = 0; s < facePts; s++) put(0, b, (rng() * 2 - 1) * A, (rng() * 2 - 1) * B, (rng() < 0.5 ? -1 : 1) * C, 0.6, 0.7, 0.32, 0.55);
      // axis rods: red along 1, yellow along 2, blue along 3, sticking out past the plate, ball at each end
      const rodLen = [A + 0.22, B + 0.3, C + 0.38];
      for (let k = 0; k < 3; k++) {
        const rodPts = Math.max(2, Math.floor(perBody * 0.07));
        for (let s = 0; s < rodPts; s++) {
          const t = (s / (rodPts - 1)) * 2 - 1;
          const v = [0, 0, 0]; v[k] = t * rodLen[k];
          const j = [(rng() - 0.5) * 0.012, (rng() - 0.5) * 0.012, (rng() - 0.5) * 0.012];
          put(0, b, v[0] + j[0], v[1] + j[1], v[2] + j[2], AXIS_HUE[k], 0.9, 0.55, 1.1);
        }
        const ballPts = Math.floor(perBody * 0.03);
        for (const end of [-1, 1]) for (let s = 0; s < ballPts; s++) {
          const u = rng() * 2 - 1, th = rng() * 6.2831853, r = 0.045 * Math.cbrt(rng()), ss = Math.sqrt(1 - u * u) * r;
          const v = [ss * Math.cos(th), u * r, ss * Math.sin(th)]; v[k] += end * rodLen[k];
          put(0, b, v[0], v[1], v[2], AXIS_HUE[k], 0.9, 0.6, 1.35);
        }
      }
      while (p < start + perBody && p < P) put(0, b, 0, 0, 0, 0, 0, 0); // pad (black, at the centre)
    }

    // --- the momentum sphere (body frame): polhodes = sphere ∩ energy ellipsoid ---
    const a = 1 / this.I[0], bb = 1 / this.I[1], c = 1 / this.I[2]; // a > b > c
    const curveBudget = Math.floor(P * 0.42);
    const curves: { pts: [number, number, number][]; h: number; s: number; l: number; g: number }[] = [];
    const LEVELS = 6;
    for (let n = 1; n <= LEVELS; n++) {
      // loops around ±axis 1 (red): h from just above the separatrix to near the pole
      const h1 = bb + (a - bb) * Math.pow(n / (LEVELS + 0.6), 1.3);
      const r2 = Math.sqrt((a - h1) / (a - bb)), r3 = Math.sqrt((a - h1) / (a - c));
      for (const sg of [-1, 1]) {
        const pts: [number, number, number][] = [];
        for (let i = 0; i < 400; i++) {
          const t = (i / 400) * Math.PI * 2;
          const L2 = r2 * Math.cos(t), L3 = r3 * Math.sin(t);
          pts.push([sg * Math.sqrt(Math.max(0, 1 - L2 * L2 - L3 * L3)), L2, L3]);
        }
        curves.push({ pts, h: AXIS_HUE[0], s: 0.85, l: 0.5, g: 0.8 });
      }
      // loops around ±axis 3 (blue)
      const h3 = bb - (bb - c) * Math.pow(n / (LEVELS + 0.6), 1.3);
      const q1 = Math.sqrt((h3 - c) / (a - c)), q2 = Math.sqrt((h3 - c) / (bb - c));
      for (const sg of [-1, 1]) {
        const pts: [number, number, number][] = [];
        for (let i = 0; i < 400; i++) {
          const t = (i / 400) * Math.PI * 2;
          const L1 = q1 * Math.cos(t), L2 = q2 * Math.sin(t);
          pts.push([L1, L2, sg * Math.sqrt(Math.max(0, 1 - L1 * L1 - L2 * L2))]);
        }
        curves.push({ pts, h: AXIS_HUE[2], s: 0.85, l: 0.55, g: 0.8 });
      }
    }
    // the separatrix: two great circles through ±axis 2, in the planes L₃ = ±k·L₁
    const kk = Math.sqrt((a - bb) / (bb - c));
    for (const sg of [-1, 1]) {
      const n = Math.hypot(1, kk);
      const u = [1 / n, 0, (sg * kk) / n]; // unit vector in the plane, ⟂ axis 2
      const pts: [number, number, number][] = [];
      for (let i = 0; i < 600; i++) {
        const t = (i / 600) * Math.PI * 2;
        pts.push([u[0] * Math.cos(t), Math.sin(t), u[2] * Math.cos(t)]);
      }
      curves.push({ pts, h: 0.12, s: 0.25, l: 0.8, g: 1.25 });
    }
    const perCurve = Math.floor(curveBudget / curves.length);
    for (const cv of curves) {
      for (let s = 0; s < perCurve; s++) {
        const f = (s / perCurve) * cv.pts.length;
        const i0 = Math.floor(f) % cv.pts.length, i1 = (i0 + 1) % cv.pts.length, t = f - Math.floor(f);
        const P0 = cv.pts[i0], P1 = cv.pts[i1];
        put(1, 0, P0[0] + (P1[0] - P0[0]) * t, P0[1] + (P1[1] - P0[1]) * t, P0[2] + (P1[2] - P0[2]) * t, cv.h, cv.s, cv.l, cv.g);
      }
    }
    // pole stubs on the sphere in the axis colours
    const stubN = Math.max(4, Math.floor(P * 0.003));
    for (let k = 0; k < 3; k++) for (const end of [-1, 1]) for (let s = 0; s < stubN; s++) {
      const r = 1 + 0.18 * (s / (stubN - 1));
      const v = [0, 0, 0]; v[k] = end * r;
      put(1, 0, v[0] + (rng() - 0.5) * 0.02, v[1] + (rng() - 0.5) * 0.02, v[2] + (rng() - 0.5) * 0.02, AXIS_HUE[k], 0.9, 0.55, 1.2);
    }
    // --- comet tails: each plate's angular-momentum direction, newest brightest ---
    const perTail = Math.floor((P - p) / 3);
    for (let b = 0; b < 3; b++) for (let s = 0; s < perTail && p < P; s++) {
      const age = Math.floor((s / perTail) * TAIL);
      this.tailK[p] = age;
      const fade = Math.pow(1 - age / TAIL, 1.6);
      put(2, b, 0, 0, 0, AXIS_HUE[b], 0.35, 0.55 + 0.35 * fade, 0.25 + 1.6 * fade);
    }
    while (p < P) put(1, 0, 0, 0, 0, 0, 0, 0);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.spin = p.spin ?? 1;
    this.speed = p.speed ?? 1;
  }

  private syncPositions(): void {
    const pos = this.positions, D = this.D, v = this.tmp, mats = this.mats;
    this.bodies.forEach((b, i) => quatToMatrix(b.s[3], b.s[4], b.s[5], b.s[6], mats[i]));
    for (let p = 0; p < this.particleCount; p++) {
      const o = p * 3, role = this.role[p];
      let x: number, y: number, z: number;
      if (role === 0) {
        const M = mats[this.owner[p]];
        const X = this.bx[p], Y = this.by[p], Z = this.bz[p];
        x = M[0] * X + M[1] * Y + M[2] * Z + BODY_X[this.owner[p]];
        y = M[3] * X + M[4] * Y + M[5] * Z + BODY_Y;
        z = M[6] * X + M[7] * Y + M[8] * Z;
      } else {
        let X: number, Y: number, Z: number;
        if (role === 1) { X = this.bx[p]; Y = this.by[p]; Z = this.bz[p]; }
        else { this.bodies[this.owner[p]].tail.get(this.tailK[p], v); X = v[0] * 1.012; Y = v[1] * 1.012; Z = v[2] * 1.012; }
        x = (D[0] * X + D[1] * Y + D[2] * Z) * SPHERE_R + SPHERE_C[0];
        y = (D[3] * X + D[4] * Y + D[5] * Z) * SPHERE_R + SPHERE_C[1];
        z = (D[6] * X + D[7] * Y + D[8] * Z) * SPHERE_R + SPHERE_C[2];
      }
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const h = dt * this.speed * this.spin * 3.2; // 3.2 rad/s at spin 1 (time scaled by the spin rate)
    if (h > 0) {
      const sub = 6;
      for (const b of this.bodies) {
        for (let k = 0; k < sub; k++) rigidStep(b.s, this.I, h / sub, b.L0);
        const L = [this.I[0] * b.s[0], this.I[1] * b.s[1], this.I[2] * b.s[2]];
        const n = Math.hypot(L[0], L[1], L[2]) || 1;
        b.tail.push(L[0] / n, L[1] / n, L[2] / n);
      }
      this.t += h;
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const parts: number[] = [this.t];
    for (const b of this.bodies) parts.push(...b.s, ...b.tail.serialize());
    return Float64Array.from(parts);
  }
  loadState(s: Float64Array): void {
    const per = 7 + 2 + TAIL * 3;
    if (s.length !== 1 + 3 * per) return;
    this.t = s[0];
    this.bodies.forEach((b, i) => {
      const o = 1 + i * per;
      b.s.set(s.subarray(o, o + 7));
      b.tail.load(s.subarray(o + 7, o + per));
    });
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const [I1, I2, I3] = this.I;
    const lam = Math.sqrt(((I3 - I2) * (I2 - I1)) / (I1 * I3));
    return [
      { id: 'root', parentId: null, label: `I₁ : I₂ : I₃ = 1 : ${(I2 / I1).toFixed(2)} : ${(I3 / I1).toFixed(2)} · middle-axis growth rate ${lam.toFixed(2)}·ω`, stateOffset: 0, stateLength: 1 },
    ];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const racketFlipFactory: ArchetypeFactory = {
  id: 'racketFlip',
  label: 'Why the Racket Flips',
  category: 'Rotation',
  kind: 'flow',
  params: [
    { key: 'spin', label: 'spin rate', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'wobble', label: 'initial wobble', min: 0.001, max: 0.2, step: 0.001, default: 0.02, rebuild: true },
    { key: 'width', label: 'plate width', min: 0.12, max: 0.56, step: 0.01, default: 0.36, rebuild: true },
    { key: 'thickness', label: 'plate thickness', min: 0.02, max: 0.3, step: 0.01, default: 0.08, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 160_000,
  particleCountOptions: [80_000, 160_000, 240_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new RacketFlipArchetype(config),
};

// Torque-free rigid-body rotation, shared by the Rotation systems (racket flip, Poinsot).
//
// State: ω (angular velocity in the BODY frame, principal axes) and q (unit quaternion w,x,y,z taking
// body coordinates to space coordinates). Euler's equations
//   I₁ω̇₁ = (I₂ − I₃)ω₂ω₃,  I₂ω̇₂ = (I₃ − I₁)ω₃ω₁,  I₃ω̇₃ = (I₁ − I₂)ω₁ω₂
// and the attitude kinematics q̇ = ½ q ⊗ (0, ω) are integrated together with classical RK4; after each
// step q is renormalised and ω is rescaled so |L| = |Iω| stays exactly at its starting value (energy then
// drifts only at RK4's tiny O(h⁵) per-step level).

export type Inertia = [number, number, number];

function deriv(s: Float64Array, I: Inertia, out: Float64Array): void {
  const w1 = s[0], w2 = s[1], w3 = s[2], qw = s[3], qx = s[4], qy = s[5], qz = s[6];
  out[0] = ((I[1] - I[2]) / I[0]) * w2 * w3;
  out[1] = ((I[2] - I[0]) / I[1]) * w3 * w1;
  out[2] = ((I[0] - I[1]) / I[2]) * w1 * w2;
  // q̇ = ½ q ⊗ (0, ω)
  out[3] = 0.5 * (-qx * w1 - qy * w2 - qz * w3);
  out[4] = 0.5 * (qw * w1 + qy * w3 - qz * w2);
  out[5] = 0.5 * (qw * w2 + qz * w1 - qx * w3);
  out[6] = 0.5 * (qw * w3 + qx * w2 - qy * w1);
}

const k1 = new Float64Array(7), k2 = new Float64Array(7), k3 = new Float64Array(7), k4 = new Float64Array(7), tmp = new Float64Array(7);

/** Advance state s = [ω₁, ω₂, ω₃, qw, qx, qy, qz] by h, keeping |q| = 1 and |L| = L0. */
export function rigidStep(s: Float64Array, I: Inertia, h: number, L0: number): void {
  deriv(s, I, k1);
  for (let i = 0; i < 7; i++) tmp[i] = s[i] + 0.5 * h * k1[i];
  deriv(tmp, I, k2);
  for (let i = 0; i < 7; i++) tmp[i] = s[i] + 0.5 * h * k2[i];
  deriv(tmp, I, k3);
  for (let i = 0; i < 7; i++) tmp[i] = s[i] + h * k3[i];
  deriv(tmp, I, k4);
  for (let i = 0; i < 7; i++) s[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  const qn = Math.hypot(s[3], s[4], s[5], s[6]) || 1;
  for (let i = 3; i < 7; i++) s[i] /= qn;
  const L = Math.hypot(I[0] * s[0], I[1] * s[1], I[2] * s[2]) || 1;
  const k = L0 / L;
  s[0] *= k; s[1] *= k; s[2] *= k;
}

/** The body→space rotation matrix of a unit quaternion, row-major into m[0..8]. */
export function quatToMatrix(qw: number, qx: number, qy: number, qz: number, m: Float64Array): void {
  m[0] = 1 - 2 * (qy * qy + qz * qz); m[1] = 2 * (qx * qy - qw * qz); m[2] = 2 * (qx * qz + qw * qy);
  m[3] = 2 * (qx * qy + qw * qz); m[4] = 1 - 2 * (qx * qx + qz * qz); m[5] = 2 * (qy * qz - qw * qx);
  m[6] = 2 * (qx * qz - qw * qy); m[7] = 2 * (qy * qz + qw * qx); m[8] = 1 - 2 * (qx * qx + qy * qy);
}

/** The shortest-arc unit quaternion rotating unit vector a onto unit vector b. */
export function quatFromTo(ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number, number] {
  const d = ax * bx + ay * by + az * bz;
  if (d < -0.999999) {
    // opposite: rotate π about any axis perpendicular to a
    let px = 0, py = -az, pz = ay;
    if (Math.hypot(px, py, pz) < 1e-6) { px = az; py = 0; pz = -ax; }
    const n = Math.hypot(px, py, pz);
    return [0, px / n, py / n, pz / n];
  }
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  const w = 1 + d;
  const n = Math.hypot(w, cx, cy, cz);
  return [w / n, cx / n, cy / n, cz / n];
}

/** Kinetic energy ½ ω·Iω and |L| for a state (for checks). */
export function invariants(s: Float64Array, I: Inertia): { energy: number; L: number } {
  return {
    energy: 0.5 * (I[0] * s[0] * s[0] + I[1] * s[1] * s[1] + I[2] * s[2] * s[2]),
    L: Math.hypot(I[0] * s[0], I[1] * s[1], I[2] * s[2]),
  };
}

/** A fixed-capacity comet tail: push the newest sample; read back newest-first. */
export class Tail {
  readonly n: number;
  private readonly buf: Float32Array;
  private head = 0;
  private count = 0;
  constructor(n: number) { this.n = n; this.buf = new Float32Array(n * 3); }
  push(x: number, y: number, z: number): void {
    this.head = (this.head + 1) % this.n;
    const o = this.head * 3;
    this.buf[o] = x; this.buf[o + 1] = y; this.buf[o + 2] = z;
    if (this.count < this.n) this.count++;
  }
  fill(x: number, y: number, z: number): void { for (let i = 0; i < this.n; i++) this.push(x, y, z); }
  /** The k-th newest sample (k = 0 is the newest); older-than-recorded samples repeat the oldest. */
  get(k: number, out: Float64Array): void {
    const kk = Math.min(k, Math.max(0, this.count - 1));
    const o = (((this.head - kk) % this.n) + this.n) % this.n * 3;
    out[0] = this.buf[o]; out[1] = this.buf[o + 1]; out[2] = this.buf[o + 2];
  }
  serialize(): Float64Array { return Float64Array.from([this.head, this.count, ...this.buf]); }
  load(s: Float64Array): void { this.head = s[0]; this.count = s[1]; this.buf.set(s.subarray(2, 2 + this.n * 3)); }
}

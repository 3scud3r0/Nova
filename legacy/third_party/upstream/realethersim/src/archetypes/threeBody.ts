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

// Three-Body Problem — two bodies orbit forever in ellipses; add a third and there is, in general, no formula.
// Three set-ups. Lagrange points: a star and a planet circling each other, seen from a frame that turns with
// them, where the gravity of both plus the centrifugal effect makes a landscape — two deep wells, a ridge
// round the orbit, and five balance points (Euler's L1–L3 on the line, Lagrange's L4 and L5 at the tips of
// equilateral triangles). L4 and L5 are hilltops, yet small bodies stay near them, held by the Coriolis
// effect: Jupiter's Trojan asteroids. Watch "tadpole" orbits loop round L4 or L5 and "horseshoe" orbits
// creep round the ridge and turn back before the planet. Raise the mass ratio past Routh's limit (0.0385)
// and the Trojans can no longer stay. Figure-eight: three equal masses chasing each other round one curve
// (found by Moore in 1993, proved to exist by Chenciner and Montgomery in 2000). Pythagorean: masses 3, 4 and
// 5 let go from rest at the corners of a 3-4-5 triangle (Burrau 1913) — a long chaotic dance that ends with the
// lightest body thrown out and the other two bound as a pair (Szebehely and Peters 1967).

const SCENES = { 'Lagrange points': 0, 'figure-eight': 1, Pythagorean: 2 };
const GRID_SPAN = 1.45; // Lagrange landscape: x, y in ±GRID_SPAN (separation 1)
const LS = 1.45; // Lagrange render scale
const HK = 1.1; // landscape depth (render units)

class ThreeBodyArchetype implements Archetype {
  readonly id = 'threeBody';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly scene: number;
  private readonly rng: () => number;
  private speed = 1;
  private t = 0;
  // --- Lagrange (circular restricted problem, rotating frame) ---
  private readonly mu: number;
  private readonly lx = new Float64Array(5); private readonly ly = new Float64Array(5);
  private readonly uTop: number = 0; // effective potential at L4/L5 (the hilltops)
  private readonly NT: number = 0; // test particles
  private readonly ts: Float64Array = new Float64Array(0); // [x, y, vx, vy] per test particle
  // --- N-body (inertial) ---
  private readonly m = new Float64Array(3);
  private readonly s = new Float64Array(12); // x1 y1 x2 y2 x3 y3 vx1 vy1 …
  private readonly s0 = new Float64Array(12);
  private hAd = 1e-3; // adaptive step
  tol = 1e-11; // Dormand–Prince error tolerance per step
  private escapedAt = -1; // time a body left for good (Pythagorean)
  private escaper = -1; // …and which one
  private loops = 0;
  // --- drawing ---
  private readonly trailOf: number; // number of trailed objects
  private readonly TL: number;
  private readonly trail: Float32Array; private head = 0;
  private readonly sampleDt: number; private sampleAcc = 0;
  private readonly blob0: number; private readonly blobPer: number; private readonly blob: Float32Array;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    this.rng = mulberry32(config.seed);
    this.scene = Math.round(config.params.scene ?? 0);
    this.mu = Math.min(0.1, Math.max(0.0005, config.params.mu ?? 0.01));
    this.readParams(config.params);
    const col = this.colors, pos = this.positions;
    let p = 0;

    if (this.scene === 0) {
      this.findLagrangePoints();
      this.uTop = -this.omega(this.lx[3], this.ly[3]);
      // the effective-potential landscape: a grid lifted to height U = −Ω, coloured by height, with the
      // zero-velocity contours through L1, L2, L3 picked out
      const G = Math.floor(Math.sqrt(P * 0.5));
      const levels = [0, 1, 2].map((k) => -this.omega(this.lx[k], this.ly[k]));
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++, p++) {
        const x = (i / (G - 1) * 2 - 1) * GRID_SPAN, y = (j / (G - 1) * 2 - 1) * GRID_SPAN;
        const U = -this.omega(x, y), h = this.height(U);
        pos[p * 3] = x * LS; pos[p * 3 + 1] = h; pos[p * 3 + 2] = y * LS;
        const f = Math.min(1, Math.max(0, -h / HK)); // 0 at the hilltops, 1 deep in the wells
        let near = 0;
        for (const lv of levels) near = Math.max(near, Math.exp(-(((U - lv) / 0.004) ** 2)));
        hslToRgb(0.62 - 0.5 * f, 0.6, 0.18 + 0.12 * (1 - f) + 0.35 * near, col, p * 3);
        if (near < 0.3) for (let c = 0; c < 3; c++) col[p * 3 + c] *= 0.6;
      }
      // the test particles
      this.NT = 48;
      this.ts = new Float64Array(this.NT * 4);
      for (let k = 0; k < this.NT; k++) this.spawnTest(k, k);
    } else {
      if (this.scene === 1) {
        this.m.set([1, 1, 1]);
        this.s0.set([-0.97000436, 0.24308753, 0.97000436, -0.24308753, 0, 0,
          0.4662036850, 0.4323657300, 0.4662036850, 0.4323657300, -0.93240737, -0.86473146]);
      } else {
        this.m.set([3, 4, 5]);
        this.s0.set([1, 3, -2, -1, 1, -1, 0, 0, 0, 0, 0, 0]);
      }
      this.s.set(this.s0);
    }

    // trails: test particles (Lagrange) or the three bodies
    this.trailOf = this.scene === 0 ? this.NT : 3;
    const markerBudget = this.scene === 0 ? Math.floor(P * 0.02) : Math.floor(P * 0.03);
    this.TL = Math.max(8, Math.floor((P - p - markerBudget) / this.trailOf));
    this.sampleDt = this.scene === 0 ? 0.06 : this.scene === 1 ? 6.3259 / this.TL * 1.02 : 18 / this.TL;
    this.trail = new Float32Array(this.TL * this.trailOf * 3);
    const trail0 = p;
    const HUES3 = this.scene === 1 ? [0.55, 0.1, 0.9] : [0.55, 0.12, 0.95]; // Pythagorean: m=3 cyan, 4 gold, 5 rose
    for (let s = 0; s < this.TL; s++) for (let k = 0; k < this.trailOf; k++, p++) {
      const fade = 1 - s / this.TL;
      const h = this.scene === 0 ? (k % 2 ? 0.12 : 0.08) : HUES3[k];
      hslToRgb(h, 0.85, 0.3 + 0.4 * fade, col, p * 3);
      for (let c = 0; c < 3; c++) col[p * 3 + c] *= this.scene === 0 ? 0.12 + 0.48 * fade : 0.15 + 0.95 * fade * fade;
    }
    void trail0;
    // markers: the bodies (and for Lagrange the five L-points)
    this.blob0 = p;
    const nBlobs = this.scene === 0 ? 7 : 3;
    this.blobPer = Math.max(4, Math.floor((P - p) / nBlobs));
    this.blob = new Float32Array(this.blobPer * 3);
    for (let q = 0; q < this.blobPer; q++) {
      const u = this.rng() * 2 - 1, a = this.rng() * Math.PI * 2, r = Math.cbrt(this.rng()), w = Math.sqrt(1 - u * u) * r;
      this.blob[q * 3] = w * Math.cos(a); this.blob[q * 3 + 1] = u * r; this.blob[q * 3 + 2] = w * Math.sin(a);
    }
    for (let b = 0; b < nBlobs; b++) for (let q = 0; q < this.blobPer && p < P; q++, p++) {
      if (this.scene === 0) hslToRgb(b === 0 ? 0.12 : b === 1 ? 0.58 : 0.95, b < 2 ? 0.9 : 0.4, b < 2 ? 0.6 : 0.8, col, p * 3);
      else hslToRgb(HUES3[b], 0.6, 0.8, col, p * 3);
    }
    for (; p < P; p++) { col[p * 3] = col[p * 3 + 1] = col[p * 3 + 2] = 0; }

    // run until the trails are full, so it opens drawn
    const sp = this.speed; this.speed = 1;
    const warm = Math.ceil((this.TL * this.sampleDt) / this.frameTime(0.016)) + 2;
    for (let k = 0; k < warm; k++) this.advance(0.016);
    this.speed = sp;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }
  private frameTime(dt: number): number { return dt * this.speed * (this.scene === 0 ? 2.5 : this.scene === 1 ? 0.8 : 1.6); }

  // ---------------- Lagrange: the circular restricted three-body problem (rotating frame, ω = 1) ----------------
  /** Ω = (x² + y²)/2 + (1 − μ)/r₁ + μ/r₂, star at (−μ, 0), planet at (1 − μ, 0). */
  private omega(x: number, y: number): number {
    const mu = this.mu, r1 = Math.hypot(x + mu, y), r2 = Math.hypot(x - 1 + mu, y);
    return (x * x + y * y) / 2 + (1 - mu) / Math.max(r1, 1e-3) + mu / Math.max(r2, 1e-3);
  }
  private height(U: number): number {
    // hilltops (L4/L5) at 0, falling away below them; the depth saturates (d/(d + 0.12)) so the wells and the
    // centrifugal fall-off outside the orbit stay in view while the shape near the L-points is kept
    const d = Math.max(0, this.uTop - U);
    return -HK * (d / (d + 0.12));
  }
  private findLagrangePoints(): void {
    const mu = this.mu;
    const fx = (x: number): number => { // ∂Ω/∂x on the x axis
      const r1 = x + mu, r2 = x - 1 + mu;
      return x - ((1 - mu) * r1) / Math.abs(r1) ** 3 - (mu * r2) / Math.abs(r2) ** 3;
    };
    const bisect = (a: number, b: number): number => {
      let fa = fx(a);
      for (let k = 0; k < 200; k++) { const m = (a + b) / 2, fm = fx(m); if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m; }
      return (a + b) / 2;
    };
    this.lx[0] = bisect(-mu + 1e-6, 1 - mu - 1e-6); // L1, between the two
    this.lx[1] = bisect(1 - mu + 1e-6, 2.5); // L2, beyond the planet
    this.lx[2] = bisect(-2.5, -mu - 1e-6); // L3, opposite the planet
    this.lx[3] = 0.5 - mu; this.ly[3] = Math.sqrt(3) / 2; // L4 (leading)
    this.lx[4] = 0.5 - mu; this.ly[4] = -Math.sqrt(3) / 2; // L5 (trailing)
  }
  private deriv(x: number, y: number, vx: number, vy: number, out: Float64Array): void {
    const mu = this.mu, dx1 = x + mu, dx2 = x - 1 + mu;
    const r1 = Math.hypot(dx1, y), r2 = Math.hypot(dx2, y), r13 = r1 * r1 * r1, r23 = r2 * r2 * r2;
    out[0] = vx; out[1] = vy;
    out[2] = 2 * vy + x - ((1 - mu) * dx1) / r13 - (mu * dx2) / r23;
    out[3] = -2 * vx + y - ((1 - mu) * y) / r13 - (mu * y) / r23;
  }
  private spawnTest(k: number, slot: number): void {
    const rng = this.rng, o = k * 4;
    // a near-circular orbit at radius 1 + δ, started at angle θ from the planet; small δ near ±60° → tadpoles,
    // others → horseshoes or passing orbits
    let th: number;
    const kind = slot % 4;
    if (kind < 2) th = (kind === 0 ? 1 : -1) * (Math.PI / 3 + (rng() - 0.5) * 0.5);
    else th = (0.45 + rng() * (Math.PI * 2 - 0.9)) * (rng() < 0.5 ? 1 : -1);
    const d = (rng() - 0.5) * (kind < 2 ? 0.02 : 0.03), r = 1 + d;
    const x = r * Math.cos(th) - this.mu * 0, y = r * Math.sin(th);
    const vt = 1 / Math.sqrt(r) - r; // inertial Kepler speed minus the frame's rotation
    this.ts[o] = x; this.ts[o + 1] = y; this.ts[o + 2] = -vt * Math.sin(th); this.ts[o + 3] = vt * Math.cos(th);
  }
  private stepTests(T: number): void {
    const d1 = new Float64Array(4), d2 = new Float64Array(4), d3 = new Float64Array(4), d4 = new Float64Array(4);
    const n = Math.max(1, Math.ceil(T / 0.004)), h = T / n;
    for (let k = 0; k < this.NT; k++) {
      const o = k * 4, s = this.ts;
      for (let i = 0; i < n; i++) {
        const x = s[o], y = s[o + 1], vx = s[o + 2], vy = s[o + 3];
        this.deriv(x, y, vx, vy, d1);
        this.deriv(x + h / 2 * d1[0], y + h / 2 * d1[1], vx + h / 2 * d1[2], vy + h / 2 * d1[3], d2);
        this.deriv(x + h / 2 * d2[0], y + h / 2 * d2[1], vx + h / 2 * d2[2], vy + h / 2 * d2[3], d3);
        this.deriv(x + h * d3[0], y + h * d3[1], vx + h * d3[2], vy + h * d3[3], d4);
        s[o] += (h / 6) * (d1[0] + 2 * d2[0] + 2 * d3[0] + d4[0]);
        s[o + 1] += (h / 6) * (d1[1] + 2 * d2[1] + 2 * d3[1] + d4[1]);
        s[o + 2] += (h / 6) * (d1[2] + 2 * d2[2] + 2 * d3[2] + d4[2]);
        s[o + 3] += (h / 6) * (d1[3] + 2 * d2[3] + 2 * d3[3] + d4[3]);
      }
      const r2 = Math.hypot(s[o] - 1 + this.mu, s[o + 1]), r = Math.hypot(s[o], s[o + 1]);
      if (r2 < 0.04 || r > GRID_SPAN * 1.2 || r < 0.3) this.spawnTest(k, k); // a close pass, or flung out: a fresh one
    }
  }

  // ---------------- N-body (inertial), adaptive Dormand–Prince 5(4) ----------------
  private nbDeriv(s: Float64Array, out: Float64Array): void {
    const m = this.m;
    out[0] = s[6]; out[1] = s[7]; out[2] = s[8]; out[3] = s[9]; out[4] = s[10]; out[5] = s[11];
    out[6] = out[7] = out[8] = out[9] = out[10] = out[11] = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const dx = s[2 * j] - s[2 * i], dy = s[2 * j + 1] - s[2 * i + 1], r2 = dx * dx + dy * dy, inv = 1 / (r2 * Math.sqrt(r2));
      out[6 + 2 * i] += m[j] * dx * inv; out[7 + 2 * i] += m[j] * dy * inv;
      out[6 + 2 * j] -= m[i] * dx * inv; out[7 + 2 * j] -= m[i] * dy * inv;
    }
  }
  private readonly k = Array.from({ length: 7 }, () => new Float64Array(12));
  private readonly tmp = new Float64Array(12); private readonly y5 = new Float64Array(12);
  /** Integrate the three bodies forward by exactly T with adaptive Dormand–Prince steps. */
  private stepBodies(T: number): void {
    const A = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
      [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]];
    const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
    const B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];
    const tol = this.tol, s = this.s, k = this.k, tmp = this.tmp, y5 = this.y5;
    let left = T;
    while (left > 1e-14) {
      const h = Math.min(this.hAd, left);
      this.nbDeriv(s, k[0]);
      for (let st = 1; st < 7; st++) {
        for (let i = 0; i < 12; i++) { let acc = s[i]; for (let j = 0; j < st; j++) acc += h * A[st][j] * k[j][i]; tmp[i] = acc; }
        this.nbDeriv(tmp, k[st]);
      }
      let err = 0;
      for (let i = 0; i < 12; i++) {
        let a5 = 0, a4 = 0;
        for (let j = 0; j < 7; j++) { a5 += B5[j] * k[j][i]; a4 += B4[j] * k[j][i]; }
        y5[i] = s[i] + h * a5;
        err = Math.max(err, Math.abs(h * (a5 - a4)) / (1 + Math.abs(s[i])));
      }
      if (err <= tol || h < 1e-9) {
        s.set(y5); left -= h;
        this.hAd = Math.min(0.05, h * Math.min(4, 0.9 * Math.pow(tol / Math.max(err, 1e-30), 0.2)));
      } else this.hAd = h * Math.max(0.1, 0.9 * Math.pow(tol / err, 0.2));
    }
  }

  private advance(dt: number): void {
    const T = this.frameTime(dt);
    if (T <= 0) return;
    // integrate in sample-sized pieces so the trail is drawn at a steady rate
    let left = T;
    while (left > 1e-12) {
      const h = Math.min(left, this.sampleDt - this.sampleAcc);
      if (this.scene === 0) this.stepTests(h); else this.stepBodies(h);
      this.t += h; this.sampleAcc += h; left -= h;
      if (this.sampleAcc >= this.sampleDt - 1e-12) { this.sampleAcc = 0; this.record(); }
    }
    if (this.scene === 2) {
      // a body has left for good when its energy relative to the other two (as one mass) is positive
      if (this.escapedAt < 0) for (let i = 0; i < 3; i++) if (this.relativeEnergy(i) > 0) { this.escapedAt = this.t; this.escaper = i; }
      let far = 0;
      for (let i = 0; i < 3; i++) far = Math.max(far, Math.hypot(this.s[2 * i], this.s[2 * i + 1]));
      if (this.escapedAt >= 0 && far > 6.5) { this.s.set(this.s0); this.t = 0; this.hAd = 1e-3; this.loops++; this.escapedAt = -1; } // start the dance again
    }
  }

  private record(): void {
    this.head = (this.head + 1) % this.TL;
    const base = this.head * this.trailOf * 3, tr = this.trail;
    for (let k = 0; k < this.trailOf; k++) {
      const q = base + k * 3;
      if (this.scene === 0) {
        const x = this.ts[k * 4], y = this.ts[k * 4 + 1];
        tr[q] = x * LS; tr[q + 1] = this.height(-this.omega(x, y)) + 0.03; tr[q + 2] = y * LS;
      } else {
        const sc = this.scene === 1 ? 1.6 : 0.62;
        tr[q] = this.s[2 * k] * sc; tr[q + 1] = 0; tr[q + 2] = this.s[2 * k + 1] * sc;
      }
    }
  }

  private syncPositions(): void {
    const pos = this.positions, n3 = this.trailOf * 3;
    const trail0 = this.scene === 0 ? Math.floor(Math.sqrt(this.particleCount * 0.5)) ** 2 : 0;
    for (let s = 0; s < this.TL; s++) {
      const src = ((this.head - s + this.TL) % this.TL) * n3, dst = (trail0 + s * this.trailOf) * 3;
      for (let k = 0; k < n3; k++) pos[dst + k] = this.trail[src + k];
    }
    const put = (b: number, x: number, y: number, z: number, r: number): void => {
      for (let q = 0; q < this.blobPer; q++) {
        const o = (this.blob0 + b * this.blobPer + q) * 3;
        if (o + 2 >= pos.length) return;
        pos[o] = x + this.blob[q * 3] * r; pos[o + 1] = y + this.blob[q * 3 + 1] * r; pos[o + 2] = z + this.blob[q * 3 + 2] * r;
      }
    };
    if (this.scene === 0) {
      const mu = this.mu;
      put(0, -mu * LS, 0.05, 0, 0.09); // the star
      put(1, (1 - mu) * LS, 0.05, 0, 0.03 + 0.25 * Math.cbrt(mu)); // the planet
      for (let l = 0; l < 5; l++) put(2 + l, this.lx[l] * LS, this.height(-this.omega(this.lx[l], this.ly[l])) + 0.04, this.ly[l] * LS, 0.025);
    } else {
      const sc = this.scene === 1 ? 1.6 : 0.62;
      for (let b = 0; b < 3; b++) put(b, this.s[2 * b] * sc, 0, this.s[2 * b + 1] * sc, 0.025 * Math.cbrt(this.m[b]) * (this.scene === 1 ? 1.6 : 1.4));
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
    const extra = this.scene === 0 ? this.ts : this.s;
    const out = new Float64Array(1 + extra.length);
    out[0] = this.t; out.set(extra, 1);
    return out;
  }
  loadState(s: Float64Array): void {
    const extra = this.scene === 0 ? this.ts : this.s;
    if (s.length !== 1 + extra.length) return;
    this.t = s[0]; extra.set(s.subarray(1));
    this.syncPositions();
  }
  /** Energy of body i relative to the other two treated as one mass at their centre: > 0 (with the two bound
   *  to each other, and well apart) means it is leaving for good; otherwise −1. */
  relativeEnergy(i: number): number {
    const j = (i + 1) % 3, k = (i + 2) % 3, m = this.m, s = this.s, Mb = m[j] + m[k];
    const cx = (m[j] * s[2 * j] + m[k] * s[2 * k]) / Mb, cy = (m[j] * s[2 * j + 1] + m[k] * s[2 * k + 1]) / Mb;
    const vx = (m[j] * s[6 + 2 * j] + m[k] * s[6 + 2 * k]) / Mb, vy = (m[j] * s[7 + 2 * j] + m[k] * s[7 + 2 * k]) / Mb;
    const d = Math.hypot(s[2 * i] - cx, s[2 * i + 1] - cy);
    if (d < 3) return -1; // still in the tangle
    // only meaningful once the other two are a bound pair
    const px = s[2 * k] - s[2 * j], py = s[2 * k + 1] - s[2 * j + 1], pvx = s[6 + 2 * k] - s[6 + 2 * j], pvy = s[7 + 2 * k] - s[7 + 2 * j];
    if (0.5 * (pvx * pvx + pvy * pvy) - Mb / Math.hypot(px, py) >= 0) return -1;
    const v2 = (s[6 + 2 * i] - vx) ** 2 + (s[7 + 2 * i] - vy) ** 2, red = (m[i] * Mb) / (m[i] + Mb);
    return 0.5 * red * v2 - (m[i] * Mb) / d;
  }

  /** Total energy of the three bodies (for the panel, and for checking the integrator). */
  energy(): number {
    const s = this.s, m = this.m;
    let e = 0;
    for (let i = 0; i < 3; i++) e += 0.5 * m[i] * (s[6 + 2 * i] ** 2 + s[7 + 2 * i] ** 2);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) e -= (m[i] * m[j]) / Math.hypot(s[2 * j] - s[2 * i], s[2 * j + 1] - s[2 * i + 1]);
    return e;
  }
  getHierarchy(): NodeSpec[] {
    let label: string;
    if (this.scene === 0) {
      const routh = 0.5 * (1 - Math.sqrt(23 / 27));
      label = `mass ratio μ = ${this.mu.toFixed(4)} (Jupiter/Sun ≈ 0.00095) · L1 at ${this.lx[0].toFixed(3)}, L2 at ${this.lx[1].toFixed(3)}, L3 at ${this.lx[2].toFixed(3)} (separation 1) · L4/L5 ${this.mu < routh ? 'stable' : 'UNSTABLE'} (Routh: μ < ${routh.toFixed(4)})`;
    } else if (this.scene === 1) label = `figure-eight: three equal masses, one curve, period 6.326 · energy ${this.energy().toFixed(6)}`;
    else label = `Pythagorean 3-4-5: t = ${this.t.toFixed(1)}${this.escapedAt >= 0 ? ` · mass ${this.m[this.escaper]} escaped at t ≈ ${this.escapedAt.toFixed(1)}, leaving ${[0, 1, 2].filter((i) => i !== this.escaper).map((i) => this.m[i]).join(' + ')} as a binary` : ''} · energy ${this.energy().toFixed(6)} (exact −769/60 = ${(-769 / 60).toFixed(6)}) · run ${this.loops + 1}`;
    return [{ id: 'root', parentId: null, label, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const threeBodyFactory: ArchetypeFactory = {
  id: 'threeBody',
  label: 'Three-Body Problem',
  category: 'Orbital',
  kind: 'flow',
  params: [
    { key: 'scene', label: 'set-up', min: 0, max: 2, step: 1, default: 0, options: SCENES, rebuild: true },
    { key: 'mu', label: 'mass ratio μ (Lagrange)', min: 0.001, max: 0.06, step: 0.001, default: 0.01, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 150_000,
  particleCountOptions: [80_000, 150_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new ThreeBodyArchetype(config),
};

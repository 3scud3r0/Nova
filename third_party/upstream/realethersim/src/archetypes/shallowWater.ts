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

// Shallow Water (Dam Break) — water whose depth is small compared with its waves' length, which covers
// tsunamis, tides, floods and the water in your bath. The shallow-water equations say the water's depth h and
// velocity (u, v) change as the water is pushed downhill by gravity, and they allow sharp steps — bores — to
// form and travel, like a breaking dam's flood front or a tidal bore up a river. Three set-ups in a tank with
// walls. Dam break: a dam across the tank fails; a smooth rarefaction runs back into the reservoir while a bore
// races forward, then both slosh off the walls. (Before it reaches a wall, the flood matches Stoker's exact
// 1957 solution.) Past pillars: the same flood hits two square pillars and wraps round them in bow waves.
// Drop in a pond: a column of water collapses into a ring wave. The surface is drawn as relief with a faint
// grid on it so its shape reads; the scene starts again every so often.

const SCENES = { 'dam break': 0, 'past pillars': 1, 'drop in a pond': 2 };
const SPAN = 1.6; // tank half-width (render units)
const G = 1; // gravity
const H0 = 1; // reservoir depth
const HS = 0.55; // render height per unit depth
const RESET = 9; // seconds of simulated time before the scene restarts

class ShallowWaterArchetype implements Archetype {
  readonly id = 'shallowWater';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  readonly W: number; readonly dx: number;
  private h: Float64Array; private hu: Float64Array; private hv: Float64Array;
  private readonly h1: Float64Array; private readonly hu1: Float64Array; private readonly hv1: Float64Array; // RK2 stage
  private readonly dh: Float64Array; private readonly dhu: Float64Array; private readonly dhv: Float64Array; // residuals
  readonly solid: Uint8Array;
  private readonly scene: number;
  readonly hRight: number;
  private speed = 1;
  t = 0;
  private readonly wall0: number;
  private readonly jit: Float32Array; // a fixed sub-cell offset per point (a regular grid of points moirés)

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    this.scene = Math.round(config.params.scene ?? 0);
    this.hRight = config.params.ratio ?? 0.2;
    this.readParams(config.params);
    const W = Math.max(48, Math.floor(Math.sqrt(P * 0.9)));
    this.W = W; this.dx = (2 * SPAN) / W;
    const N = W * W;
    this.h = new Float64Array(N); this.hu = new Float64Array(N); this.hv = new Float64Array(N);
    this.h1 = new Float64Array(N); this.hu1 = new Float64Array(N); this.hv1 = new Float64Array(N);
    this.dh = new Float64Array(N); this.dhu = new Float64Array(N); this.dhv = new Float64Array(N);
    this.solid = new Uint8Array(N);
    this.U = new Float64Array(N); this.V = new Float64Array(N);
    if (this.scene === 1) { // two square pillars downstream of the dam
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
        const x = (i + 0.5) / W, y = (j + 0.5) / W;
        if (Math.abs(x - 0.62) < 0.045 && (Math.abs(y - 0.33) < 0.045 || Math.abs(y - 0.67) < 0.045)) this.solid[j * W + i] = 1;
      }
    }
    this.reset();
    const rng = mulberry32(config.seed);
    this.jit = new Float32Array(N * 2);
    for (let k = 0; k < N; k++) { // grid-line points stay on the lattice (so the lines stay crisp); the fill is jittered
      const i = k % W, j = (k / W) | 0, onX = j % 8 === 0, onY = i % 8 === 0;
      this.jit[k * 2] = onX && !onY ? 0 : onY ? 0 : (rng() - 0.5) * 0.8 * this.dx;
      this.jit[k * 2 + 1] = onY && !onX ? 0 : onX ? 0 : (rng() - 0.5) * 0.8 * this.dx;
    }
    // colours: water blue, with a faint grid every 8 cells so the relief reads; pillars grey
    const col = this.colors;
    for (let k = 0; k < N; k++) {
      const i = k % W, j = (k / W) | 0, line = i % 8 === 0 || j % 8 === 0;
      if (this.solid[k]) hslToRgb(0.6, 0.08, 0.5, col, k * 3);
      else hslToRgb(0.55, 0.8, line ? 0.8 : 0.3, col, k * 3);
    }
    // the rest: the tank's rim and the pillars' sides
    this.wall0 = N;
    for (let p = N; p < P; p++) hslToRgb(0.6, 0.1, 0.4, col, p * 3);
    this.buildWalls();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  reset(): void {
    const W = this.W, h = this.h;
    this.hu.fill(0); this.hv.fill(0);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, x = (i + 0.5) / W, y = (j + 0.5) / W;
      if (this.solid[k]) { h[k] = 0; continue; }
      if (this.scene === 2) h[k] = this.hRight + (Math.hypot(x - 0.5, y - 0.5) < 0.12 ? H0 - this.hRight : 0);
      else h[k] = x < 0.35 ? H0 : this.hRight; // the dam stands at 35% of the tank
    }
    this.t = 0;
  }

  // HLL flux of the shallow-water equations in direction n (0 = x, 1 = y), from left/right states
  private flux(hL: number, uL: number, vL: number, hR: number, uR: number, vR: number, out: Float64Array): void {
    // u is the normal velocity, v the tangential one
    const cL = Math.sqrt(G * Math.max(hL, 0)), cR = Math.sqrt(G * Math.max(hR, 0));
    const sL = Math.min(uL - cL, uR - cR), sR = Math.max(uL + cL, uR + cR);
    const fL0 = hL * uL, fL1 = hL * uL * uL + 0.5 * G * hL * hL, fL2 = hL * uL * vL;
    const fR0 = hR * uR, fR1 = hR * uR * uR + 0.5 * G * hR * hR, fR2 = hR * uR * vR;
    if (sL >= 0) { out[0] = fL0; out[1] = fL1; out[2] = fL2; return; }
    if (sR <= 0) { out[0] = fR0; out[1] = fR1; out[2] = fR2; return; }
    const inv = 1 / (sR - sL);
    out[0] = (sR * fL0 - sL * fR0 + sL * sR * (hR - hL)) * inv;
    out[1] = (sR * fL1 - sL * fR1 + sL * sR * (hR * uR - hL * uL)) * inv;
    out[2] = (sR * fL2 - sL * fR2 + sL * sR * (hR * vR - hL * vL)) * inv;
  }

  private readonly fx = new Float64Array(3);
  private readonly U: Float64Array = new Float64Array(0); private readonly V: Float64Array = new Float64Array(0); // velocities (per stage)
  /** Residual (−div F) of state (h, hu, hv) into (dh, dhu, dhv): MUSCL–minmod reconstruction of h, u, v and HLL fluxes;
   *  faces next to a pillar use the cell and its mirror image exactly (so no water leaks through). */
  private residual(h: Float64Array, hu: Float64Array, hv: Float64Array): void {
    const W = this.W, N = W * W, dh = this.dh, dhu = this.dhu, dhv = this.dhv, solid = this.solid, f = this.fx, U = this.U, V = this.V;
    for (let k = 0; k < N; k++) {
      dh[k] = 0; dhu[k] = 0; dhv[k] = 0;
      if (h[k] > 1e-6) { U[k] = hu[k] / h[k]; V[k] = hv[k] / h[k]; } else { U[k] = 0; V[k] = 0; }
    }
    const mm = (a: number, b: number): number => (a * b <= 0 ? 0 : Math.abs(a) < Math.abs(b) ? a : b);
    for (let dir = 0; dir < 2; dir++) {
      const step = dir === 0 ? 1 : W, QN = dir === 0 ? U : V, QT = dir === 0 ? V : U;
      const dN = dir === 0 ? dhu : dhv, dT = dir === 0 ? dhv : dhu;
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
        const ii = dir === 0 ? i : j;
        if (ii === W - 1) continue;
        const k = j * W + i; // the face between cell k and the next cell along this direction
        const kr = k + step, sl = solid[k], sr = solid[kr];
        if (sl && sr) continue;
        let hl: number, ul: number, vl: number, hr: number, ur: number, vr: number;
        if (sl || sr) { // a pillar face: the water cell against its own mirror image
          const c = sr ? k : kr;
          hl = hr = h[c]; vl = vr = QT[c];
          if (sr) { ul = QN[c]; ur = -QN[c]; } else { ul = -QN[c]; ur = QN[c]; }
        } else {
          const kl = ii > 0 && !solid[k - step] ? k - step : k, krr = ii + 2 < W && !solid[kr + step] ? kr + step : kr;
          hl = Math.max(0, h[k] + 0.5 * mm(h[k] - h[kl], h[kr] - h[k])); hr = Math.max(0, h[kr] - 0.5 * mm(h[kr] - h[k], h[krr] - h[kr]));
          ul = QN[k] + 0.5 * mm(QN[k] - QN[kl], QN[kr] - QN[k]); ur = QN[kr] - 0.5 * mm(QN[kr] - QN[k], QN[krr] - QN[kr]);
          vl = QT[k] + 0.5 * mm(QT[k] - QT[kl], QT[kr] - QT[k]); vr = QT[kr] - 0.5 * mm(QT[kr] - QT[k], QT[krr] - QT[kr]);
        }
        this.flux(hl, ul, vl, hr, ur, vr, f);
        if (!sl) { dh[k] -= f[0]; dN[k] -= f[1]; dT[k] -= f[2]; }
        if (!sr) { dh[kr] += f[0]; dN[kr] += f[1]; dT[kr] += f[2]; }
      }
      // tank walls: reflecting, so only the pressure term crosses (no mass)
      for (let q = 0; q < W; q++) {
        const kA = dir === 0 ? q * W : q, kB = dir === 0 ? q * W + W - 1 : (W - 1) * W + q;
        dN[kA] += 0.5 * G * h[kA] * h[kA]; dN[kB] -= 0.5 * G * h[kB] * h[kB];
      }
    }
    const sc = 1 / this.dx;
    for (let k = 0; k < N; k++) { dh[k] *= sc; dhu[k] *= sc; dhv[k] *= sc; }
  }

  /** One SSP-RK2 step; returns the time step taken (CFL 0.4). */
  advance(maxDt: number): number {
    const W = this.W, N = W * W, h = this.h, hu = this.hu, hv = this.hv;
    let smax = 1e-9;
    for (let k = 0; k < N; k++) if (h[k] > 1e-6) smax = Math.max(smax, Math.hypot(hu[k], hv[k]) / h[k] + Math.sqrt(G * h[k]));
    const dt = Math.min(maxDt, (0.4 * this.dx) / smax);
    this.residual(h, hu, hv);
    for (let k = 0; k < N; k++) { this.h1[k] = Math.max(0, h[k] + dt * this.dh[k]); this.hu1[k] = hu[k] + dt * this.dhu[k]; this.hv1[k] = hv[k] + dt * this.dhv[k]; }
    this.residual(this.h1, this.hu1, this.hv1);
    for (let k = 0; k < N; k++) {
      h[k] = Math.max(0, 0.5 * (h[k] + this.h1[k] + dt * this.dh[k]));
      hu[k] = 0.5 * (hu[k] + this.hu1[k] + dt * this.dhu[k]);
      hv[k] = 0.5 * (hv[k] + this.hv1[k] + dt * this.dhv[k]);
      if (h[k] < 1e-6) { hu[k] = 0; hv[k] = 0; }
    }
    this.t += dt;
    return dt;
  }

  private buildWalls(): void {
    const pos = this.positions, P = this.particleCount, W = this.W;
    let p = this.wall0;
    const n = P - p, rimN = Math.floor(n * 0.6);
    for (let k = 0; k < rimN && p < P; k++, p++) { // the tank rim, up to the reservoir height
      const e = k % 4, u = ((k >> 2) / (rimN / 4)) * 2 - 1, y = ((k * 7919) % 97) / 97 * H0 * HS;
      pos[p * 3] = e < 2 ? u * SPAN : (e === 2 ? -SPAN : SPAN); pos[p * 3 + 1] = y; pos[p * 3 + 2] = e < 2 ? (e === 0 ? -SPAN : SPAN) : u * SPAN;
    }
    // pillars: vertical sides
    const solids: number[] = [];
    for (let k = 0; k < W * W; k++) if (this.solid[k]) solids.push(k);
    for (let q = 0; p < P; q++, p++) {
      if (!solids.length) { pos[p * 3] = -SPAN; pos[p * 3 + 1] = 0; pos[p * 3 + 2] = -SPAN; continue; }
      const k = solids[q % solids.length], y = ((q * 31) % 53) / 53 * H0 * HS * 1.2;
      pos[p * 3] = ((k % W) + 0.5) * this.dx - SPAN; pos[p * 3 + 1] = y; pos[p * 3 + 2] = (((k / W) | 0) + 0.5) * this.dx - SPAN;
    }
  }

  private syncPositions(): void {
    const pos = this.positions, W = this.W;
    for (let k = 0; k < W * W; k++) {
      pos[k * 3] = ((k % W) + 0.5) * this.dx - SPAN + this.jit[k * 2];
      pos[k * 3 + 1] = this.solid[k] ? H0 * HS * 1.2 : this.h[k] * HS;
      pos[k * 3 + 2] = (((k / W) | 0) + 0.5) * this.dx - SPAN + this.jit[k * 2 + 1];
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    let T = dt * this.speed * 0.9;
    while (T > 1e-9) T -= this.advance(T);
    if (this.t > RESET) this.reset();
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const N = this.W * this.W, s = new Float64Array(1 + 3 * N);
    s[0] = this.t; s.set(this.h, 1); s.set(this.hu, 1 + N); s.set(this.hv, 1 + 2 * N);
    return s;
  }
  loadState(s: Float64Array): void {
    const N = this.W * this.W;
    if (s.length !== 1 + 3 * N) return;
    this.t = s[0]; this.h.set(s.subarray(1, 1 + N)); this.hu.set(s.subarray(1 + N, 1 + 2 * N)); this.hv.set(s.subarray(1 + 2 * N));
    this.syncPositions();
  }
  /** Total water volume (conserved: the walls let none out). */
  volume(): number { let v = 0; for (const x of this.h) v += x; return v * this.dx * this.dx; }
  getHierarchy(): NodeSpec[] {
    const st = stoker(H0, this.hRight);
    const label = this.scene === 2
      ? `ring wave from a collapsing column · water volume ${this.volume().toFixed(4)} (conserved) · t = ${this.t.toFixed(2)}`
      : `dam break, depths ${H0} | ${this.hRight.toFixed(2)} · Stoker: flood depth ${st.hm.toFixed(3)}, bore speed ${st.s.toFixed(3)} √(gH) · water volume ${this.volume().toFixed(4)} (conserved) · t = ${this.t.toFixed(2)}`;
    return [{ id: 'root', parentId: null, label, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

/** Stoker's exact wet-bed dam-break solution (g = 1): the middle depth hm, its speed um, and the bore speed s. */
export function stoker(hL: number, hR: number): { hm: number; um: number; s: number } {
  const cL = Math.sqrt(G * hL);
  const f = (hm: number): number => 2 * (cL - Math.sqrt(G * hm)) - (hm - hR) * Math.sqrt((G * (hm + hR)) / (2 * hm * hR));
  let a = hR, b = hL;
  for (let k = 0; k < 200; k++) { const m = (a + b) / 2; if (f(m) > 0) a = m; else b = m; }
  const hm = (a + b) / 2, um = 2 * (cL - Math.sqrt(G * hm));
  return { hm, um, s: (hm * um) / (hm - hR) };
}

/** Stoker's depth profile h(x, t) with the dam at x = 0. */
export function stokerDepth(x: number, t: number, hL: number, hR: number): number {
  const { hm, um, s } = stoker(hL, hR), cL = Math.sqrt(G * hL), cm = Math.sqrt(G * hm), xi = x / t;
  if (xi < -cL) return hL;
  if (xi < um - cm) return ((2 * cL - xi) ** 2) / (9 * G);
  if (xi < s) return hm;
  return hR;
}

export const shallowWaterFactory: ArchetypeFactory = {
  id: 'shallowWater',
  label: 'Shallow Water (Dam Break)',
  category: 'Fluid',
  kind: 'flow',
  params: [
    { key: 'scene', label: 'set-up', min: 0, max: 2, step: 1, default: 1, options: SCENES, rebuild: true },
    { key: 'ratio', label: 'downstream depth / reservoir', min: 0.05, max: 0.9, step: 0.05, default: 0.2, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 36_000,
  particleCountOptions: [20_000, 36_000, 60_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new ShallowWaterArchetype(config),
};

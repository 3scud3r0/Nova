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

// Kerr Black Hole (Frame Dragging) — a spinning black hole drags space around with it. Matter is dropped
// from rest far away with ZERO angular momentum, in eight narrow streams about the equator: with no spin it
// would fall straight in, but here each stream hooks round in the hole's sense of rotation as it nears the
// horizon. These are exact geodesics of the Kerr metric (the "rain" frames: E = 1, L = 0,
// Carter constant 0, which keep a constant latitude), drawn in ingoing Kerr coordinates so they cross the
// horizon smoothly. The orange shell is the ergosphere, the static limit: inside it nothing — not even light —
// can stand still or move against the spin. On the equator, light runs both ways round circular mirror tracks:
// outside the ergosphere the backward beam (pink) goes backwards; at its boundary it stands still; inside it
// is carried forward with the forward beam (cyan). The dim rings mark the prograde and retrograde innermost
// stable circular orbits (solid) and photon orbits (dotted).

const ROUT = 6; // rain starts here (units of M)
const SC = 0.36; // render scale per M
const NT = 1600; // table resolution in r
const TRACKS = [5, 3.2, 2.4, 1.85, 1.55]; // light tracks on the equator (units of M; inner ones clamp outside r₊)
const TAIL = 5; // M of time drawn behind each light beam
const THIN = 2; // depth-thinning exponent for the rain tracers (2 cancels the 1/r² crowding of an inflow)

class KerrDraggingArchetype implements Archetype {
  readonly id = 'kerrDragging';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private a = 0.95;
  private speed = 1;
  private T = 0;
  // rain: latitude, start longitude, phase in the steady stream
  private readonly rainN: number;
  private readonly cth: Float32Array; private readonly sth: Float32Array; private readonly phi0: Float32Array; private readonly off: Float32Array;
  private readonly cut: Float32Array; // each tracer's end radius r_cut / ROUT (below r_end = all the way in): thinned with depth so the centre doesn't glare
  private readonly cutIdx: Int32Array; // … as a table index (depends on the spin)
  // tables over r (descending from ROUT to rEnd): T0(r), T1(r) (coefficient of sin²θ), Φ(r)
  private readonly rT = new Float64Array(NT); private readonly g0 = new Float64Array(NT); private readonly g1 = new Float64Array(NT); private readonly ph = new Float64Array(NT);
  private rPlus = 1; private rEnd = 0.5;
  // static shells and rings
  private readonly shell0: number; private readonly ergoN: number; private readonly horN: number; private readonly shellDir: Float32Array;
  private readonly ring0: number; private readonly ringPer: number;
  private readonly track0: number; private readonly trackPer: number;
  private readonly beam0: number; private readonly beamPer: number;
  private trackR = new Float64Array(TRACKS.length);
  private omMax = new Float64Array(TRACKS.length); private omMin = new Float64Array(TRACKS.length);
  private builtA = NaN;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    this.readParams(config.params);
    const col = this.colors;
    let p = 0;

    // rain: matter in a thick band about the equator (where the dragging is strongest), in longitude wedges
    this.rainN = Math.floor(P * 0.7);
    this.cth = new Float32Array(this.rainN); this.sth = new Float32Array(this.rainN); this.phi0 = new Float32Array(this.rainN); this.off = new Float32Array(this.rainN); this.cut = new Float32Array(this.rainN); this.cutIdx = new Int32Array(this.rainN);
    for (let k = 0; k < this.rainN; k++, p++) {
      // eight narrow wedges of longitude, so the twist they pick up reads as spiral arms
      const c = (rng() * 2 - 1) * 0.32, f = ((Math.floor(rng() * 8) + 0.22 * rng()) / 8) * Math.PI * 2; // a thick band about the equator
      this.cth[k] = c; this.sth[k] = Math.sqrt(1 - c * c); this.phi0[k] = f; this.off[k] = rng();
      // the share of tracers that get deeper than r falls off like (r/ROUT)^THIN
      this.cut[k] = Math.pow(rng(), 1 / THIN);
      hslToRgb(0.08 + 1.2 * Math.abs(c), 0.8, 0.55, col, p * 3); // warm on the equator, cooler above and below
    }
    // ergosphere and horizon shells (Fibonacci directions; radii follow the spin)
    this.shell0 = p;
    this.ergoN = Math.floor(P * 0.06); this.horN = Math.floor(P * 0.04);
    const nS = this.ergoN + this.horN;
    this.shellDir = new Float32Array(nS * 2); // (cos θ, φ)
    for (let k = 0; k < nS; k++, p++) {
      const n = k < this.ergoN ? this.ergoN : this.horN, i = k < this.ergoN ? k : k - this.ergoN;
      this.shellDir[k * 2] = 1 - (2 * (i + 0.5)) / n; this.shellDir[k * 2 + 1] = i * 2.399963229728653;
      if (k < this.ergoN) { hslToRgb(0.07, 0.9, 0.45, col, p * 3); for (let q = 0; q < 3; q++) col[p * 3 + q] *= 0.55; }
      else { hslToRgb(0.0, 0.7, 0.3, col, p * 3); for (let q = 0; q < 3; q++) col[p * 3 + q] *= 0.5; }
    }
    // reference rings on the equator: prograde ISCO, retrograde ISCO (solid), prograde, retrograde photon orbits (dotted)
    this.ring0 = p; this.ringPer = Math.floor(P * 0.008);
    for (let r = 0; r < 4; r++) for (let k = 0; k < this.ringPer; k++, p++) {
      const dotted = r >= 2 && (k % 8) >= 4;
      hslToRgb(r % 2 === 0 ? 0.5 : 0.93, 0.6, dotted ? 0.05 : 0.45, col, p * 3);
    }
    // light tracks and their two beams
    this.track0 = p; this.trackPer = Math.floor(P * 0.01);
    for (let t = 0; t < TRACKS.length; t++) for (let k = 0; k < this.trackPer; k++, p++) hslToRgb(0.6, 0.15, 0.32, col, p * 3);
    this.beam0 = p; this.beamPer = Math.floor((P - p) / (TRACKS.length * 2));
    for (let t = 0; t < TRACKS.length; t++) for (let b = 0; b < 2; b++) for (let k = 0; k < this.beamPer; k++, p++) {
      const fade = 1 - k / this.beamPer;
      hslToRgb(b === 0 ? 0.5 : 0.93, 0.85, 0.35 + 0.4 * fade * fade, col, p * 3);
    }
    for (; p < P; p++) hslToRgb(0, 0, 0, col, p * 3); // a remainder of a few points, black

    this.build();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.a = Math.min(0.998, Math.max(0, p.a ?? 0.95));
    this.speed = p.speed ?? 1;
  }

  // Tables for the rain (M = 1). With X = r² + a², β = √(2r/X), S = √(2rX):
  //   dφ̃/dr = a / (X(1+β))                               (the same at every latitude)
  //   dT/dr  = [a² sin²θ − X(1+β+β²)/(1+β)] / S           (T = ingoing Kerr–Schild time)
  // both finite through the horizon.
  private build(): void {
    const a = this.a;
    this.builtA = a;
    this.rPlus = 1 + Math.sqrt(1 - a * a);
    this.rEnd = 0.8 * this.rPlus;
    const { rT, g0, g1, ph } = this;
    for (let k = 0; k < NT; k++) rT[k] = ROUT - (ROUT - this.rEnd) * (k / (NT - 1));
    g0[0] = 0; g1[0] = 0; ph[0] = 0;
    const f = (r: number): [number, number, number] => {
      const X = r * r + a * a, b = Math.sqrt((2 * r) / X), S = Math.sqrt(2 * r * X);
      return [(-X * (1 + b + b * b)) / (1 + b) / S, (a * a) / S, a / (X * (1 + b))];
    };
    for (let k = 1; k < NT; k++) { // Simpson on each interval (dr < 0)
      const r0 = rT[k - 1], r1 = rT[k], rm = (r0 + r1) / 2, h = r1 - r0;
      const A = f(r0), B = f(rm), C = f(r1);
      g0[k] = g0[k - 1] + (h / 6) * (A[0] + 4 * B[0] + C[0]);
      g1[k] = g1[k - 1] + (h / 6) * (A[1] + 4 * B[1] + C[1]);
      ph[k] = ph[k - 1] + (h / 6) * (A[2] + 4 * B[2] + C[2]);
    }
    for (let k = 0; k < this.rainN; k++) {
      const rc = Math.max(this.rEnd, ROUT * this.cut[k]);
      this.cutIdx[k] = Math.max(8, Math.round(((ROUT - rc) / (ROUT - this.rEnd)) * (NT - 1)));
    }
    // the equatorial light tracks: Ω± = [−g_tφ ± √(g_tφ² − g_tt g_φφ)] / g_φφ
    for (let t = 0; t < TRACKS.length; t++) {
      const r = Math.max(TRACKS[t], this.rPlus + 0.12 + 0.05 * t);
      this.trackR[t] = r;
      const gtt = -(1 - 2 / r), gtp = -(2 * a) / r, gpp = r * r + a * a + (2 * a * a) / r;
      const d = Math.sqrt(gtp * gtp - gtt * gpp);
      this.omMax[t] = (-gtp + d) / gpp; this.omMin[t] = (-gtp - d) / gpp;
    }
  }

  /** Bardeen–Press–Teukolsky ISCO (prograde: sign −1 inside, i.e. pro = true). */
  private isco(pro: boolean): number {
    const a = this.a, z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a)), z2 = Math.sqrt(3 * a * a + z1 * z1);
    return 3 + z2 + (pro ? -1 : 1) * Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  }
  private photonOrbit(pro: boolean): number {
    return 2 * (1 + Math.cos((2 / 3) * Math.acos(pro ? -this.a : this.a)));
  }

  /** Ingoing Kerr–Schild Cartesian (x, y, z) with the spin axis up → render (x, z, y). */
  private put(o: number, r: number, cth: number, sth: number, phi: number): void {
    const c = Math.cos(phi), s = Math.sin(phi), pos = this.positions;
    pos[o] = (r * c - this.a * s) * sth * SC;
    pos[o + 1] = r * cth * SC;
    pos[o + 2] = (r * s + this.a * c) * sth * SC;
  }

  private syncPositions(): void {
    const { rT, g0, g1, ph } = this;
    for (let k = 0; k < this.rainN; k++) {
      const s2 = this.sth[k] * this.sth[k];
      // this tracer's path ends at its own radius (table index kc)
      const kc = this.cutIdx[k];
      const fall = -(g0[kc] + s2 * g1[kc]); // time to fall from ROUT to its end at this latitude
      let age = (this.T + this.off[k] * fall) % fall; if (age < 0) age += fall;
      // find the table index where elapsed time −(g0 + s² g1) = age (monotone)
      let lo = 0, hi = kc;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (-(g0[m] + s2 * g1[m]) < age) lo = m; else hi = m; }
      const e0 = -(g0[lo] + s2 * g1[lo]), e1 = -(g0[hi] + s2 * g1[hi]), u = e1 > e0 ? (age - e0) / (e1 - e0) : 0;
      const r = rT[lo] + (rT[hi] - rT[lo]) * u, phi = this.phi0[k] + ph[lo] + (ph[hi] - ph[lo]) * u;
      this.put(k * 3, r, this.cth[k], this.sth[k], phi);
    }
    // shells: ergosphere r_E(θ) = 1 + √(1 − a² cos²θ), horizon r₊
    const a = this.a;
    for (let k = 0; k < this.ergoN + this.horN; k++) {
      const c = this.shellDir[k * 2], f = this.shellDir[k * 2 + 1], sn = Math.sqrt(1 - c * c);
      const r = k < this.ergoN ? 1 + Math.sqrt(1 - a * a * c * c) : this.rPlus;
      this.put((this.shell0 + k) * 3, r, c, sn, f);
    }
    const rings = [this.isco(true), this.isco(false), this.photonOrbit(true), this.photonOrbit(false)];
    for (let r = 0; r < 4; r++) for (let k = 0; k < this.ringPer; k++) {
      this.put((this.ring0 + r * this.ringPer + k) * 3, rings[r], 0, 1, (k / this.ringPer) * Math.PI * 2);
      this.positions[(this.ring0 + r * this.ringPer + k) * 3 + 1] = -0.002;
    }
    for (let t = 0; t < TRACKS.length; t++) {
      const r = this.trackR[t];
      for (let k = 0; k < this.trackPer; k++) this.put((this.track0 + t * this.trackPer + k) * 3, r, 0, 1, (k / this.trackPer) * Math.PI * 2);
      for (let b = 0; b < 2; b++) {
        const om = b === 0 ? this.omMax[t] : this.omMin[t];
        for (let k = 0; k < this.beamPer; k++) {
          const tt = this.T - (k / this.beamPer) * TAIL;
          this.put((this.beam0 + (t * 2 + b) * this.beamPer + k) * 3, r, 0, 1, om * tt + t * 1.3 + b * Math.PI);
          this.positions[(this.beam0 + (t * 2 + b) * this.beamPer + k) * 3 + 1] = 0.004;
        }
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    if (this.a !== this.builtA) this.build();
    const h = dt * this.speed * 4; // 4 M of coordinate time per second at speed 1
    if (h > 0) this.T += h;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.T]); }
  loadState(s: Float64Array): void {
    if (s.length !== 1) return;
    this.T = s[0];
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const a = this.a, rp = this.rPlus, omH = a / (2 * rp);
    const back = Array.from(this.omMin, (o, i) => `${this.trackR[i].toFixed(2)}M: ${o > 1e-6 ? 'forward' : o < -1e-6 ? 'backward' : 'still'}`).join(', ');
    return [{
      id: 'root', parentId: null,
      label: `spin a = ${a.toFixed(3)}M · horizon r₊ = ${rp.toFixed(3)}M turning at Ω_H = ${omH.toFixed(3)}/M · ergosphere reaches 2M on the equator · ISCO ${this.isco(true).toFixed(2)}M prograde / ${this.isco(false).toFixed(2)}M retrograde · backward light at ${back}`,
      stateOffset: 0, stateLength: 1,
    }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const kerrDraggingFactory: ArchetypeFactory = {
  id: 'kerrDragging',
  label: 'Kerr Black Hole (Frame Dragging)',
  category: 'Spacetime',
  kind: 'flow',
  params: [
    { key: 'a', label: 'spin a / M', min: 0, max: 0.998, step: 0.001, default: 0.95 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 150_000,
  particleCountOptions: [80_000, 150_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new KerrDraggingArchetype(config),
};

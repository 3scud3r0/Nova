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

// Light Cones (Causal Structure) — a spacetime diagram in 2+1 dimensions: two directions of space laid flat,
// time pointing up, c = 1, so light travels on 45° cones. Around the event E at the centre, every other
// event falls into one of three classes: inside the future cone (E could influence it — gold), inside the
// past cone (it could have influenced E — blue), or outside both, "elsewhere" (no signal can link them —
// violet). The diagram is redrawn in a frame that moves along x at a velocity that sweeps back and forth: a
// Lorentz boost, which slides every event along a hyperbola t² − x² = const. Events stream along those
// hyperbolae, the moving observers' time axes and the lab's "now" line scissor towards the light cone, and
// clock ticks on a worldline spread apart (time dilation) — yet the cones never move and no event ever
// changes colour: the causal order of events is the same for everyone. Only the order of "elsewhere" events
// is up for grabs — event B, spacelike from E, happens after E in some frames and before it in others.

const T = 2.2; // time / space half-extent of the diagram
const RHO = 1.6; // dust: maximum interval |s| from E
const ETA = 1.25; // dust: rapidity window (boost-invariant sampling, wrapped)
const TAU = 1.4; // proper time drawn along each worldline (each way)
const DTICK = 0.2; // proper time between clock ticks

const wrap = (x: number, w: number): number => x - 2 * w * Math.floor((x + w) / (2 * w));

class LightConesArchetype implements Archetype {
  readonly id = 'lightCones';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // event dust in invariant coordinates: quadrant of the (t,x) plane, |interval| ρ in that plane, rapidity η, y
  private readonly dust0 = 0; private readonly dustN: number;
  private readonly dq: Uint8Array; private readonly drho: Float32Array; private readonly deta: Float32Array; private readonly dy: Float32Array;
  // static pieces (cones, hyperboloids, the current frame's axes) — written once
  // light pulses on the cones
  private readonly pulse0: number; private readonly pulseN: number; private readonly ringPts: number;
  // worldlines: [rest observer, moving observer, the lab's x axis] lines + ticks, and the accelerating observer
  private readonly line0: number[] = []; private readonly lineN: number;
  private readonly tick0: number; private readonly tickPer: number; private readonly ticksPerLine: number;
  private readonly rind0: number; private readonly rindN: number; private readonly rtick0: number; private readonly rticks: number;
  private readonly blob: Float32Array; private readonly blobN: number;
  // the two marked events
  private readonly ev0: number;
  private vmax = 0.8;
  private sweep = 1;
  private vManual = 0.5;
  private speed = 1;
  private t = 0;
  private phi = 0; // the current boost rapidity
  private pulse = 0; // light-pulse phase

  // B is spacelike from E, C is timelike (both given in the lab frame: t, x, y)
  private static readonly B = [0.45, 1.35, 0.2];
  private static readonly C = [1.35, 0.55, 0.35];

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    this.readParams(config.params);
    const col = this.colors, pos = this.positions;
    const s = P / 120_000;
    let p = 0;

    // --- event dust: uniform in spacetime volume near E (area ρdρdη in the (t,x) plane, uniform y)
    this.dustN = Math.floor(P * 0.52);
    this.dq = new Uint8Array(this.dustN); this.drho = new Float32Array(this.dustN); this.deta = new Float32Array(this.dustN); this.dy = new Float32Array(this.dustN);
    for (let k = 0; k < this.dustN; k++, p++) {
      const q = Math.floor(rng() * 4), rho = RHO * Math.sqrt(rng()), eta = (rng() * 2 - 1) * ETA, y = (rng() * 2 - 1) * 1.6;
      this.dq[k] = q; this.drho[k] = rho; this.deta[k] = eta; this.dy[k] = y;
      // its causal class from E, with the y direction included: s² = t² − x² − y² (boost-invariant)
      const a = rho * Math.cosh(eta), b = rho * Math.sinh(eta);
      const tt = q < 2 ? a : b, xx = q < 2 ? b : a; // q 0/1: future/past wedge; 2/3: right/left wedge
      const s2 = tt * tt - xx * xx - y * y;
      if (s2 > 0 && q === 0) hslToRgb(0.1, 0.85, 0.5 + 0.12 * rng(), col, p * 3); // future
      else if (s2 > 0 && q === 1) hslToRgb(0.58, 0.8, 0.5 + 0.12 * rng(), col, p * 3); // past
      else { hslToRgb(0.77, 0.45, 0.36, col, p * 3); for (let c = 0; c < 3; c++) col[p * 3 + c] *= 0.7; } // elsewhere
    }

    // --- static pieces: the light cone, the hyperboloids s² = ±1, the current frame's axes

    const put = (x: number, t: number, y: number, h: number, sat: number, l: number, dim = 1): void => {
      if (p >= P) return;
      pos[p * 3] = x; pos[p * 3 + 1] = t; pos[p * 3 + 2] = y;
      hslToRgb(h, sat, l, col, p * 3);
      if (dim !== 1) for (let c = 0; c < 3; c++) col[p * 3 + c] *= dim;
      p++;
    };
    const RINGS = 9, GEN = 32;
    const coneRingPts = Math.floor(900 * s), coneGenPts = Math.floor(160 * s);
    for (const sg of [1, -1]) {
      for (let r = 1; r <= RINGS; r++) {
        const tt = (r / RINGS) * T;
        for (let k = 0; k < coneRingPts * (r / RINGS); k++) { const a = (k / (coneRingPts * (r / RINGS))) * Math.PI * 2; put(tt * Math.cos(a), sg * tt, tt * Math.sin(a), 0.14, 0.6, 0.62, r === RINGS ? 1 : 0.55); }
      }
      for (let g = 0; g < GEN; g++) {
        const a = (g / GEN) * Math.PI * 2;
        for (let k = 0; k < coneGenPts; k++) { const tt = (k / coneGenPts) * T; put(tt * Math.cos(a), sg * tt, tt * Math.sin(a), 0.14, 0.5, 0.6, 0.45); }
      }
    }
    // hyperboloids t² − r² = 1 (future and past sheets, where a clock that left E reads 1) and r² − t² = 1
    const hypRing = Math.floor(260 * s);
    for (const sg of [1, -1]) for (let i = 0; i <= 8; i++) {
      const r = (i / 8) * 2.0, tt = Math.sqrt(1 + r * r);
      const n = Math.max(12, Math.floor(hypRing * (0.3 + r / 2)));
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; put(r * Math.cos(a), sg * tt, r * Math.sin(a), sg > 0 ? 0.1 : 0.58, 0.5, 0.5, 0.42); }
    }
    for (let i = -6; i <= 6; i++) {
      const tt = (i / 6) * 1.7, r = Math.sqrt(1 + tt * tt), n = Math.floor(hypRing * (0.4 + r / 2));
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; put(r * Math.cos(a), tt, r * Math.sin(a), 0.77, 0.4, 0.5, 0.35); }
    }
    // the current frame's axes: its time axis (straight up) and x axis — always square
    const axN = Math.floor(700 * s);
    for (let k = 0; k < axN; k++) { const u = (k / axN) * 2 - 1; put(0, u * T * 1.05, 0, 0, 0, 0.75, 0.6); put(u * T * 1.05, 0, 0, 0, 0, 0.75, 0.6); }

    // --- light pulses: rings running out along the future cone and in along the past cone
    this.pulse0 = p; this.ringPts = Math.floor(700 * s); this.pulseN = 8 * this.ringPts;
    for (let k = 0; k < this.pulseN && p < P; k++, p++) hslToRgb(0.15, 0.9, 0.75, col, p * 3);

    // --- worldlines through E: an observer at rest in the lab, one moving at 0.5c, and the lab's x axis (its "now")
    this.lineN = Math.floor(1100 * s);
    const LINE_HUE = [0.5, 0.33, 0.5];
    for (let w = 0; w < 3; w++) {
      this.line0.push(p);
      for (let k = 0; k < this.lineN && p < P; k++, p++) hslToRgb(LINE_HUE[w], 0.7, w === 2 ? 0.5 : 0.62, col, p * 3);
    }
    this.blobN = Math.max(6, Math.floor(26 * s));
    this.blob = new Float32Array(this.blobN * 3);
    for (let q = 0; q < this.blobN; q++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2, r = 0.03 * Math.cbrt(rng()), w = Math.sqrt(1 - u * u) * r;
      this.blob[q * 3] = w * Math.cos(a); this.blob[q * 3 + 1] = u * r; this.blob[q * 3 + 2] = w * Math.sin(a);
    }
    this.ticksPerLine = 2 * Math.round(TAU / DTICK) + 1;
    this.tickPer = this.blobN;
    this.tick0 = p;
    for (let w = 0; w < 2; w++) for (let k = 0; k < this.ticksPerLine * this.tickPer && p < P; k++, p++) hslToRgb(LINE_HUE[w], 0.5, 0.85, col, p * 3);
    // the uniformly accelerating observer: x² − t² = 1 (proper acceleration 1), with its ticks
    this.rind0 = p; this.rindN = Math.floor(1100 * s);
    for (let k = 0; k < this.rindN && p < P; k++, p++) hslToRgb(0.93, 0.7, 0.6, col, p * 3);
    this.rticks = 2 * Math.round(1.6 / DTICK);
    this.rtick0 = p;
    for (let k = 0; k < this.rticks * this.tickPer && p < P; k++, p++) hslToRgb(0.93, 0.5, 0.85, col, p * 3);
    // the two marked events, B (spacelike) and C (timelike)
    this.ev0 = p;
    for (let e = 0; e < 2; e++) for (let k = 0; k < this.tickPer * 4 && p < P; k++, p++) hslToRgb(e ? 0.12 : 0.97, 0.9, 0.72, col, p * 3);
    // anything left: more dust-coloured elsewhere points on the x axis' plane (rare; keeps every budget used)
    for (; p < P; p++) { pos[p * 3] = (rng() * 2 - 1) * T; pos[p * 3 + 1] = 0; pos[p * 3 + 2] = (rng() * 2 - 1) * T; hslToRgb(0.77, 0.3, 0.2, col, p * 3); }

    this.t = 0.6;
    this.phi = this.targetPhi();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.vmax = Math.min(0.95, Math.max(0, p.vmax ?? 0.8));
    this.sweep = Math.round(p.sweep ?? 1);
    this.vManual = Math.min(0.95, Math.max(-0.95, p.v ?? 0.5));
    this.speed = p.speed ?? 1;
  }

  private targetPhi(): number {
    if (this.sweep) return Math.atanh(this.vmax) * Math.sin(this.t * 0.35);
    return Math.atanh(this.vManual);
  }

  /** Lab-frame event (t, x) → the current frame (boost by rapidity φ along x). */
  private boost(t: number, x: number, out: Float64Array): void {
    const c = Math.cosh(this.phi), s = Math.sinh(this.phi);
    out[0] = t * c - x * s; out[1] = x * c - t * s;
  }

  private syncPositions(): void {
    const pos = this.positions, phi = this.phi;
    // dust: a boost shifts each event's rapidity by −φ (wrapped into the sampled window)
    for (let k = 0; k < this.dustN; k++) {
      const q = this.dq[k], rho = this.drho[k], eta = wrap(this.deta[k] - phi, ETA);
      const a = rho * Math.cosh(eta), b = rho * Math.sinh(eta);
      let tt: number, xx: number;
      if (q === 0) { tt = a; xx = b; } else if (q === 1) { tt = -a; xx = -b; } else if (q === 2) { tt = b; xx = a; } else { tt = -b; xx = -a; }
      const o = (this.dust0 + k) * 3;
      pos[o] = xx; pos[o + 1] = tt; pos[o + 2] = this.dy[k];
    }
    // light pulses: four rings out along the future cone, four in along the past cone
    for (let r = 0; r < 8; r++) {
      const ph = ((this.pulse + (r % 4) / 4) % 1), tt = r < 4 ? ph * T : -(1 - ph) * T;
      const rad = Math.abs(tt);
      for (let k = 0; k < this.ringPts; k++) {
        const a = (k / this.ringPts) * Math.PI * 2, o = (this.pulse0 + r * this.ringPts + k) * 3;
        pos[o] = rad * Math.cos(a); pos[o + 1] = tt; pos[o + 2] = rad * Math.sin(a);
      }
    }
    // worldlines: the rest observer (lab x = 0), the 0.5c observer, and the lab's x axis (lab t = 0)
    const o2 = new Float64Array(2), vB = 0.5, gB = 1 / Math.sqrt(1 - vB * vB);
    const lab = (w: number, tau: number, out: Float64Array): void => {
      if (w === 0) { out[0] = tau; out[1] = 0; }
      else if (w === 1) { out[0] = gB * tau; out[1] = gB * vB * tau; }
      else { out[0] = 0; out[1] = tau; }
    };
    const tmp = new Float64Array(2);
    for (let w = 0; w < 3; w++) {
      for (let k = 0; k < this.lineN; k++) {
        lab(w, ((k / (this.lineN - 1)) * 2 - 1) * TAU, tmp); this.boost(tmp[0], tmp[1], o2);
        const o = (this.line0[w] + k) * 3;
        pos[o] = o2[1]; pos[o + 1] = o2[0]; pos[o + 2] = 0;
      }
    }
    for (let w = 0; w < 2; w++) for (let i = 0; i < this.ticksPerLine; i++) {
      lab(w, (i - (this.ticksPerLine - 1) / 2) * DTICK, tmp); this.boost(tmp[0], tmp[1], o2);
      for (let q = 0; q < this.tickPer; q++) {
        const o = (this.tick0 + (w * this.ticksPerLine + i) * this.tickPer + q) * 3;
        pos[o] = o2[1] + this.blob[q * 3]; pos[o + 1] = o2[0] + this.blob[q * 3 + 1]; pos[o + 2] = this.blob[q * 3 + 2];
      }
    }
    // the accelerating observer: (t, x) = (sinh τ, cosh τ); a boost just slides τ along the hyperbola
    for (let k = 0; k < this.rindN; k++) {
      const e = ((k / (this.rindN - 1)) * 2 - 1) * 1.6, o = (this.rind0 + k) * 3;
      pos[o] = Math.cosh(e); pos[o + 1] = Math.sinh(e); pos[o + 2] = 0;
    }
    for (let i = 0; i < this.rticks; i++) {
      const e = wrap(i * DTICK - phi, 1.6);
      for (let q = 0; q < this.tickPer; q++) {
        const o = (this.rtick0 + i * this.tickPer + q) * 3;
        pos[o] = Math.cosh(e) + this.blob[q * 3]; pos[o + 1] = Math.sinh(e) + this.blob[q * 3 + 1]; pos[o + 2] = this.blob[q * 3 + 2];
      }
    }
    // B and C
    const evs = [LightConesArchetype.B, LightConesArchetype.C];
    for (let e = 0; e < 2; e++) {
      this.boost(evs[e][0], evs[e][1], o2);
      for (let q = 0; q < this.tickPer * 4; q++) {
        const o = (this.ev0 + e * this.tickPer * 4 + q) * 3, j = q % this.tickPer, sc = 1.2 + 0.6 * Math.floor(q / this.tickPer);
        pos[o] = o2[1] + this.blob[j * 3] * sc; pos[o + 1] = o2[0] + this.blob[j * 3 + 1] * sc; pos[o + 2] = evs[e][2] + this.blob[j * 3 + 2] * sc;
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const h = dt * this.speed;
    if (h > 0) {
      this.t += h;
      this.pulse = (this.pulse + h / T) % 1; // light: one unit of distance per unit of time
    }
    this.phi = this.targetPhi();
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t, this.pulse]); }
  loadState(s: Float64Array): void {
    if (s.length !== 2) return;
    this.t = s[0]; this.pulse = s[1];
    this.phi = this.targetPhi();
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const u = Math.tanh(this.phi), o = new Float64Array(2);
    this.boost(LightConesArchetype.B[0], LightConesArchetype.B[1], o);
    const tB = o[0];
    this.boost(LightConesArchetype.C[0], LightConesArchetype.C[1], o);
    const tC = o[0];
    const when = tB > 0.005 ? `after E (t′ = ${tB.toFixed(2)})` : tB < -0.005 ? `BEFORE E (t′ = ${tB.toFixed(2)})` : 'at the same time as E';
    return [{
      id: 'root', parentId: null,
      label: `frame moving at ${u >= 0 ? '+' : ''}${u.toFixed(2)}c along x · B (spacelike from E) happens ${when} · C (timelike) is always after E (t′ = ${tC.toFixed(2)}) · nothing changes colour: causal order is the same in every frame`,
      stateOffset: 0, stateLength: 2,
    }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const lightConesFactory: ArchetypeFactory = {
  id: 'lightCones',
  label: 'Light Cones (Causal Structure)',
  category: 'Spacetime',
  kind: 'flow',
  params: [
    { key: 'sweep', label: 'sweep the frame', min: 0, max: 1, step: 1, default: 1, options: { on: 1, off: 0 } },
    { key: 'vmax', label: 'sweep up to v / c', min: 0, max: 0.95, step: 0.01, default: 0.8 },
    { key: 'v', label: 'frame velocity v / c (sweep off)', min: -0.95, max: 0.95, step: 0.01, default: 0.5 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new LightConesArchetype(config),
};

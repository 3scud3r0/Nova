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

// Train and Platform (Special Relativity) — Einstein's train, built from light clocks. A platform and a
// train of the same rest length each carry a row of light clocks: a photon bouncing between two mirrors,
// one tick per round trip, with a dial that counts the ticks. The train runs past at speed v. Everything is
// drawn exactly as it is in the frame you pick, by Lorentz-transforming each object's world line (c = 1):
// an object at rest in a frame moving at w relative to you, at rest-frame position ξ, is at x = ξ/γ + w t,
// and its clock reads τ = t/γ − w ξ. Those two terms are the whole story — the 1/γ shortens moving things
// (length contraction) and slows moving clocks (time dilation; a moving clock's photon runs a longer
// zigzag), and the −wξ means clocks synchronised aboard the train disagree when seen from the platform
// (the relativity of simultaneity: the front of the train reads earlier). Switch to the train's frame and
// it is the platform that is short and slow. Two lightning bolts strike the train's ends at the same
// platform time; their light reaches the platform observer together but the train observer meets the front
// flash first — so in the train's frame the strikes were not simultaneous.

const L = 3.2; // rest length of the train and of the platform
const K = 7; // light clocks per row
const H = 0.5; // light-clock height (tick = 2H/c = 1 s)
const ZP = 0.5; // platform row (near side)
const ZT = -0.5; // train row (far side)
const ZOBS = 0.12; // observers stand at the inner edges, either side of the strike line z = 0
const DIAL_Y = H + 0.24;
const DIAL_R = 0.11;
const DIAL_PERIOD = 4; // seconds per turn of a dial's hand
const TRAIL = 1.0; // seconds of photon path drawn (one round trip)

// one block of points that all belong to one frame (0 platform, 1 train) and move rigidly with it
interface Block { start: number; count: number; frame: 0 | 1 }

class SpecialRelativityArchetype implements Archetype {
  readonly id = 'specialRelativity';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // rigid points: rest-frame coordinates (ξ, y, z) and their frame
  private readonly rigid: Block[] = [];
  private readonly xi: Float32Array; private readonly ry: Float32Array; private readonly rz: Float32Array;
  // light clocks: [frame][k] → photon/trail/hand blocks
  private readonly clockXi = new Float32Array(K);
  private readonly photon0: number[] = []; private readonly photonN: number;
  private readonly trail0: number[] = []; private readonly trailN: number;
  private readonly hand0: number[] = []; private readonly handN: number;
  private readonly blob: Float32Array; // photon blob offsets (x, y, z)
  // the two flashes (rear = −x, front = +x)
  private readonly flash0 = [0, 0]; private readonly flashN: number; private readonly dir: Float32Array;
  // scorch marks: [rear-platform, front-platform, rear-train, front-train]
  private readonly mark0 = [0, 0, 0, 0]; private readonly markN: number; private readonly markOff: Float32Array;
  private readonly slab0: number; private readonly slabN: number;
  // observers: [platform, train] — a body and two lamps (rear flash seen, front flash seen)
  private readonly obs0 = [0, 0]; private readonly obsN: number;
  private v = 0.6;
  private frame = 0;
  private speed = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    this.xi = new Float32Array(P); this.ry = new Float32Array(P); this.rz = new Float32Array(P);
    const rng = mulberry32(config.seed);
    this.readParams(config.params);
    const col = this.colors;
    const s = P / 100_000;
    let p = 0;
    const HUE = [0.53, 0.09]; // platform teal, train amber
    const block = (frame: 0 | 1, n: number, fill: (q: number) => [number, number, number], h: number, sat: number, l: number): void => {
      const start = p;
      for (let q = 0; q < n && p < P; q++, p++) {
        const [x, y, z] = fill(q);
        this.xi[p] = x; this.ry[p] = y; this.rz[p] = z;
        hslToRgb(h, sat, l, col, p * 3);
      }
      this.rigid.push({ start, count: p - start, frame });
    };
    for (let k = 0; k < K; k++) this.clockXi[k] = (k - (K - 1) / 2) * (L / K);

    // platform and train decks, with ruler ticks every L/10 along the inner edge
    this.slab0 = p;
    for (const f of [0, 1] as const) {
      const z0 = f === 0 ? 0.04 : -0.96, z1 = f === 0 ? 0.96 : -0.04;
      block(f, Math.floor(15000 * s), () => [(rng() - 0.5) * L, -0.04 - 0.03 * rng(), z0 + (z1 - z0) * rng()], HUE[f], 0.5, 0.2);
      const edgeZ = f === 0 ? 0.04 : -0.04;
      block(f, Math.floor(2400 * s), (q) => [((q + 0.5) / Math.floor(2400 * s) - 0.5) * L, -0.03, edgeZ], HUE[f], 0.8, 0.55);
      block(f, Math.floor(1100 * s), (q) => {
        const tick = q % 11, a = Math.floor(q / 11) / Math.max(1, Math.floor(1100 * s / 11));
        return [(tick / 10 - 0.5) * L, -0.03 + 0.1 * a, edgeZ];
      }, HUE[f], 0.85, 0.65);
    }
    this.slabN = p - this.slab0;
    // the train's carriage: roof rails and end posts
    block(1, Math.floor(3000 * s), (q) => {
      const n = Math.floor(3000 * s), half = Math.floor(n / 2);
      return [((q % half) / half - 0.5) * L, H + 0.44, q < half ? -0.96 : -0.04];
    }, HUE[1], 0.8, 0.45);
    block(1, Math.floor(1600 * s), (q) => {
      const n = Math.floor(1600 * s), e = q % 4, u = Math.floor(q / 4) / (n / 4);
      return [(e & 1 ? 0.5 : -0.5) * L, -0.03 + u * (H + 0.47), e & 2 ? -0.96 : -0.04];
    }, HUE[1], 0.8, 0.5);

    // light clocks: two mirrors and a dial ring (rigid), then the photon, its path and the dial's hand
    const mirrorN = Math.floor(260 * s), ringN = Math.floor(160 * s);
    this.photonN = Math.max(8, Math.floor(110 * s));
    this.trailN = Math.max(20, Math.floor(520 * s));
    this.handN = Math.max(8, Math.floor(70 * s));
    for (const f of [0, 1] as const) {
      const zc = f === 0 ? ZP : ZT;
      for (let k = 0; k < K; k++) {
        const x0 = this.clockXi[k];
        for (const my of [0, H]) block(f, mirrorN, () => [x0 + (rng() - 0.5) * 0.22, my + (my ? 0.01 : -0.01), zc + (rng() - 0.5) * 0.2], HUE[f], 0.3, 0.7);
        block(f, ringN, (q) => {
          const a = (q / ringN) * Math.PI * 2, top = q < ringN * 0.04;
          return [x0 + Math.sin(a) * DIAL_R * (top ? 1.15 : 1), DIAL_Y + Math.cos(a) * DIAL_R * (top ? 1.15 : 1), zc];
        }, HUE[f], 0.7, 0.5);
      }
    }
    this.blob = new Float32Array(this.photonN * 3);
    for (let q = 0; q < this.photonN; q++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2, r = 0.022 * Math.cbrt(rng()), w = Math.sqrt(1 - u * u) * r;
      this.blob[q * 3] = w * Math.cos(a); this.blob[q * 3 + 1] = u * r; this.blob[q * 3 + 2] = w * Math.sin(a);
    }
    for (const f of [0, 1] as const) {
      for (let k = 0; k < K; k++) {
        this.photon0.push(p);
        for (let q = 0; q < this.photonN && p < P; q++, p++) hslToRgb(HUE[f], 0.35, 0.86, col, p * 3);
        this.trail0.push(p);
        for (let q = 0; q < this.trailN && p < P; q++, p++) {
          const fade = 1 - q / this.trailN;
          hslToRgb(HUE[f], 0.85, 0.32 + 0.3 * fade, col, p * 3);
          for (let c = 0; c < 3; c++) col[p * 3 + c] *= 0.25 + 0.9 * fade;
        }
        this.hand0.push(p);
        for (let q = 0; q < this.handN && p < P; q++, p++) hslToRgb(HUE[f], 0.5, 0.8, col, p * 3);
      }
    }

    // scorch marks and observers
    this.markN = Math.max(8, Math.floor(260 * s));
    this.markOff = new Float32Array(this.markN * 2);
    for (let q = 0; q < this.markN; q++) {
      const a = rng() * Math.PI * 2, r = 0.07 * Math.sqrt(rng());
      this.markOff[q * 2] = r * Math.cos(a); this.markOff[q * 2 + 1] = r * Math.sin(a);
    }
    const FLASH_HUE = [0.76, 0.96]; // rear flash violet, front flash rose
    for (let m = 0; m < 4; m++) {
      this.mark0[m] = p;
      for (let q = 0; q < this.markN && p < P; q++, p++) hslToRgb(FLASH_HUE[m & 1], 0.9, 0.6, col, p * 3);
    }
    this.obsN = Math.max(30, Math.floor(600 * s));
    for (let o = 0; o < 2; o++) {
      this.obs0[o] = p;
      for (let q = 0; q < this.obsN && p < P; q++, p++) {
        const part = q * 3 < this.obsN ? 0 : q * 3 < 2 * this.obsN ? 1 : 2;
        if (part === 0) hslToRgb(0.15, 0.1, 0.9, col, p * 3);
        else hslToRgb(FLASH_HUE[part - 1], 0.95, 0.66, col, p * 3);
      }
    }
    // the flashes: Fibonacci spheres
    this.flashN = Math.max(64, Math.floor(7000 * s));
    this.dir = new Float32Array(this.flashN * 3);
    for (let q = 0; q < this.flashN; q++) {
      const y = 1 - (2 * (q + 0.5)) / this.flashN, r = Math.sqrt(1 - y * y), a = q * 2.399963229728653;
      this.dir[q * 3] = Math.cos(a) * r; this.dir[q * 3 + 1] = y; this.dir[q * 3 + 2] = Math.sin(a) * r;
    }
    for (let f = 0; f < 2; f++) {
      this.flash0[f] = p;
      for (let q = 0; q < this.flashN; q++, p++) {
        const band = Math.abs(this.dir[q * 3 + 1]) < 0.035; // brighter equator
        hslToRgb(FLASH_HUE[f], 0.85, band ? 0.7 : 0.5, col, p * 3);
        if (!band) for (let c = 0; c < 3; c++) col[p * 3 + c] *= 0.32;
      }
    }
    // whatever is left: more of the platform deck (dim), so every budget is used
    const extra = P - p;
    if (extra > 0) block(0, extra, () => [(rng() - 0.5) * L, -0.04 - 0.03 * rng(), 0.04 + 0.92 * rng()], HUE[0], 0.5, 0.2);

    this.t = -this.loopHalf() * 0.35;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.v = Math.min(0.97, Math.max(0.05, p.v ?? 0.6));
    this.frame = Math.round(p.frame ?? 0);
    this.speed = p.speed ?? 1;
  }

  /** The observer's velocity relative to the platform: 0 (platform), v (train) or the midway frame. */
  private observerU(): number {
    if (this.frame === 1) return this.v;
    if (this.frame === 2) return (1 - Math.sqrt(1 - this.v * this.v)) / this.v; // tanh(rapidity/2)
    return 0;
  }

  /** Velocities of the platform and the train as seen by the observer (relativistic velocity addition). */
  private frameVel(): [number, number] {
    const u = this.observerU();
    return [-u, (this.v - u) / (1 - this.v * u)];
  }

  /** Half the loop length: long enough for train and platform to pass each other fully, and for both
   *  flashes to reach both observers. */
  private loopHalf(): number {
    const w = this.frameVel(), ev = new Float64Array(4);
    this.strikes(ev);
    let tEnd = (L + 0.6) / Math.max(1e-3, w[1] - w[0]);
    for (let fr = 0; fr < 2; fr++) for (let f = 0; f < 2; f++) {
      // reception: (t − t_E)² = (w t − x_E)² + d², the later root
      const tE = ev[f * 2], xE = ev[f * 2 + 1], wf = w[fr], d2 = ZOBS * ZOBS;
      const b = tE - wf * xE, a = 1 - wf * wf;
      tEnd = Math.max(tEnd, (b + Math.sqrt(Math.max(0, b * b - a * (tE * tE - xE * xE - d2)))) / a + 0.8);
    }
    return Math.min(14, tEnd);
  }

  /** The two lightning strikes in the observer's frame: [t, x] of the rear (−x) and front (+x) strike. */
  private strikes(out: Float64Array): void {
    const u = this.observerU(), gu = 1 / Math.sqrt(1 - u * u), gv = 1 / Math.sqrt(1 - this.v * this.v);
    for (let f = 0; f < 2; f++) {
      const xs = (f ? 1 : -1) * L / (2 * gv); // the train's ends at platform time 0
      out[f * 2] = gu * (0 - u * xs); out[f * 2 + 1] = gu * (xs - u * 0);
    }
  }

  private syncPositions(): void {
    const pos = this.positions, t = this.t;
    const w = this.frameVel(), g = [1 / Math.sqrt(1 - w[0] * w[0]), 1 / Math.sqrt(1 - w[1] * w[1])];
    // rigid parts: x = ξ/γ + w t
    for (const b of this.rigid) {
      const wf = w[b.frame], gf = g[b.frame];
      for (let p = b.start; p < b.start + b.count; p++) {
        pos[p * 3] = this.xi[p] / gf + wf * t; pos[p * 3 + 1] = this.ry[p]; pos[p * 3 + 2] = this.rz[p];
      }
    }
    // light clocks: each reads its own proper time τ = t/γ − w ξ
    const T = 2 * H;
    const height = (tau: number): number => { const f = tau / T - Math.floor(tau / T); return H * (1 - Math.abs(1 - 2 * f)); };
    for (let f = 0; f < 2; f++) {
      const zc = f === 0 ? ZP : ZT, wf = w[f], gf = g[f];
      for (let k = 0; k < K; k++) {
        const c = f * K + k, x0 = this.clockXi[k];
        const tau = t / gf - wf * x0, xc = x0 / gf + wf * t, y = height(tau);
        for (let q = 0; q < this.photonN; q++) {
          const o = (this.photon0[c] + q) * 3;
          pos[o] = xc + this.blob[q * 3] / gf; pos[o + 1] = y + this.blob[q * 3 + 1]; pos[o + 2] = zc + this.blob[q * 3 + 2];
        }
        for (let q = 0; q < this.trailN; q++) {
          const ts = t - (q / this.trailN) * TRAIL, o = (this.trail0[c] + q) * 3;
          pos[o] = x0 / gf + wf * ts; pos[o + 1] = height(ts / gf - wf * x0); pos[o + 2] = zc;
        }
        const a = (tau / DIAL_PERIOD) * Math.PI * 2;
        for (let q = 0; q < this.handN; q++) {
          const r = (q / this.handN) * DIAL_R * 0.9, o = (this.hand0[c] + q) * 3;
          pos[o] = xc + (Math.sin(a) * r) / gf; pos[o + 1] = DIAL_Y + Math.cos(a) * r; pos[o + 2] = zc + 0.003;
        }
      }
    }
    // the flashes: spheres of light expanding at c from each strike (in every frame)
    const ev = new Float64Array(4);
    this.strikes(ev);
    for (let f = 0; f < 2; f++) {
      const r = t - ev[f * 2], cx = ev[f * 2 + 1];
      for (let q = 0; q < this.flashN; q++) {
        const o = (this.flash0[f] + q) * 3;
        if (r >= 0) {
          pos[o] = cx + r * this.dir[q * 3]; pos[o + 1] = H / 2 + r * this.dir[q * 3 + 1]; pos[o + 2] = r * this.dir[q * 3 + 2];
        } else { // not struck yet in this frame: hidden among the deck's points
          const sl = (this.slab0 + ((q * 7919 + f * 3571) % this.slabN)) * 3;
          pos[o] = pos[sl]; pos[o + 1] = pos[sl + 1]; pos[o + 2] = pos[sl + 2];
        }
      }
    }
    // scorch marks: on the platform and on the train, where each bolt struck (once it has struck)
    const gv = 1 / Math.sqrt(1 - this.v * this.v);
    for (let m = 0; m < 4; m++) {
      const fr = m < 2 ? 0 : 1, side = m & 1 ? 1 : -1;
      const xiM = fr === 0 ? side * L / (2 * gv) : side * L / 2; // rest-frame position of the mark
      const tauStrike = fr === 0 ? 0 : -gv * this.v * (side * L / (2 * gv)); // its own clock at the strike
      const struck = t / g[fr] - w[fr] * xiM >= tauStrike;
      const zc = fr === 0 ? 0.1 : -0.1;
      for (let q = 0; q < this.markN; q++) {
        const o = (this.mark0[m] + q) * 3;
        if (struck) {
          pos[o] = (xiM + this.markOff[q * 2]) / g[fr] + w[fr] * t; pos[o + 1] = -0.02; pos[o + 2] = zc + this.markOff[q * 2 + 1];
        } else { // not yet: hidden among the deck's points
          const s = (this.slab0 + ((q * 7919 + m * 104729) % this.slabN)) * 3;
          pos[o] = pos[s]; pos[o + 1] = pos[s + 1]; pos[o + 2] = pos[s + 2];
        }
      }
    }
    // observers at the middle of the platform and of the train; a lamp rises when each flash reaches them
    for (let fr = 0; fr < 2; fr++) {
      const x = w[fr] * t, z = fr === 0 ? ZOBS : -ZOBS, n3 = Math.floor(this.obsN / 3);
      for (let q = 0; q < this.obsN; q++) {
        const o = (this.obs0[fr] + q) * 3, part = q < n3 ? 0 : q < 2 * n3 ? 1 : 2, u = (q % n3) / n3;
        let px = x, py = 0.02 + u * 0.42;
        if (part > 0) {
          const f = part - 1, d = Math.hypot(x - ev[f * 2 + 1], 0.02 + 0.42 * 0.5 - H / 2, z);
          if (t - ev[f * 2] >= d) { px = x + (f ? 1 : -1) * 0.07; py = 0.5 + u * 0.22; } // seen: lamp up on that side
        }
        pos[o] = px; pos[o + 1] = py; pos[o + 2] = z;
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const h = dt * this.speed;
    if (h > 0) {
      this.t += h;
      const half = this.loopHalf();
      if (this.t > half) this.t = -half;
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void {
    if (s.length !== 1) return;
    this.t = s[0];
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const v = this.v, g = 1 / Math.sqrt(1 - v * v);
    // the train observer's proper-time gap between the front and rear flashes (exact, incl. the small z offset)
    const d = ZOBS, gap = (xe: number): number => (-v * xe + Math.sqrt(v * v * xe * xe + (1 - v * v) * (xe * xe + d * d))) / (1 - v * v) / g;
    const a = L / (2 * g), lag = gap(-a) - gap(a);
    const names = ['platform', 'train', 'midway'];
    return [{
      id: 'root', parentId: null,
      label: `v = ${v.toFixed(2)}c, γ = ${g.toFixed(3)} · ${names[this.frame] ?? 'platform'} frame · moving clocks tick ${g.toFixed(2)}× slower, moving rulers are ${(1 / g).toFixed(2)}× shorter · train clocks synced aboard differ end-to-end by vL/c² = ${(v * L).toFixed(2)} s on the platform · the train observer sees the front flash ${lag.toFixed(2)} s before the rear one`,
      stateOffset: 0, stateLength: 1,
    }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const specialRelativityFactory: ArchetypeFactory = {
  id: 'specialRelativity',
  label: 'Train and Platform (Special Relativity)',
  category: 'Spacetime',
  kind: 'flow',
  params: [
    { key: 'v', label: 'train speed v / c', min: 0.05, max: 0.95, step: 0.01, default: 0.6 },
    { key: 'frame', label: 'whose frame', min: 0, max: 2, step: 1, default: 0, options: { platform: 0, train: 1, midway: 2 } },
    { key: 'speed', label: 'speed', min: 0, max: 2, step: 0.05, default: 0.7 },
  ],
  defaultParticleCount: 100_000,
  particleCountOptions: [50_000, 100_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new SpecialRelativityArchetype(config),
};

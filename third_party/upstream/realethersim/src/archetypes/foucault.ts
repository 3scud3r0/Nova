import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';

// Foucault's Pendulum — the Earth turning, made visible. In 1851 Léon Foucault hung a 28 kg bob on a 67 m
// wire under the dome of the Panthéon in Paris and let it swing. Nothing pushes the pendulum sideways,
// yet over the hours its swing plane slowly turns — clockwise in the northern hemisphere — knocking over a
// ring of pegs one by one. The plane isn't really turning: the floor (and Paris, and you) are turning
// underneath it. Seen from the rotating floor, the Coriolis force of the Earth's spin bends every swing a
// little, and the plane precesses at Ω·sin(latitude): once a day at the poles, never at the equator, and
// once every 31.8 hours in Paris. Here the Earth's spin is exaggerated (the knob) so a turn takes about a
// minute instead of a day and a third; the trace on the floor is the bob's path seen from the floor —
// released from rest at the rim it draws a star of cusped petals. Equations: the linearised pendulum in
// the rotating frame, ẍ = −ω₀²x − 2Ω sinλ·ż, z̈ = −ω₀²z + 2Ω sinλ·ẋ (RK4).

const PIVOT_Y = 2.3;
const FLOOR_Y = -0.9;
const WIRE = PIVOT_Y - FLOOR_Y - 0.12; // the bob just clears the floor at rest
const AMP = 1.05; // release amplitude (render units)
const OMEGA0 = 2.5; // swing angular frequency (rad per time unit)
const TAIL = 9000;
const PEGS = 36;
const PEG_R = AMP + 0.06;
const SIDEREAL_DAY_H = 23.934;

class FoucaultArchetype implements Archetype {
  readonly id = 'foucault';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly s = new Float64Array(4); // x, z, ẋ, ż (floor frame)
  private readonly tail = new Float64Array(TAIL * 2);
  private head = 0;
  private readonly fall = new Float64Array(PEGS); // 0 standing … 1 flat
  private planeTurn = 0; // accumulated turn of the swing plane (radians), for resetting the pegs
  private lat = 48.85; // degrees
  private earth = 0.04; // Earth spin as a fraction of ω₀ (exaggerated)
  private speed = 1;
  private readonly role: Uint8Array; // 0 static floor, 1 wire, 2 bob, 3 trail, 4 peg
  private readonly a: Float32Array; private readonly b: Float32Array; private readonly c: Float32Array;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    this.readParams(config.params);
    const push = config.params.push ?? 0;
    this.s[0] = AMP; this.s[1] = 0; this.s[2] = 0; this.s[3] = push * OMEGA0 * AMP * 0.35;
    for (let i = 0; i < TAIL; i++) this.advance(0.016); // open with a drawn trace

    this.role = new Uint8Array(P);
    this.a = new Float32Array(P); this.b = new Float32Array(P); this.c = new Float32Array(P);
    const col = this.colors;
    let p = 0;
    const put = (role: number, a: number, b: number, c: number, h: number, s: number, l: number, gain = 1): void => {
      if (p >= P) return;
      this.role[p] = role; this.a[p] = a; this.b[p] = b; this.c[p] = c;
      hslToRgb(h, s, l, col, p * 3);
      col[p * 3] *= gain; col[p * 3 + 1] *= gain; col[p * 3 + 2] *= gain;
      p++;
    };
    // floor: a faint disc, a compass ring with 24 hour ticks, N marker
    const floorN = Math.floor(P * 0.1);
    for (let i = 0; i < floorN; i++) {
      const r = 1.55 * Math.sqrt(i / floorN), ph = i * 2.39996323;
      put(0, r * Math.cos(ph), FLOOR_Y - 0.01, r * Math.sin(ph), 0.6, 0.25, 0.22, 0.5);
    }
    const f = P / 140_000; // fixed parts scale with the point budget
    const ringN = Math.max(16, Math.floor(2600 * f)), tickN = Math.max(3, Math.floor(90 * f));
    for (let i = 0; i < ringN; i++) { const ph = (i / ringN) * Math.PI * 2; put(0, 1.5 * Math.cos(ph), FLOOR_Y, 1.5 * Math.sin(ph), 0.58, 0.3, 0.55, 0.8); }
    for (let k = 0; k < 24; k++) for (let i = 0; i < tickN; i++) {
      const ph = (k / 24) * Math.PI * 2, r = 1.5 - (k % 6 === 0 ? 0.16 : 0.08) * (i / Math.max(1, tickN - 1));
      put(0, r * Math.cos(ph), FLOOR_Y, r * Math.sin(ph), 0.58, 0.3, 0.6, 0.9);
    }
    // the wire, the bob, the pegs
    const wireN = Math.max(8, Math.floor(4500 * f)), bobN = Math.max(8, Math.floor(5000 * f)), pegN = Math.max(3, Math.floor(240 * f));
    for (let i = 0; i < wireN; i++) put(1, i / (wireN - 1), 0, 0, 0.1, 0.15, 0.7, 0.75);
    for (let i = 0; i < bobN; i++) {
      const u = (i * 0.6180339887) % 1 * 2 - 1, th = i * 2.39996323, r = 0.085 * Math.cbrt(((i * 0.7548776662) % 1));
      const ss = Math.sqrt(1 - u * u) * r;
      put(2, ss * Math.cos(th), u * r, ss * Math.sin(th), 0.1, 0.75, 0.55, 1.3);
    }
    for (let k = 0; k < PEGS; k++) for (let i = 0; i < pegN; i++) put(4, k, i / (pegN - 1), 0, 0.0, 0.85, 0.55, 1.2);
    // the trace on the floor, newest brightest
    const tailN = P - p;
    for (let i = 0; i < tailN; i++) {
      const age = (i / tailN) * (TAIL - 1);
      const fade = Math.pow(1 - age / TAIL, 1.2);
      put(3, age, 0, 0, 0.1 + 0.03 * fade, 0.9, 0.38 + 0.3 * fade, 0.3 + 1.25 * fade);
    }
    for (let q = 0; q < P; q++) if (this.role[q] === 0) {
      const o = q * 3; this.positions[o] = this.a[q]; this.positions[o + 1] = this.b[q]; this.positions[o + 2] = this.c[q];
    }
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.lat = p.latitude ?? 48.85;
    this.earth = p.earth ?? 0.04;
    this.speed = p.speed ?? 1;
  }

  private deriv(s: Float64Array, out: Float64Array, Wv: number): void {
    out[0] = s[2]; out[1] = s[3];
    out[2] = -OMEGA0 * OMEGA0 * s[0] - 2 * Wv * s[3];
    out[3] = -OMEGA0 * OMEGA0 * s[1] + 2 * Wv * s[2];
  }
  private readonly k1 = new Float64Array(4); private readonly k2 = new Float64Array(4);
  private readonly k3 = new Float64Array(4); private readonly k4 = new Float64Array(4); private readonly tmp = new Float64Array(4);

  private advance(h: number): void {
    const Wv = this.earth * OMEGA0 * Math.sin((this.lat * Math.PI) / 180);
    const sub = 4, hh = h / sub, s = this.s;
    for (let n = 0; n < sub; n++) {
      this.deriv(s, this.k1, Wv);
      for (let i = 0; i < 4; i++) this.tmp[i] = s[i] + 0.5 * hh * this.k1[i];
      this.deriv(this.tmp, this.k2, Wv);
      for (let i = 0; i < 4; i++) this.tmp[i] = s[i] + 0.5 * hh * this.k2[i];
      this.deriv(this.tmp, this.k3, Wv);
      for (let i = 0; i < 4; i++) this.tmp[i] = s[i] + hh * this.k3[i];
      this.deriv(this.tmp, this.k4, Wv);
      for (let i = 0; i < 4; i++) s[i] += (hh / 6) * (this.k1[i] + 2 * this.k2[i] + 2 * this.k3[i] + this.k4[i]);
    }
    this.head = (this.head + 1) % TAIL;
    this.tail[this.head * 2] = s[0]; this.tail[this.head * 2 + 1] = s[1];
    // pegs: the bob knocks a peg over when it passes close by; all stand again after each half turn
    this.planeTurn += Math.abs(Wv) * h;
    if (this.planeTurn > Math.PI) { this.planeTurn -= Math.PI; this.fall.fill(0); }
    for (let k = 0; k < PEGS; k++) {
      if (this.fall[k] > 0) { this.fall[k] = Math.min(1, this.fall[k] + h * 2.5); continue; }
      const ph = (k / PEGS) * Math.PI * 2;
      if (Math.hypot(s[0] - PEG_R * Math.cos(ph), s[1] - PEG_R * Math.sin(ph)) < 0.1) this.fall[k] = 0.001;
    }
  }

  private syncPositions(): void {
    const pos = this.positions, s = this.s;
    const bx = s[0], bz = s[1];
    const by = PIVOT_Y - Math.sqrt(Math.max(0.01, WIRE * WIRE - bx * bx - bz * bz));
    for (let p = 0; p < this.particleCount; p++) {
      const role = this.role[p], o = p * 3;
      if (role === 0) continue;
      if (role === 1) {
        const t = this.a[p];
        pos[o] = bx * t; pos[o + 1] = PIVOT_Y + (by - PIVOT_Y) * t; pos[o + 2] = bz * t;
      } else if (role === 2) {
        pos[o] = bx + this.a[p]; pos[o + 1] = by + this.b[p]; pos[o + 2] = bz + this.c[p];
      } else if (role === 3) {
        const age = this.a[p], a0 = age | 0, t = age - a0;
        let i0 = this.head - a0; if (i0 < 0) i0 += TAIL;
        let i1 = i0 - 1; if (i1 < 0) i1 += TAIL;
        pos[o] = this.tail[i0 * 2] * (1 - t) + this.tail[i1 * 2] * t;
        pos[o + 1] = FLOOR_Y + 0.006;
        pos[o + 2] = this.tail[i0 * 2 + 1] * (1 - t) + this.tail[i1 * 2 + 1] * t;
      } else {
        // a peg: a short upright stick that tips over outward as it falls
        const k = this.a[p], t = this.b[p], ph = (k / PEGS) * Math.PI * 2;
        const tip = (this.fall[k] * Math.PI) / 2, len = 0.16 * t;
        const r = PEG_R + Math.sin(tip) * len;
        pos[o] = r * Math.cos(ph); pos[o + 1] = FLOOR_Y + Math.cos(tip) * len; pos[o + 2] = r * Math.sin(ph);
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const h = dt * this.speed;
    if (h > 0) this.advance(h);
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return Float64Array.from([...this.s, this.head, this.planeTurn, ...this.fall, ...this.tail]); }
  loadState(st: Float64Array): void {
    if (st.length !== 6 + PEGS + TAIL * 2) return;
    this.s.set(st.subarray(0, 4)); this.head = st[4]; this.planeTurn = st[5];
    this.fall.set(st.subarray(6, 6 + PEGS)); this.tail.set(st.subarray(6 + PEGS));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const sl = Math.sin((this.lat * Math.PI) / 180);
    const hours = Math.abs(sl) < 1e-3 ? '∞ (no turning at the equator)' : `${(SIDEREAL_DAY_H / Math.abs(sl)).toFixed(1)} h`;
    return [{ id: 'root', parentId: null, label: `latitude ${this.lat.toFixed(1)}° · the real swing plane turns once in ${hours}${sl < 0 ? ' (anticlockwise)' : sl > 0 ? ' (clockwise)' : ''}`, stateOffset: 0, stateLength: 4 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const foucaultFactory: ArchetypeFactory = {
  id: 'foucault',
  label: "Foucault's Pendulum",
  category: 'Rotation',
  kind: 'flow',
  params: [
    { key: 'latitude', label: 'latitude λ (°)', min: -90, max: 90, step: 0.5, default: 48.85 },
    { key: 'earth', label: 'Earth spin (exaggerated)', min: 0, max: 0.15, step: 0.005, default: 0.04 },
    { key: 'push', label: 'sideways push at release', min: 0, max: 1, step: 0.05, default: 0, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 140_000,
  particleCountOptions: [70_000, 140_000, 220_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new FoucaultArchetype(config),
};

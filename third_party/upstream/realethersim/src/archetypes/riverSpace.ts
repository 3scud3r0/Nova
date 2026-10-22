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

// River of Space — a black hole as flowing space (the Painlevé–Gullstrand "river model", Hamilton & Lisle
// 2008). Write Schwarzschild's black hole in Painlevé–Gullstrand coordinates and space itself becomes a
// river flowing inward at the Newtonian escape speed, β = −c·√(r_s/r), through flat space. Light always
// moves at c RELATIVE TO THE RIVER, so its true motion is c in any direction plus the flow: ẋ = c·n̂ + β r̂.
// Far out the river is slow and a flash of light spreads as a nearly round ring; nearer in, the ring is
// dragged inward and lopsided; at the horizon r_s the river runs at exactly c, so light aimed straight
// out stands still; inside, the river outruns light and every flash is carried to the centre. This flow
// is a SHIFT VECTOR — the same ingredient that drives an Alcubierre warp bubble — here in an exact
// solution of Einstein's equations with ordinary positive mass. Flashes go off around the hole on a
// timer; faint blue tracers show the river itself; the red ring is the horizon.

const ROUT = 5.2; // radius (units of r_s) out to which emitters and river tracers are placed
const RS = 0.62; // horizon radius in render units

class RiverSpaceArchetype implements Archetype {
  readonly id = 'riverSpace';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly E: number; // emitters
  private readonly M: number; // points per flash
  private readonly ex: Float32Array; private readonly ez: Float32Array; private readonly phase: Float32Array; // emitters (units of r_s)
  private readonly px: Float32Array; private readonly pz: Float32Array; private readonly alive: Uint8Array; // flash points
  private readonly nx: Float32Array; private readonly nz: Float32Array; // each point's light direction
  private readonly tracer0: number; private readonly tracers: number; // river tracers live at the end
  private readonly tr: Float32Array; private readonly ta: Float32Array; // tracer radius, angle
  private period = 7;
  private speed = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    this.readParams(config.params);

    // emitters on a spread of radii (a few inside the horizon), each flashing on its own phase
    this.E = Math.max(6, Math.round(config.params.emitters ?? 40));
    const horizonBudget = Math.floor(P * 0.03), tracerBudget = Math.floor(P * 0.14);
    this.M = Math.max(8, Math.floor((P - horizonBudget - tracerBudget) / this.E));
    this.ex = new Float32Array(this.E); this.ez = new Float32Array(this.E); this.phase = new Float32Array(this.E);
    for (let e = 0; e < this.E; e++) {
      const r = e % 7 === 0 ? 0.45 + 0.45 * rng() : 1.15 + (ROUT * 0.7 - 1.15) * Math.pow(rng(), 0.8);
      const a = rng() * Math.PI * 2;
      this.ex[e] = r * Math.cos(a); this.ez[e] = r * Math.sin(a);
      this.phase[e] = rng();
    }
    const nPts = this.E * this.M;
    this.px = new Float32Array(nPts); this.pz = new Float32Array(nPts); this.alive = new Uint8Array(nPts);
    this.nx = new Float32Array(nPts); this.nz = new Float32Array(nPts);
    const col = this.colors;
    for (let e = 0; e < this.E; e++) {
      const r = Math.hypot(this.ex[e], this.ez[e]);
      // colour by where the flash starts: white-gold far out → amber → red inside the horizon
      const h = r < 1 ? 0.0 : 0.08 + 0.06 * Math.min(1, (r - 1) / 3);
      const l = r < 1 ? 0.55 : 0.55 + 0.12 * Math.min(1, (r - 1) / 3);
      for (let m = 0; m < this.M; m++) {
        const p = e * this.M + m, ang = (m / this.M) * Math.PI * 2;
        this.nx[p] = Math.cos(ang); this.nz[p] = Math.sin(ang);
        hslToRgb(h, 0.9, l, col, p * 3);
      }
    }
    // the horizon ring
    let p = nPts;
    for (let i = 0; i < horizonBudget && p < P; i++, p++) {
      const a = (i / horizonBudget) * Math.PI * 2;
      this.positions[p * 3] = Math.cos(a) * RS; this.positions[p * 3 + 1] = 0; this.positions[p * 3 + 2] = Math.sin(a) * RS;
      hslToRgb(0.98, 0.9, 0.5, col, p * 3);
    }
    // river tracers: the flowing space itself, drifting inward at β
    this.tracer0 = p; this.tracers = P - p;
    this.tr = new Float32Array(this.tracers); this.ta = new Float32Array(this.tracers);
    for (let i = 0; i < this.tracers; i++, p++) {
      this.tr[i] = 0.08 + (ROUT - 0.08) * Math.sqrt(rng());
      this.ta[i] = rng() * Math.PI * 2;
      hslToRgb(0.6, 0.7, 0.32, col, p * 3);
    }
    // start mid-cycle so the system opens with flashes already spreading
    this.t = this.period * 0.999;
    for (let k = 0; k < 220; k++) this.advance(0.016 * 2);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.period = p.period ?? 7;
    this.speed = p.speed ?? 1;
  }

  // light: ẋ = n̂ + β r̂ with β = −√(1/r) (units: r_s = 1, c = 1); substepped near the centre
  private advance(h: number): void {
    const prevT = this.t;
    this.t += h;
    const { E, M, px, pz, alive, nx, nz } = this;
    for (let e = 0; e < E; e++) {
      // a new flash when this emitter's phase wraps
      const before = (prevT / this.period + this.phase[e]) % 1, after = (this.t / this.period + this.phase[e]) % 1;
      if (after < before) for (let m = 0; m < M; m++) { const q = e * M + m; px[q] = this.ex[e]; pz[q] = this.ez[e]; alive[q] = 1; }
    }
    for (let q = 0; q < E * M; q++) {
      if (!alive[q]) continue;
      let x = px[q], z = pz[q];
      const r0 = Math.hypot(x, z);
      const sub = r0 < 1.5 ? 6 : 2, dh = h / sub;
      for (let s = 0; s < sub; s++) {
        const r = Math.hypot(x, z);
        if (r < 0.04) { alive[q] = 0; break; } // reached the singularity
        const beta = -Math.sqrt(1 / r);
        x += (nx[q] + (beta * x) / r) * dh;
        z += (nz[q] + (beta * z) / r) * dh;
      }
      px[q] = x; pz[q] = z; // (light leaving the frame keeps going — it just fades from view)
    }
    // the river: dr/dt = β(r); respawn at the rim when a tracer reaches the centre
    for (let i = 0; i < this.tracers; i++) {
      let r = this.tr[i];
      r += -Math.sqrt(1 / Math.max(r, 0.04)) * h;
      if (r < 0.05) r = ROUT;
      this.tr[i] = r;
    }
  }

  private syncPositions(): void {
    const pos = this.positions;
    const { E, M, alive } = this;
    const live = new Int32Array(M);
    for (let e = 0; e < E; e++) {
      let nLive = 0;
      for (let m = 0; m < M; m++) if (alive[e * M + m]) live[nLive++] = e * M + m;
      for (let m = 0; m < M; m++) {
        const q = e * M + m, o = q * 3;
        if (alive[q]) { pos[o] = this.px[q] * RS; pos[o + 1] = 0; pos[o + 2] = this.pz[q] * RS; continue; }
        if (nLive) {
          // swallowed light rides with a surviving part of the same flash (same colour), so nothing piles up
          const src = live[m % nLive];
          pos[o] = this.px[src] * RS; pos[o + 1] = 0; pos[o + 2] = this.pz[src] * RS;
        } else {
          // a flash swallowed entirely (it began inside the horizon) rests on the horizon ring
          const a = ((e * 0.618034 + m / M) % 1) * Math.PI * 2;
          pos[o] = Math.cos(a) * RS; pos[o + 1] = 0; pos[o + 2] = Math.sin(a) * RS;
        }
      }
    }
    for (let i = 0; i < this.tracers; i++) {
      const o = (this.tracer0 + i) * 3, r = this.tr[i] * RS;
      pos[o] = Math.cos(this.ta[i]) * r; pos[o + 1] = -0.004; pos[o + 2] = Math.sin(this.ta[i]) * r;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const h = dt * this.speed * 2;
    if (h > 0) this.advance(h);
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const n = this.E * this.M;
    const s = new Float64Array(1 + 3 * n + this.tracers);
    s[0] = this.t;
    for (let q = 0; q < n; q++) { s[1 + q] = this.px[q]; s[1 + n + q] = this.pz[q]; s[1 + 2 * n + q] = this.alive[q]; }
    s.set(this.tr, 1 + 3 * n);
    return s;
  }
  loadState(s: Float64Array): void {
    const n = this.E * this.M;
    if (s.length !== 1 + 3 * n + this.tracers) return;
    this.t = s[0];
    for (let q = 0; q < n; q++) { this.px[q] = s[1 + q]; this.pz[q] = s[1 + n + q]; this.alive[q] = s[1 + 2 * n + q]; }
    this.tr.set(s.subarray(1 + 3 * n));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'space flowing into a black hole (river model)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const riverSpaceFactory: ArchetypeFactory = {
  id: 'riverSpace',
  label: 'River of Space',
  category: 'Spacetime',
  kind: 'flow',
  params: [
    { key: 'emitters', label: 'flash sources', min: 8, max: 120, step: 1, default: 40, rebuild: true },
    { key: 'period', label: 'time between flashes', min: 3, max: 16, step: 0.5, default: 7 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new RiverSpaceArchetype(config),
};

import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Hopfion — the Hopf fibration made visible. The Hopf map sends the 3-sphere S³ onto the ordinary
// sphere S²; the preimage of every point on S² is a great circle in S³, and any two of those circles
// are LINKED exactly once. Stereographically projected into R³ they become a family of nested,
// interlocking tori (Villarceau circles) that fill space — the ground-state texture of a topological
// soliton (a "hopfion"), which really does appear in ferromagnets, superfluids and Bose–Einstein
// condensates, in knotted light, and in fluid vortex knots. Each fibre is coloured by where it lives
// on the base sphere, so the linking reads as a smooth wheel of colour. Turning the fibre phase slides
// every point along its own circle — a rigid Hopf flow that makes the whole knot appear to breathe and
// rotate. Colours bake once; motion is a pure isometry. Bounded (the projection is clamped near its
// pole). (Heinz Hopf, 1931.)
const F = 1100; // number of fibres (great circles)
const S = 0.62; // stereographic projection scale
const DEN_MIN = 0.16; // clamp on (1 − w) so fibres near the projection pole stay bounded

class HopfionArchetype implements Archetype {
  readonly id = 'hopfion';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly th: Float32Array; // base-point polar angle on S² (per point)
  private readonly ph: Float32Array; // base-point azimuth on S²
  private readonly t0: Float32Array; // this point's phase along its fibre circle
  private rng: () => number;
  private rate = 1;
  private winding = 1;
  private time = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(2048, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.th = new Float32Array(N); this.ph = new Float32Array(N); this.t0 = new Float32Array(N);
    this.rng = mulberry32((config.seed ^ 0x1b873593) >>> 0);
    this.readParams(config.params);
    const rng = this.rng;
    // STRUCTURED sampling is what makes the fibration legible: each fixed latitude θ on S² lifts to one
    // torus, and evenly-spaced azimuths φ lay clean fibres around it. Random θ/φ just smears to a ball.
    // A NARROW band of latitudes near the equator lifts to a few fat, nested donuts — one thick
    // rainbow ring with a hole down the axis (the whole fibration, all θ, just fills a solid ball).
    const NT = 7; // nested tori
    const fibersPerTorus = Math.max(1, Math.floor(F / NT));
    const per = Math.max(1, Math.floor(N / (NT * fibersPerTorus)));
    let idx = 0;
    for (let k = 0; k < NT; k++) {
      const th = 0.28 * Math.PI + ((k + 0.5) / NT) * 0.2 * Math.PI; // [0.28π, 0.48π] — compact, low-stretch ring
      for (let j = 0; j < fibersPerTorus && idx < N; j++) {
        const ph = (j / fibersPerTorus) * 2 * Math.PI + k * 0.27; // per-torus offset so fibres interleave
        const [cr, cg, cb] = this.fibreColour(ph, th);
        for (let p = 0; p < per && idx < N; p++, idx++) {
          this.th[idx] = th; this.ph[idx] = ph; this.t0[idx] = (p / per) * 2 * Math.PI;
          const o = idx * 3;
          const jit = 0.85 + 0.3 * rng();
          this.colors[o] = cr * jit; this.colors[o + 1] = cg * jit; this.colors[o + 2] = cb * jit;
        }
      }
    }
    while (idx < N) { this.th[idx] = Math.PI / 2; this.ph[idx] = 0; this.t0[idx] = 0; idx++; }
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.rate = p.rate ?? 1;
    this.winding = Math.max(1, Math.round(p.winding ?? 1));
  }

  // cyclic blue→violet→magenta→cyan palette (the hopfion's signature colours), keyed by azimuth
  private fibreColour(ph: number, th: number): [number, number, number] {
    const stops: [number, number, number][] = [
      [0.22, 0.42, 1.0], // blue
      [0.62, 0.28, 1.0], // violet
      [1.0, 0.34, 0.85], // magenta
      [0.32, 0.82, 1.0], // cyan
    ];
    const u = (ph / (2 * Math.PI)) * stops.length;
    const i0 = Math.floor(u) % stops.length;
    const i1 = (i0 + 1) % stops.length;
    const fr = u - Math.floor(u);
    const a = stops[i0], b = stops[i1];
    const val = 0.7 + 0.45 * Math.cos(th - Math.PI / 2); // inner tori a touch brighter
    return [
      (a[0] + (b[0] - a[0]) * fr) * val,
      (a[1] + (b[1] - a[1]) * fr) * val,
      (a[2] + (b[2] - a[2]) * fr) * val,
    ];
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    const spin = this.time;
    const win = this.winding;
    for (let i = 0; i < N; i++) {
      const th = this.th[i], ph = this.ph[i];
      const t = this.t0[i] + spin; // sliding the fibre phase is a rigid Hopf flow
      const ct2 = Math.cos(th * 0.5), st2 = Math.sin(th * 0.5);
      // a Hopf fibre as a unit vector (a,b,c,w) in S³ ⊂ R⁴; winding>1 gives (1,win) torus knots
      const a = ct2 * Math.cos(t);
      const b = ct2 * Math.sin(t);
      const c = st2 * Math.cos(win * t + ph);
      const w = st2 * Math.sin(win * t + ph);
      // stereographic projection R⁴→R³ from the pole (0,0,0,1), clamped so nothing runs to infinity
      let den = 1 - w; if (den < DEN_MIN) den = DEN_MIN;
      const k = S / den;
      const o = i * 3;
      pos[o] = a * k; pos[o + 1] = c * k; pos[o + 2] = b * k;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.time += dt * this.rate * 0.6;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.time]); }
  loadState(s: Float64Array): void { this.time = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Hopf fibration (linked tori)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.006 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const hopfionFactory: ArchetypeFactory = {
  id: 'hopfion',
  label: 'Hopfion',
  category: 'Field',
  kind: 'flow',
  params: [
    { key: 'rate', label: 'Hopf flow', min: 0, max: 2.5, step: 0.05, default: 1 },
    { key: 'winding', label: 'winding n', min: 1, max: 3, step: 1, default: 1 },
  ],
  defaultParticleCount: 150_000,
  particleCountOptions: [80_000, 150_000, 240_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new HopfionArchetype(config),
};

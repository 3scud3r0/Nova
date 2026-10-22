import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Magnetic reconnection — the X-point. At a magnetic null the plasma flow is a 2D hyperbolic
// stagnation (saddle) field: slow inflow squeezes in along one axis and is expelled as fast jets along
// the perpendicular axis. The exact divergence-free saddle is v = (−α·x, α·y); making the outflow
// faster than the inflow (β = α·jetBoost on the y-component) gives the reconnection asymmetry — the
// "releasing plasma jets". Every particle is a massless tracer of this closed-form field (O(n), no
// pairwise loop). Three baked populations read as the neon X: BLUE field lines rushing in horizontally,
// GOLD jets blasting out vertically, and a WHITE core where the flow stalls at the null. Each particle
// rides a fixed streamline and is deterministically respawned at its baked home when it leaves its
// zone, so the flow streams forever and stays bounded (no blow-up, snapshot-safe — no RNG in step()).
const DIM = 2;
const XMAX = 2.8; // domain half-width (inflow reach clamp)
const JET_REACH = 1.9; // jets respawn here — shorter than the inflow so the beam stays dense/bright
const CORE_REACH = 0.42; // white core particles respawn tight around the null

const RSCALE = 0.58; // map the ±2.8 domain into the ~±1.6 render extent the orbit camera frames
const ZSPAN = 1.55; // half-thickness of the out-of-plane current-sheet slab (the X-point is really an X-LINE)

const ROLE_INFLOW = 0;
const ROLE_JET = 1;
const ROLE_CORE = 2;

const PARAM_SPEC: ParamSpec[] = [
  { key: 'rate', label: 'reconnection rate', min: 0.3, max: 2.0, step: 0.02, default: 0.9 }, // α: inflow strength
  { key: 'jetBoost', label: 'jet boost', min: 1.0, max: 4.0, step: 0.05, default: 2.5 }, // β/α: outflow:inflow asymmetry
  { key: 'inflowSpan', label: 'inflow span', min: 0.4, max: 2.5, step: 0.05, default: 1.0 }, // y-thickness of the inflow band
  { key: 'guideTwist', label: 'guide-field twist', min: 0, max: 6, step: 0.1, default: 0 }, // opt-in helical jets (B_z guide field)
];

class ReconnectionArchetype implements Archetype {
  readonly id = 'reconnection';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly state: Float64Array; // x, y
  private readonly role: Uint8Array; // inflow / jet / core
  private readonly home: Float64Array; // baked spawn (sx, sy) — deterministic respawn target
  private readonly hz: Float64Array; // baked out-of-plane coord (the X-LINE / current-sheet axis), static
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  constructor(config: ArchetypeConfig) {
    this.particleCount = config.particleCount;
    const n = this.particleCount;
    this.state = new Float64Array(n * DIM);
    this.role = new Uint8Array(n);
    this.home = new Float64Array(n * DIM);
    this.hz = new Float64Array(n);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);

    const rng = mulberry32(config.seed ^ 0x7a1c9d3b);
    const span = config.params.inflowSpan ?? 1.5; // 0..1-ish scale of the inflow wedge fill
    const col = this.colors;
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const r = rng();
      // Four wedges of the saddle form the X. Each particle lives in one wedge and is respawned when it
      // crosses the diagonal separatrix |y|=|x|, so the X arms stay crisp: BLUE in the horizontal inflow
      // wedges (|x|>|y|), GOLD in the vertical jet wedges (|y|>|x|), WHITE in a tight knot at the null.
      // `home` is the deterministic respawn target; the INITIAL state is desynced along the trajectory so
      // the populations are time-stationary (no lockstep waves / banding).
      let role: number, hx: number, hy: number, ix: number, iy: number;
      if (r < 0.42) {
        role = ROLE_INFLOW;
        const side = (i & 1) === 0 ? 1 : -1; // inflow from both ±x
        const ax = (0.25 + 0.75 * rng()) * XMAX; // |x| along the inflow (varied ⇒ a converging fan)
        hx = side * ax;
        hy = (rng() * 2 - 1) * ax * 0.22 * span; // tight band around the x-axis → blue reads as horizontal inflow
        ix = hx; iy = hy; // varied inflow distance already desyncs the fan — no extra phase needed
      } else if (r < 0.9) {
        role = ROLE_JET;
        const vdir = (i & 1) === 0 ? 1 : -1; // jets up and down
        // per-particle varied base: a common base + deterministic exponential stepping would quantize every
        // jet onto ONE geometric ladder of heights (→ banding); jittering the base interleaves the ladders.
        const base = 0.035 + rng() * 0.09;
        const wBase = 0.5; // jet is WIDE at the base (the bright diffusion region) and the saddle focuses it outward
        // initial height log-uniform in [base, JET_REACH] — time-stationary for dy/dt=βy ⇒ smooth, no banding
        const yInit = base * Math.pow((JET_REACH * 0.96) / base, rng());
        const w = wBase * (0.25 + 0.75 * (1 - yInit / JET_REACH)); // taper: wide near the X, narrow at the tip
        hx = (rng() * 2 - 1) * wBase;
        hy = vdir * base;
        ix = (rng() * 2 - 1) * w;
        iy = vdir * yInit;
      } else {
        role = ROLE_CORE;
        hx = (rng() * 2 - 1) * 0.1; // tight knot at the X-point
        hy = (rng() * 2 - 1) * 0.1;
        ix = hx; iy = hy;
      }
      this.role[i] = role;
      this.home[o] = hx; this.home[o + 1] = hy;
      this.state[o] = ix; this.state[o + 1] = iy;
      // out-of-plane extrusion: spread each particle across the current-sheet slab. The X-point becomes
      // an X-LINE; the white null becomes a glowing line down the slab. Static (saddle is z-invariant).
      this.hz[i] = (rng() * 2 - 1) * (role === ROLE_JET ? ZSPAN * 0.85 : ZSPAN);

      // colour ONCE by role (uploaded at build) — slight per-particle brightness jitter for texture
      const b = 0.8 + 0.2 * rng();
      if (role === ROLE_INFLOW) { col[i * 3] = 0.22 * b; col[i * 3 + 1] = 0.62 * b; col[i * 3 + 2] = 1.0 * b; }
      else if (role === ROLE_JET) { col[i * 3] = 1.0 * b; col[i * 3 + 1] = 0.72 * b; col[i * 3 + 2] = 0.26 * b; }
      else { col[i * 3] = 1.0; col[i * 3 + 1] = 0.95 * b; col[i * 3 + 2] = 0.9 * b; }
    }
    this.syncPositions();
  }

  step(dt: number, p: ResolvedParams): void {
    const n = this.particleCount;
    const st = this.state;
    const role = this.role;
    const home = this.home;
    const alpha = p.rate ?? 0.9;
    const beta = alpha * (p.jetBoost ?? 2.5);
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      let x = st[o], y = st[o + 1];
      // saddle flow: inflow along x (v_x = −αx), accelerating jets along y (v_y = +βy)
      x += -alpha * x * dt;
      y += beta * y * dt;
      const ax = x < 0 ? -x : x;
      const ay = y < 0 ? -y : y;
      const r = role[i];
      // respawn at the baked home when the particle leaves its wedge → crisp X, perpetual, bounded
      let respawn: boolean;
      if (r === ROLE_INFLOW) respawn = ay >= ax || ax > XMAX; // blue: crossed the diagonal into a jet wedge
      else if (r === ROLE_JET) respawn = ay > JET_REACH; // gold: shot out the top/bottom of the beam
      else respawn = ay > CORE_REACH || ax > CORE_REACH; // white: keep tight at the null
      if (respawn) { x = home[o]; y = home[o + 1]; }
      st[o] = x; st[o + 1] = y;
    }
    this.syncPositions(p);
  }

  private syncPositions(p?: ResolvedParams): void {
    const n = this.particleCount;
    const st = this.state;
    const pos = this.positions;
    const role = this.role;
    const hz = this.hz;
    const twist = p?.guideTwist ?? 0; // 0 = pure honest extrusion (face-on byte-identical to the 2D X)
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const po = i * 3;
      const x = st[o], y = st[o + 1], z = hz[i];
      if (twist > 0 && role[i] === ROLE_JET) {
        // guide-field B_z spins the accelerating jet into a helix; phase ∝ ln|y| (linear in time since
        // dy/dt=βy) → steady corkscrew, tight at the base, unwinding at the tip.
        const ay = y < 0 ? -y : y;
        const th = twist * Math.log(Math.max(ay, 1e-3) / 0.04);
        const c = Math.cos(th), s = Math.sin(th);
        pos[po] = (x * c) * RSCALE;
        pos[po + 1] = y * RSCALE;
        pos[po + 2] = (z + x * s) * RSCALE;
      } else {
        pos[po] = x * RSCALE; // inflow horizontal (x), jets vertical (y)
        pos[po + 1] = y * RSCALE;
        pos[po + 2] = z * RSCALE; // the extrusion: X-point → X-line / current-sheet slab
      }
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return this.state;
  }
  loadState(s: Float64Array): void {
    this.state.set(s.subarray(0, this.state.length));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'X-point', stateOffset: 0, stateLength: this.state.length }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.01 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const reconnectionFactory: ArchetypeFactory = {
  id: 'reconnection',
  label: 'Magnetic Reconnection',
  category: 'Plasma',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 80_000,
  particleCountOptions: [40_000, 80_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // density-based X (respawn-teleport would streak trails); revisit short trails after tuning
  create: (config) => new ReconnectionArchetype(config),
};

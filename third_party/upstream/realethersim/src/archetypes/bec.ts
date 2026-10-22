import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Bose–Einstein Condensate. Schrödinger wrote that the multiplicity of minds "is only apparent, in
// truth there is only one mind" — and the equation that bears his name describes matter doing
// exactly that. Cool a trapped gas of bosons below its critical temperature and the atoms stop
// being individuals: their wavefunctions overlap and a macroscopic fraction collapses into ONE
// quantum state, a single wavefunction thousands of atoms wide (Cornell, Wieman & Ketterle, Nobel
// 2001; the condensate obeys the Gross–Pitaevskii equation — a nonlinear Schrödinger equation).
// The cycle here is honest: temperature ramps down and the condensed fraction follows the real
// 3-D-harmonic-trap law N₀/N = 1 − (T/T_c)³ — each atom has a baked threshold and visibly FALLS
// out of its thermal orbit into the central peak as the fraction sweeps past it. The condensed
// atoms then breathe in perfect UNISON (one wavefunction, one motion) while the remaining thermal
// atoms still jitter independently — then the trap reheats and the one dissolves back into the
// many. Colours bake once (ember thermal halo → cyan-white coherent core). Bounded (trapped).
const TAU = Math.PI * 2;
// cooling cycle (seconds at speed 1): ramp down → hold cold (deep condensate) → reheat → hold hot
const T_COOL = 5.0, T_HOLD = 4.0, T_HEAT = 4.0, T_HOT = 2.0;
const T_CYCLE = T_COOL + T_HOLD + T_HEAT + T_HOT;
const T_MAX = 1.6; // starting temperature (units of T_c)
const T_MIN = 0.12;

class BecArchetype implements Archetype {
  readonly id = 'bec';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly u: Float64Array; // condensation threshold (uniform) — join order
  private readonly ampl: Float64Array; // thermal orbit amplitude (Maxwell-ish)
  private readonly phx: Float64Array; // thermal Lissajous phases
  private readonly phy: Float64Array;
  private readonly phz: Float64Array;
  private readonly cx: Float64Array; // condensed ground-state offset (Gaussian blob)
  private readonly cy: Float64Array;
  private readonly cz: Float64Array;
  private cooling = 1;
  private trap = 1;
  private coherence = 0.5;
  private t = 0;
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(64, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.u = new Float64Array(N);
    this.ampl = new Float64Array(N);
    this.phx = new Float64Array(N);
    this.phy = new Float64Array(N);
    this.phz = new Float64Array(N);
    this.cx = new Float64Array(N);
    this.cy = new Float64Array(N);
    this.cz = new Float64Array(N);
    this.seed = config.seed;
    const rng = mulberry32((this.seed ^ 0xbb67ae85) >>> 0);
    for (let i = 0; i < N; i++) {
      this.u[i] = rng(); // who condenses when: u < 1 − (T/Tc)³
      this.ampl[i] = Math.sqrt(-Math.log(Math.max(1e-6, rng()))) * 0.62; // Maxwell-ish orbit sizes
      this.phx[i] = rng() * TAU;
      this.phy[i] = rng() * TAU;
      this.phz[i] = rng() * TAU;
      // ground-state blob: an isotropic Gaussian (Box–Muller), σ ≈ 0.11
      const g = (): number => {
        const a = Math.max(1e-9, rng()), b = rng();
        return Math.sqrt(-2 * Math.log(a)) * Math.cos(TAU * b) * 0.11;
      };
      this.cx[i] = g(); this.cy[i] = g(); this.cz[i] = g();
      // colour by join order: the coherent core cyan-white, the reluctant thermal halo ember-orange
      const w = Math.pow(this.u[i], 0.7);
      const bri = 0.75 + 0.5 * rng();
      this.colors[i * 3] = (0.45 + 0.6 * w) * bri;
      this.colors[i * 3 + 1] = (0.85 - 0.35 * w) * bri;
      this.colors[i * 3 + 2] = (1.05 - 0.6 * w) * bri;
    }
    this.readParams(config.params);
    // start just into the cooldown: the offline thumbnail capture (~3.2 sim-seconds) lands late in the
    // ramp — bright coherent core PLUS the ember halo of not-yet-condensed atoms, the many becoming one
    // mid-act — and a live visitor arrives watching the first cooling from the hot cloud
    this.t = 0.7;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.cooling = p.cooling ?? 1;
    this.trap = p.trap ?? 1;
    this.coherence = p.coherence ?? 0.5;
  }

  // temperature over the cycle, in units of T_c
  private temperature(tau: number): number {
    if (tau < T_COOL) {
      const f = tau / T_COOL;
      return T_MAX + (T_MIN - T_MAX) * (f * f * (3 - 2 * f)); // smooth ramp down
    }
    if (tau < T_COOL + T_HOLD) return T_MIN;
    if (tau < T_COOL + T_HOLD + T_HEAT) {
      const f = (tau - T_COOL - T_HOLD) / T_HEAT;
      return T_MIN + (T_MAX - T_MIN) * (f * f * (3 - 2 * f));
    }
    return T_MAX;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    const tau = (this.t * this.cooling) % T_CYCLE;
    const T = this.temperature(tau);
    const frac = T >= 1 ? 0 : 1 - T * T * T; // N₀/N = 1 − (T/T_c)³ — the real 3-D trap law
    const jitter = Math.sqrt(Math.max(T, 0.02)); // thermal orbit size shrinks as √T
    // slightly anisotropic trap → lively Lissajous cloud
    const wx = 1.9 * this.trap, wy = 2.12 * this.trap, wz = 2.55 * this.trap;
    const tt = this.t;
    // ONE breathing phase for the whole condensate — a single wavefunction moves as a single thing
    const breathe = 1 + this.coherence * 0.16 * Math.sin(2 * wx * tt);
    for (let i = 0; i < N; i++) {
      const A = this.ampl[i] * jitter;
      const tx = A * Math.cos(wx * tt + this.phx[i]);
      const ty = A * 0.85 * Math.cos(wy * tt + this.phy[i]);
      const tz = A * 0.75 * Math.cos(wz * tt + this.phz[i]);
      // per-atom in-fall: blends from its thermal orbit into the coherent core as frac crosses u_i
      const k = Math.max(0, Math.min(1, (frac - this.u[i]) / 0.07));
      const s = k * k * (3 - 2 * k);
      const o = i * 3;
      pos[o] = tx + (this.cx[i] * breathe - tx) * s;
      pos[o + 1] = ty + (this.cy[i] * breathe - ty) * s;
      pos[o + 2] = tz + (this.cz[i] * breathe - tz) * s;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Bose–Einstein condensate (one wavefunction)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.008 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const becFactory: ArchetypeFactory = {
  id: 'bec',
  label: 'Bose–Einstein Condensate',
  category: 'Matter',
  kind: 'flow',
  params: [
    { key: 'cooling', label: 'cycle speed', min: 0.2, max: 3, step: 0.05, default: 1 }, // cool→hold→reheat rate
    { key: 'trap', label: 'trap frequency', min: 0.4, max: 2.5, step: 0.05, default: 1 },
    { key: 'coherence', label: 'breathing', min: 0, max: 1.5, step: 0.05, default: 0.5 }, // unison mode amplitude
  ],
  defaultParticleCount: 90_000,
  particleCountOptions: [40_000, 90_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the condensing cloud IS the visual
  bloom: 0.5, // the coherent core should shine like the one thing it is
  create: (config) => new BecArchetype(config),
};

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

// Kuramoto–Sivashinsky: uₜ = −u·uₓ − uₓₓ − uₓₓₓₓ on a periodic domain [0, L]. The −uₓₓ term pumps
// energy into long waves, −uₓₓₓₓ dissipates short ones, and the nonlinearity couples them → genuine
// spatiotemporal CHAOS (the canonical flame-front / falling-film instability). Rendered as a scrolling
// SPACE–TIME plot: x = space, z = time (newest at the front), y = field height u.
//
// Integrated in Fourier space with ETDRK2 (Cox–Matthews). The stiff linear part λ(k)=k²−k⁴ is solved
// EXACTLY via the integrating factor E=e^{λ·dt}, so the 4th-order term imposes NO explicit-stability
// limit — which is exactly why a naive finite-difference scheme blows up and this one doesn't. The DFT
// is hand-rolled (O(N²), N≤256), no dependencies. Real signal stays real because every KS operation
// preserves Hermitian symmetry of the spectrum.
const TWO_PI = Math.PI * 2;
const EXTENT = 6; // render span in x and z → [−3, 3]

const PARAM_SPEC: ParamSpec[] = [
  { key: 'domainL', label: 'L (domain)', min: 16, max: 120, step: 0.5, default: 60 }, // chaos onset ~L≈22
  { key: 'relief', label: 'relief', min: 0, max: 1.5, step: 0.01, default: 0.7 }, // y height scale (cosmetic)
  { key: 'spaceN', label: 'resolution', min: 64, max: 256, step: 64, default: 128, options: { '64': 64, '128': 128, '256': 256 }, rebuild: true },
  // history depth (M, the scroll length) is derived from the particle-count selector ÷ resolution.
];

class KuramotoSivashinskyArchetype implements Archetype {
  readonly id = 'kuramotoSivashinsky';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly N: number; // spatial grid / DFT size
  private readonly M: number; // history rows (time depth)
  private dt: number;
  private L: number;
  private relief: number;

  private readonly cosTab: Float64Array; // DFT tables for angle a = −2π·k·n/N (depend on N only)
  private readonly sinTab: Float64Array;
  private readonly kx: Float64Array; // wavenumbers (depend on L) — Nyquist zeroed
  private readonly mask: Float64Array; // 2/3 dealias
  private readonly E: Float64Array; // e^{λ·dt}
  private readonly Q: Float64Array; // (E−1)/λ
  private readonly f2: Float64Array; // (E−1−λdt)/(λ²·dt)
  private readonly u: Float64Array; // field (authoritative state)
  private readonly ur: Float64Array; private readonly ui: Float64Array;
  private readonly ar: Float64Array; private readonly ai: Float64Array;
  private readonly aReal: Float64Array;
  private readonly Nur: Float64Array; private readonly Nui: Float64Array;
  private readonly Nar: Float64Array; private readonly Nai: Float64Array;
  private readonly sq: Float64Array; private readonly tr: Float64Array; private readonly ti: Float64Array;
  private readonly hist: Float64Array; // ring buffer of the last M field snapshots
  private head = 0;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  constructor(config: ArchetypeConfig) {
    const N = Math.round(config.params.spaceN ?? 128);
    const M = Math.max(20, Math.round(config.particleCount / N)); // scroll length from count ÷ resolution
    this.N = N;
    this.M = M;
    this.particleCount = N * M;
    this.dt = config.params.dt ?? 0.25;
    this.L = config.params.domainL ?? 60;
    this.relief = config.params.relief ?? 0.7;

    this.cosTab = new Float64Array(N * N);
    this.sinTab = new Float64Array(N * N);
    for (let k = 0; k < N; k++) {
      for (let n = 0; n < N; n++) {
        const a = (-TWO_PI * k * n) / N;
        this.cosTab[k * N + n] = Math.cos(a);
        this.sinTab[k * N + n] = Math.sin(a);
      }
    }
    this.kx = new Float64Array(N);
    this.mask = new Float64Array(N);
    this.E = new Float64Array(N);
    this.Q = new Float64Array(N);
    this.f2 = new Float64Array(N);
    this.u = new Float64Array(N);
    this.ur = new Float64Array(N); this.ui = new Float64Array(N);
    this.ar = new Float64Array(N); this.ai = new Float64Array(N);
    this.aReal = new Float64Array(N);
    this.Nur = new Float64Array(N); this.Nui = new Float64Array(N);
    this.Nar = new Float64Array(N); this.Nai = new Float64Array(N);
    this.sq = new Float64Array(N); this.tr = new Float64Array(N); this.ti = new Float64Array(N);
    this.hist = new Float64Array(N * M);
    this.positions = new Float32Array(N * M * 3);
    this.colors = new Float32Array(N * M * 3);

    this.rebuildSpectral();

    const rng = mulberry32(config.seed);
    for (let n = 0; n < N; n++) {
      const x = (this.L * n) / N;
      this.u[n] = 0.6 * Math.cos((TWO_PI * x) / this.L) + 0.1 * Math.sin((4 * Math.PI * x) / this.L + 1) + (rng() - 0.5) * 0.02;
    }
    for (let r = 0; r < M; r++) this.hist.set(this.u, r * N); // non-degenerate frame 0
    this.writePositions();
  }

  // kx / mask depend on L; E / Q / f2 depend on kx and dt. Cheap O(N) — recomputed on L/dt change.
  private rebuildSpectral(): void {
    const N = this.N, L = this.L, dt = this.dt;
    for (let j = 0; j < N; j++) {
      let m = j <= N / 2 ? j : j - N;
      if (j === N / 2) m = 0; // zero Nyquist for the odd 1st-derivative in the nonlinear term
      this.kx[j] = (TWO_PI * m) / L;
      this.mask[j] = Math.abs(m) > N / 3 ? 0 : 1;
      const k2 = this.kx[j] * this.kx[j];
      const lam = k2 - k2 * k2; // λ = k² − k⁴
      this.E[j] = Math.exp(lam * dt);
      const Ld = lam * dt;
      if (Math.abs(Ld) < 1e-8) {
        this.Q[j] = dt;
        this.f2[j] = dt / 2;
      } else {
        this.Q[j] = (this.E[j] - 1) / lam;
        this.f2[j] = (this.E[j] - 1 - Ld) / (lam * lam * dt);
      }
    }
  }

  private fwd(src: Float64Array, re: Float64Array, im: Float64Array): void {
    const N = this.N, ct = this.cosTab, st = this.sinTab;
    for (let k = 0; k < N; k++) {
      let r = 0, i = 0;
      const b = k * N;
      for (let n = 0; n < N; n++) { const x = src[n]; r += x * ct[b + n]; i += x * st[b + n]; }
      re[k] = r; im[k] = i;
    }
  }
  private inv(re: Float64Array, im: Float64Array, dst: Float64Array): void {
    const N = this.N, ct = this.cosTab, st = this.sinTab;
    for (let n = 0; n < N; n++) {
      let r = 0;
      // sinTab holds sin(−angle), so this `+ im·sinTab` is the correct −im·sin of the real inverse.
      for (let k = 0; k < N; k++) r += re[k] * ct[k * N + n] + im[k] * st[k * N + n];
      dst[n] = r / N;
    }
  }
  // N(u) = −½·∂ₓ(u²) in spectral space = −½·i·k·FFT(u²)
  private nonlin(uReal: Float64Array, outr: Float64Array, outi: Float64Array): void {
    const N = this.N;
    for (let n = 0; n < N; n++) this.sq[n] = uReal[n] * uReal[n];
    this.fwd(this.sq, this.tr, this.ti);
    for (let j = 0; j < N; j++) {
      const kk = this.kx[j], mj = this.mask[j];
      outr[j] = 0.5 * kk * this.ti[j] * mj; // (tr + i·ti)·(−½ i k)
      outi[j] = -0.5 * kk * this.tr[j] * mj;
    }
  }
  private ksStep(): void {
    const N = this.N;
    this.fwd(this.u, this.ur, this.ui);
    this.nonlin(this.u, this.Nur, this.Nui);
    for (let j = 0; j < N; j++) {
      this.ar[j] = this.E[j] * this.ur[j] + this.Q[j] * this.Nur[j];
      this.ai[j] = this.E[j] * this.ui[j] + this.Q[j] * this.Nui[j];
    }
    this.inv(this.ar, this.ai, this.aReal);
    this.nonlin(this.aReal, this.Nar, this.Nai);
    for (let j = 0; j < N; j++) {
      this.ur[j] = this.ar[j] + (this.Nar[j] - this.Nur[j]) * this.f2[j];
      this.ui[j] = this.ai[j] + (this.Nai[j] - this.Nui[j]) * this.f2[j];
    }
    this.inv(this.ur, this.ui, this.u);
  }

  step(_dt: number, p: ResolvedParams): void {
    this.relief = p.relief ?? this.relief;
    const L = p.domainL ?? this.L;
    const dt = p.dt ?? this.dt;
    if (L !== this.L || dt !== this.dt) {
      this.L = L;
      this.dt = dt;
      this.rebuildSpectral(); // dt is baked into E/Q/f2; rebuild only when L or dt actually changes
    }
    this.ksStep();
    this.hist.set(this.u, this.head * this.N);
    this.head = (this.head + 1) % this.M;
    this.writePositions();
  }

  private writePositions(): void {
    const N = this.N, M = this.M, hist = this.hist, pos = this.positions, col = this.colors, relief = this.relief;
    const cellX = EXTENT / Math.max(1, N - 1), halfX = EXTENT / 2;
    const cellZ = EXTENT / Math.max(1, M - 1), halfZ = EXTENT / 2;
    for (let r = 0; r < M; r++) {
      const ringRow = ((this.head + r) % M) * N; // r=0 oldest … r=M−1 newest
      for (let c = 0; c < N; c++) {
        const i = r * N + c, o = i * 3;
        const uval = hist[ringRow + c];
        pos[o] = c * cellX - halfX; // x = space
        pos[o + 1] = uval * relief; // y = field height
        pos[o + 2] = r * cellZ - halfZ; // z = time
        const t = Math.min(1, Math.max(0, (uval + 2.8) / 5.6)); // u ∈ ~[−2.8, 2.8] → teal→white
        col[o] = 0.04 + 0.96 * t;
        col[o + 1] = 0.55 + 0.4 * t;
        col[o + 2] = 0.55 + 0.4 * t;
      }
    }
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return this.u; }
  loadState(s: Float64Array): void { this.u.set(s.subarray(0, this.u.length)); this.writePositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Kuramoto–Sivashinsky (L=${this.L.toFixed(0)})`, stateOffset: 0, stateLength: this.N }];
  }
  renderHint(): RenderHint { return { geometry: 'points', exposesField: true, pointSize: 0.02 }; }
  readField(): { texture: unknown; width: number; height: number } { return { texture: this.hist, width: this.N, height: this.M }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const kuramotoSivashinskyFactory: ArchetypeFactory = {
  id: 'kuramotoSivashinsky',
  label: 'Kuramoto–Sivashinsky',
  category: 'Field',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 25_600, // grid = resolution(N) × history(M); count selector sets the history depth
  particleCountOptions: [12_800, 25_600, 51_200], // → ≈100 / 200 / 400 scroll rows at N=128
  defaultDt: 0.25,
  defaultTrail: 0, // the scroll IS the visualization
  create: (config) => new KuramotoSivashinskyArchetype(config),
};

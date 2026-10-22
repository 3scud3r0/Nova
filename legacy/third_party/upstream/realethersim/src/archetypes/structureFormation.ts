import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Structure Formation. How the universe went from almost perfectly smooth (the CMB's one-part-in-
// 100,000 ripples) to the cosmic web of filaments and voids we see today. This is the ZEL'DOVICH
// APPROXIMATION (1970) — first-order Lagrangian perturbation theory, the textbook model of large-
// scale structure: every particle simply drifts along a straight line, x(t) = q + D(t)·ψ(q), where
// q is its birthplace on a uniform grid, ψ(q) is a displacement field set once by the primordial
// fluctuations, and D(t) is the linear GROWTH FACTOR of a ΛCDM universe. As D grows, matter drains
// out of the voids onto sheets ("Zel'dovich pancakes"), then filaments, then nodes — the web
// assembles. And because dark energy freezes the growth factor at late times, the web stops
// assembling a few tens of Gyr from now: the sim clock (in real Gyr) lets you watch that happen.
// ψ is baked once per particle (the modes are analytic), so 13.8 Gyr of cosmology costs one scalar
// D(t) per frame plus a multiply-add per particle. Bounded (D saturates; displacements are finite).
const BOX = 1.25; // comoving half-box (render units)
const N_MODES = 48; // spectral-synthesis modes for the displacement potential
const T_NOW = 13.8; // age of the universe today (Gyr)
const CYCLE = 40; // replay after 40 Gyr — growth is long frozen by then (dark energy domination)
const OM = 0.315, OL = 0.685; // ΛCDM density parameters (Planck-ish)
const TAU = Math.PI * 2;

// ΛCDM scale factor a(t): matter + Λ flat universe, a(T_NOW) = 1.
// a(t) = (Ωm/ΩΛ)^(1/3) · sinh^(2/3)( t / tΛ ), with tΛ chosen so a(13.8 Gyr) = 1.
const T_LAMBDA = T_NOW / Math.asinh(Math.sqrt(OL / OM)); // ≈ 13.8 / asinh(1.474) ≈ 11.7 Gyr
function scaleFactor(tGyr: number): number {
  const s = Math.sinh(Math.max(tGyr, 1e-4) / T_LAMBDA);
  return Math.cbrt((OM / OL) * s * s);
}
// Linear growth factor D(a): Carroll, Press & Turner (1992) fitting form, normalised D(a=1)=1.
function growthRaw(a: number): number {
  const a3 = a * a * a;
  const om = OM / (OM + OL * a3); // Ωm(a) for flat ΛCDM
  const ol = 1 - om;
  const g = (2.5 * om) / (Math.pow(om, 4 / 7) - ol + (1 + om / 2) * (1 + ol / 70));
  return a * g;
}
const D_NORM = growthRaw(1);
function growth(tGyr: number): number {
  return growthRaw(scaleFactor(tGyr)) / D_NORM; // = 1 today, → ~1.3–1.4 frozen ceiling under Λ
}

class StructureFormationArchetype implements Archetype {
  readonly id = 'structureFormation';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly qx: Float64Array; // Lagrangian birthplaces (uniform jittered grid)
  private readonly qy: Float64Array;
  private readonly qz: Float64Array;
  private readonly dx: Float64Array; // baked displacement field ψ(q), normalised
  private readonly dy: Float64Array;
  private readonly dz: Float64Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private strength = 1;
  private speed = 0.5;
  private t = 5; // start mid-assembly (see factory note); replay covers the full arc from T+0
  private buildKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(8, config.particleCount);
    this.particleCount = N;
    this.qx = new Float64Array(N); this.qy = new Float64Array(N); this.qz = new Float64Array(N);
    this.dx = new Float64Array(N); this.dy = new Float64Array(N); this.dz = new Float64Array(N);
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.seed = config.seed;
    this.rebuild(config.params);
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round((p.largeScale ?? 0.5) * 100)}`;
  }

  // Bake the primordial displacement field: a sum of random plane-wave potential modes. ψ = ∇φ and
  // the convergence −∇·ψ are both analytic per mode, so we get the field AND each particle's destiny
  // (collapsing into the web vs draining into a void) exactly, once, at build time.
  private rebuild(p: ResolvedParams): void {
    this.strength = p.strength ?? 1;
    this.speed = p.speed ?? 0.5;
    this.buildKey = this.keyOf(p);
    const largeScale = p.largeScale ?? 0.5; // spectral tilt: high → power in the biggest waves
    const rng = mulberry32((this.seed ^ 0x8f1bbcdc) >>> 0);
    const N = this.particleCount;
    // ── modes of the displacement potential φ(q) = Σ A cos(k·q + χ) ──
    const kx = new Float64Array(N_MODES), ky = new Float64Array(N_MODES), kz = new Float64Array(N_MODES);
    const amp = new Float64Array(N_MODES), phs = new Float64Array(N_MODES);
    for (let m = 0; m < N_MODES; m++) {
      // isotropic direction; wavenumber from a few box-scale waves up to ~6× smaller texture
      const u = rng() * 2 - 1, az = rng() * TAU;
      const su = Math.sqrt(Math.max(0, 1 - u * u));
      const kmag = (TAU / (2 * BOX)) * (1 + 5 * Math.pow(rng(), 1.5)); // |k| ∈ [k_box, 6·k_box]
      kx[m] = kmag * su * Math.cos(az); ky[m] = kmag * su * Math.sin(az); kz[m] = kmag * u;
      // amplitude of ψ (= |∇φ|) per mode: ∝ k^{-tilt} → large-scale modes dominate the flow
      const tilt = 1 + 2.2 * largeScale;
      amp[m] = Math.pow(kmag / (TAU / (2 * BOX)), -tilt) * (0.5 + rng());
      phs[m] = rng() * TAU;
    }
    // ── per particle: jittered-grid birthplace, ψ(q), and convergence −∇·ψ (its destiny) ──
    const side = Math.max(2, Math.round(Math.cbrt(N)));
    const cell = (2 * BOX) / side;
    let sumPsi2 = 0;
    const conv = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const gx = i % side, gy = Math.floor(i / side) % side, gz = Math.floor(i / (side * side)) % side;
      const x = -BOX + (gx + rng()) * cell;
      const y = -BOX + (gy + rng()) * cell;
      const z = -BOX + (gz + rng()) * cell;
      this.qx[i] = x; this.qy[i] = y; this.qz[i] = z;
      let px = 0, py = 0, pz = 0, dv = 0;
      for (let m = 0; m < N_MODES; m++) {
        const ph = kx[m] * x + ky[m] * y + kz[m] * z + phs[m];
        const s = Math.sin(ph) * amp[m];
        const kk = Math.hypot(kx[m], ky[m], kz[m]);
        // ψ_m = −A·k̂·sin(k·q+χ)  (unit-normalised k̂ keeps ψ amplitude ∼ A per mode)
        px -= (kx[m] / kk) * s; py -= (ky[m] / kk) * s; pz -= (kz[m] / kk) * s;
        dv -= kk * Math.cos(ph) * amp[m]; // ∇·ψ (collapse where negative)
      }
      this.dx[i] = px; this.dy[i] = py; this.dz[i] = pz;
      conv[i] = -dv; // convergence: positive → this particle ends up on the web
      sumPsi2 += px * px + py * py + pz * pz;
    }
    // Normalise by the CONVERGENCE, not the displacement: caustics (shell-crossing) form where
    // D·|∇·ψ| reaches 1, so we scale ψ so the rms convergence is ≈1.25 at D=1 — by today the 1σ
    // regions have crossed and the box is a true web of caustic sheets, filaments and drained voids.
    void sumPsi2;
    let sumC2 = 0;
    for (let i = 0; i < N; i++) sumC2 += conv[i] * conv[i];
    const convRms = Math.sqrt(sumC2 / N) || 1;
    const target = 1.25 / convRms;
    let cmax = 1e-6;
    for (let i = 0; i < N; i++) cmax = Math.max(cmax, Math.abs(conv[i]));
    for (let i = 0; i < N; i++) {
      this.dx[i] *= target; this.dy[i] *= target; this.dz[i] *= target;
      // destiny colours: collapsing matter warm-bright (it will BE the glowing web), voids dim blue
      const c = Math.max(-1, Math.min(1, conv[i] / (0.55 * cmax)));
      const w = Math.max(0, c), v = Math.max(0, -c);
      const bri = 0.2 + 1.7 * w * w + 0.2 * rng();
      const r0 = 0.55 + 0.45 * w - 0.25 * v;
      const g0 = 0.6 + 0.25 * w - 0.2 * v;
      const b0 = 0.9 - 0.15 * w;
      this.colors[i * 3] = r0 * bri;
      this.colors[i * 3 + 1] = g0 * bri;
      this.colors[i * 3 + 2] = b0 * bri;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const D = growth(this.t) * this.strength;
    const pos = this.positions;
    const N = this.particleCount;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      pos[o] = this.qx[i] + D * this.dx[i];
      pos[o + 1] = this.qy[i] + D * this.dy[i];
      pos[o + 2] = this.qz[i] + D * this.dz[i];
    }
  }

  step(dt: number, p: ResolvedParams): void {
    if (this.keyOf(p) !== this.buildKey) { this.rebuild(p); return; }
    this.strength = p.strength ?? 1;
    this.speed = p.speed ?? 0.5;
    this.t += dt * this.speed;
    if (this.t > CYCLE) this.t = 0.02; // replay from just after the beginning
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 5; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: "Structure formation (Zel'dovich)", stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.006 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const structureFormationFactory: ArchetypeFactory = {
  id: 'structureFormation',
  label: 'Structure Formation',
  category: 'Cosmology',
  kind: 'flow',
  params: [
    { key: 'largeScale', label: 'large-scale power', min: 0, max: 1, step: 0.02, default: 0.5, rebuild: true }, // spectral tilt
    { key: 'strength', label: 'clustering', min: 0.3, max: 2, step: 0.05, default: 1 }, // displacement amplitude (live)
    { key: 'speed', label: 'Gyr / second', min: 0.1, max: 3, step: 0.05, default: 0.5 }, // cosmic time rate
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the assembling web IS the visual
  // Sim clock in ABSOLUTE cosmic time: model t is Gyr since the Big Bang (T+13.8 Gyr = today; growth
  // visibly freezes past ~T+20 Gyr as dark energy takes over). Starts mid-assembly at T+5 so the
  // first thing a visitor (and the thumbnail) sees is a web forming, not a featureless haze; each
  // replay then runs the full arc from T+0.
  clock: { scale: 1, unit: 'Gyr', cycle: CYCLE, offset: 5 }, // offset matches the T+5 starting point
  create: (config) => new StructureFormationArchetype(config),
};

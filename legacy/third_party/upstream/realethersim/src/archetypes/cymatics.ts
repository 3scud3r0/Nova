import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { besselJn, besselJzero } from './bessel';

// Cymatics / Faraday waves. A vibrated circular cell of water doesn't ring in one pure mode like the
// Chladni drumhead — a parametric (Faraday) drive excites the whole BAND of circular eigenmodes near
// resonance at once, and their superposition is the dense moiré of rings, spokes and interference
// fringes you see in cymatics videos. We sum the K modes uₘₙ = Jₘ(λₘₙ·r)·cos(mθ) whose eigenvalue λ
// sits nearest a drive frequency Ω (weighted by how close), restricting m to multiples of a symmetry n
// so the rosette is crisply n-fold. Each mode beats at its own ω∝λ, so the fringe field shimmers and
// drifts (alive, not a static breathing lobe). Spatial factors are evaluated once per mode-change;
// per frame is just Σ cos(ωₖt). Viewed from above as a glowing intensity plate. Bounded ∀t.
const TAU = Math.PI * 2;
const SCALE = 2.5; // disk radius in render units

const PARAM_SPEC: ParamSpec[] = [
  { key: 'drive', label: 'drive freq', min: 3, max: 40, step: 0.5, default: 14, rebuild: true }, // Ω: which mode band resonates
  { key: 'modes', label: 'modes', min: 3, max: 16, step: 1, default: 8, rebuild: true }, // K superposed wavefronts
  { key: 'symmetry', label: 'symmetry n', min: 1, max: 8, step: 1, default: 5, rebuild: true }, // m ≡ 0 (mod n) → n-fold rosette
  { key: 'damping', label: 'damping', min: 0, max: 1, step: 0.02, default: 0.25, rebuild: true }, // band width: weight aₖ=exp(−damping·|λₖ−Ω|)
  { key: 'relief', label: 'relief', min: 0, max: 1.2, step: 0.02, default: 0.22 },
  { key: 'speed', label: 'frequency', min: 0, max: 3, step: 0.05, default: 1 },
];

class CymaticsArchetype implements Archetype {
  readonly id = 'cymatics';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly px: Float64Array; // fixed disk x (render units)
  private readonly pz: Float64Array; // fixed disk z
  private spatial: Float32Array = new Float32Array(0); // [k*N + i] = aₖ·Jₘ(λr)·cos(mθ+φ) per mode per point
  private omega: Float64Array = new Float64Array(0); // per-mode temporal frequency ωₖ
  private nModes = 0;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private relief = 0.4;
  private speed = 1;
  private t = 0;
  private modeKey = '';

  constructor(config: ArchetypeConfig) {
    const n = config.particleCount;
    this.particleCount = n;
    this.px = new Float64Array(n);
    this.pz = new Float64Array(n);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.relief = config.params.relief ?? 0.22;
    this.speed = config.params.speed ?? 1;
    this.rebuild(config.params);
  }

  private rebuild(p: ResolvedParams): void {
    const drive = p.drive ?? 14;
    const K = Math.max(1, Math.round(p.modes ?? 8));
    const nSym = Math.max(1, Math.round(p.symmetry ?? 5));
    const damping = p.damping ?? 0.25;
    this.modeKey = `${drive},${K},${nSym},${damping}`;
    const N = this.particleCount;

    // 1) build the area-uniform polar grid (rings × spokes ∝ circumference) — same layout as drumhead,
    //    which keeps angular/radial structure crisp (phyllotaxis would smear it).
    const rings = Math.max(16, Math.round(Math.sqrt(N / Math.PI)));
    let i = 0;
    const rr = new Float64Array(N); // radius fraction per point (for the Bessel eval below)
    const th = new Float64Array(N);
    for (let j = 0; j < rings && i < N; j++) {
      const rad = (j + 0.5) / rings;
      const spokes = Math.max(3, Math.round(TAU * (j + 0.5)));
      for (let k = 0; k < spokes && i < N; k++, i++) {
        const a = (k / spokes) * TAU;
        this.px[i] = rad * Math.cos(a) * SCALE;
        this.pz[i] = rad * Math.sin(a) * SCALE;
        rr[i] = rad;
        th[i] = a;
      }
    }
    for (; i < N; i++) { this.px[i] = 0; this.pz[i] = 0; rr[i] = 0; th[i] = 0; }

    // 2) pick the K eigenmodes (m a multiple of nSym, n-th radial) whose λ is closest to the drive Ω
    type Mode = { m: number; lam: number };
    const cand: Mode[] = [];
    for (let m = 0; m <= nSym * 10; m += nSym) {
      for (let nr = 1; nr <= 14; nr++) cand.push({ m, lam: besselJzero(m, nr) });
    }
    cand.sort((x, y) => Math.abs(x.lam - drive) - Math.abs(y.lam - drive));
    const chosen = cand.slice(0, K);

    // 3) per-mode weight + per-point spatial factor; track the build-time amplitude envelope for colour
    this.nModes = chosen.length;
    this.spatial = new Float32Array(this.nModes * N);
    this.omega = new Float64Array(this.nModes);
    for (let c = 0; c < this.nModes; c++) {
      const { m, lam } = chosen[c];
      // resonance weight × mild down-weight of the pure-radial (m=0) mode so the n-fold rosette reads
      // over the concentric rings
      const ak = Math.exp(-damping * Math.abs(lam - drive)) * (m === 0 ? 0.55 : 1);
      this.omega[c] = lam; // beat at the eigenfrequency (∝ λ)
      const base = c * N;
      for (let q = 0; q < N; q++) {
        this.spatial[base + q] = ak * besselJn(m, lam * rr[q]) * Math.cos(m * th[q]);
      }
    }

    // 4) colour ONCE by a SNAPSHOT of the field with all modes in phase (t=0) — this is the actual
    //    cymatic figure (nodes vs antinodes), which the smooth envelope would have washed out. Cool
    //    water palette: dark indigo nodes → cyan → white antinode crests, gained up (1px points need
    //    brightness). The relief then animates the figure so it shimmers like a driven water film.
    const snap = new Float64Array(N);
    let sabs = 0;
    for (let q = 0; q < N; q++) {
      let u = 0;
      for (let c = 0; c < this.nModes; c++) u += this.spatial[c * N + q];
      snap[q] = u;
      sabs += Math.abs(u);
    }
    // normalise by the mean amplitude (robust — a few hot antinodes don't crush the whole field to black)
    const scale = Math.max(1e-6, (sabs / N) * 0.65);
    const col = this.colors;
    for (let q = 0; q < N; q++) {
      const e = Math.min(1, Math.abs(snap[q]) / scale);
      col[q * 3] = 0.07 + 0.88 * e * e; // red leads at the brightest → white antinode crest
      col[q * 3 + 1] = 0.28 + 0.68 * e; // cyan body
      col[q * 3 + 2] = 0.5 + 0.48 * e; // bright indigo→cyan floor so the figure glows on black
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const N = this.particleCount;
    const pos = this.positions;
    const sp = this.spatial;
    const om = this.omega;
    const K = this.nModes;
    const t = this.t * this.speed;
    const relief = this.relief;
    // per-frame superposition u_i = Σ_k sₖ,ᵢ·cos(ωₖ t); y = u·relief (the shimmering interference field)
    for (let q = 0; q < N; q++) {
      let u = 0;
      for (let c = 0; c < K; c++) u += sp[c * N + q] * Math.cos(om[c] * t);
      const o = q * 3;
      pos[o] = this.px[q];
      pos[o + 1] = u * relief;
      pos[o + 2] = this.pz[q];
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const nextKey = `${p.drive ?? 14},${Math.round(p.modes ?? 8)},${Math.round(p.symmetry ?? 5)},${p.damping ?? 0.25}`;
    if (nextKey !== this.modeKey) {
      this.relief = p.relief ?? 0.22;
      this.speed = p.speed ?? 1;
      this.rebuild(p);
      return;
    }
    this.relief = p.relief ?? 0.22;
    this.speed = p.speed ?? 1;
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return new Float64Array([this.t]);
  }
  loadState(s: Float64Array): void {
    this.t = s[0] ?? 0;
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Cymatic field (${this.nModes} modes)`, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.017 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const cymaticsFactory: ArchetypeFactory = {
  id: 'cymatics',
  label: 'Cymatic Plate',
  category: 'Field',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 160_000,
  particleCountOptions: [60_000, 160_000, 300_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the interference field IS the visual
  create: (config) => new CymaticsArchetype(config),
};

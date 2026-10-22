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
import { hslToRgb } from '../core/color';

// Cosmic Web — the large-scale structure of the universe via the ZEL'DOVICH APPROXIMATION (first-order
// Lagrangian perturbation theory), not a full N-body force solve. Lay particles on a regular Lagrangian
// grid q. Build one Gaussian random displacement field ψ(q) = −∇φ from a band-limited power spectrum
// (synthesized as a sum of Fourier modes, so no FFT needed — fully deterministic from a seed). Every
// particle then rides a STRAIGHT, frozen-in-time trajectory x(q) = q + D·ψ(q), where D is the linear
// growth factor (a single "time/amplitude" dial). As D grows the smooth sheet folds: matter streams
// down-gradient and piles up into VOIDS → WALLS → FILAMENTS → blazing halo NODES. Each particle is
// tinted, once, by its local OVERDENSITY δ(q) = −∇·ψ (the linear density contrast it is destined for —
// a fixed Lagrangian attribute, so this is exactly compatible with the colour-uploaded-once render
// model): underdense voids fade to near-black, the down-gradient pile-ups glow orange along the
// filaments, and the densest filament intersections blaze yellow-white — the cosmic web.
const L = 1.5; // Lagrangian grid half-width in q-space
const K_MODES = 256; // Fourier modes synthesizing the Gaussian displacement field
const TARGET_RMS = 0.34; // RMS displacement magnitude at D=1 → sets how hard the web collapses
const BREATHE = 0.04; // ± fraction the growth factor slowly oscillates → the web subtly "breathes"
const MAXD = 1.1; // clamp on per-particle displacement magnitude → render stays bounded
const MAXD2 = MAXD * MAXD;

const PARAM_SPEC: ParamSpec[] = [
  { key: 'field', label: 'field', min: 1, max: 200, step: 1, default: 7, rebuild: true }, // seed: which universe
  { key: 'growth', label: 'growth D', min: 0.3, max: 2.0, step: 0.02, default: 1.0 }, // collapse amplitude (live)
  { key: 'webScale', label: 'web scale', min: 0.5, max: 2.0, step: 0.05, default: 1.0, rebuild: true }, // structure freq
  { key: 'contrast', label: 'contrast', min: 0.2, max: 0.7, step: 0.01, default: 0.4, rebuild: true }, // void fraction
];

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

class CosmicWebArchetype implements Archetype {
  readonly id = 'cosmicWeb';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly W: number;
  private readonly qpos: Float32Array; // Lagrangian (initial) positions
  private readonly psi: Float32Array; // frozen displacement field ψ(q), normalized
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private effectiveD = 0;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const w = Math.max(8, Math.round(Math.cbrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w * w;
    const n = this.particleCount;
    this.qpos = new Float32Array(n * 3);
    this.psi = new Float32Array(n * 3);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.build(config);
    this.effectiveD = config.params.growth ?? 1.0; // start fully formed (so a static frame already reads)
    this.syncPositions();
  }

  private build(config: ArchetypeConfig): void {
    const w = this.W;
    const n = this.particleCount;
    const field = Math.round(config.params.field ?? 7);
    const webScale = config.params.webScale ?? 1.0;
    const contrast = config.params.contrast ?? 0.4;
    const rng = mulberry32((config.seed ^ 0x9e3779b9) + field * 2654435761);
    const gauss = (): number => {
      let u = 0;
      while (u <= 1e-9) u = rng();
      const v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    // --- K Fourier modes of the displacement field ψ = −∇φ (curl-free ⇒ direction = k̂) ---
    const K = K_MODES;
    const ux = new Float64Array(K), uy = new Float64Array(K), uz = new Float64Array(K); // unit k-direction
    const kx = new Float64Array(K), ky = new Float64Array(K), kz = new Float64Array(K); // k vector
    const kmag = new Float64Array(K), amp = new Float64Array(K), phase = new Float64Array(K);
    const kCut = 9.0 * webScale; // peak structure frequency (≈ filaments-per-box)
    const kMin = 3.0 * webScale, kMax = 24.0 * webScale;
    for (let m = 0; m < K; m++) {
      let dx = gauss(), dy = gauss(), dz = gauss();
      let dl = Math.hypot(dx, dy, dz);
      if (dl < 1e-9) { dx = 1; dy = 0; dz = 0; dl = 1; }
      dx /= dl; dy /= dl; dz /= dl;
      const km = kMin + (kMax - kMin) * rng();
      ux[m] = dx; uy[m] = dy; uz[m] = dz;
      kx[m] = dx * km; ky[m] = dy * km; kz[m] = dz * km; kmag[m] = km;
      phase[m] = rng() * 2 * Math.PI;
      // density power spectrum P(k)=k·exp(−(k/kCut)²); displacement amplitude ∝ √P/k × Gaussian draw
      const Pk = km * Math.exp(-((km / kCut) * (km / kCut)));
      amp[m] = (gauss() * Math.sqrt(Math.max(Pk, 0))) / km;
    }

    // --- evaluate ψ(q) and the overdensity δ(q) = −∇·ψ per particle ---
    const psi = this.psi, qpos = this.qpos;
    const delta = new Float32Array(n); // linear overdensity per particle (the colour key)
    const jit = ((2 * L) / (w - 1)) * 0.45; // sub-cell jitter → breaks the regular-grid moiré in walls
    let sumSq = 0;
    let idx = 0;
    for (let iz = 0; iz < w; iz++) {
      for (let iy = 0; iy < w; iy++) {
        for (let ix = 0; ix < w; ix++) {
          const qx = (ix / (w - 1) - 0.5) * 2 * L + (rng() - 0.5) * jit;
          const qy = (iy / (w - 1) - 0.5) * 2 * L + (rng() - 0.5) * jit;
          const qz = (iz / (w - 1) - 0.5) * 2 * L + (rng() - 0.5) * jit;
          let sx = 0, sy = 0, sz = 0, div = 0;
          for (let m = 0; m < K; m++) {
            const theta = kx[m] * qx + ky[m] * qy + kz[m] * qz + phase[m];
            const sn = Math.sin(theta), cs = Math.cos(theta);
            const a = amp[m];
            sx += ux[m] * a * sn; sy += uy[m] * a * sn; sz += uz[m] * a * sn;
            div += a * kmag[m] * cs; // ∇·ψ = Σ aₘ|kₘ|cos(θ)  (k̂·k = |k|)
          }
          const o = idx * 3;
          psi[o] = sx; psi[o + 1] = sy; psi[o + 2] = sz;
          qpos[o] = qx; qpos[o + 1] = qy; qpos[o + 2] = qz;
          sumSq += sx * sx + sy * sy + sz * sz;
          delta[idx] = -div; // overdensity δ = −∇·ψ (positive = collapsing → filaments/nodes)
          idx++;
        }
      }
    }

    // normalize the displacement to a target RMS so the collapse strength is seed-independent
    const rms = Math.sqrt(sumSq / n);
    const scale = rms > 1e-9 ? TARGET_RMS / rms : 1;
    for (let i = 0; i < n * 3; i++) psi[i] *= scale;

    // density colour ramp: low percentile = void floor (near-black), 99.5th = blazing node tip.
    // `contrast` sets the void fraction (where the dark floor ends), so it's the void↔web dial.
    const sorted = delta.slice().sort();
    const dlo = sorted[Math.floor(clamp01(contrast) * (n - 1))];
    const dhi = sorted[Math.floor(0.995 * (n - 1))];
    const dspan = Math.max(1e-9, dhi - dlo);

    // colour each particle ONCE by its destined overdensity (void → filament → node)
    const col = this.colors;
    for (let i = 0; i < n; i++) {
      const t = clamp01((delta[i] - dlo) / dspan);
      const hue = 0.015 + 0.13 * smoothstep(0.45, 0.97, t); // deep red → orange → yellow at the peaks
      const sat = 0.97 - 0.7 * smoothstep(0.82, 1.0, t); // blazing nodes desaturate toward white
      const light = 0.02 + 0.96 * Math.pow(t, 1.5); // steep: voids near-black, only the web lights up
      hslToRgb(hue, sat, clamp01(light), col, i * 3);
    }
  }

  private syncPositions(): void {
    const n = this.particleCount;
    const pos = this.positions, qpos = this.qpos, psi = this.psi;
    const D = this.effectiveD;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      let dx = D * psi[o], dy = D * psi[o + 1], dz = D * psi[o + 2];
      const m2 = dx * dx + dy * dy + dz * dz;
      if (m2 > MAXD2) { const s = MAXD / Math.sqrt(m2); dx *= s; dy *= s; dz *= s; }
      pos[o] = qpos[o] + dx; pos[o + 1] = qpos[o + 1] + dy; pos[o + 2] = qpos[o + 2] + dz;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.t += dt;
    const growth = p.growth ?? 1.0;
    // always-formed, with a slow cosmic "breathing" so the web stays alive without ever collapsing to
    // the unstructured grid (a one-shot reveal would render blank in a static/first-frame capture).
    this.effectiveD = growth * (1 + BREATHE * Math.sin(0.3 * this.t));
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
    return [{ id: 'root', parentId: null, label: `Cosmic Web ${this.W}³`, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.011 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const cosmicWebFactory: ArchetypeFactory = {
  id: 'cosmicWeb',
  label: 'Cosmic Web',
  category: 'Cosmology',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 262_144, // 64³ — density is the brightness lever for 1px additive points
  particleCountOptions: [110_592, 262_144, 512_000], // 48³, 64³, 80³
  defaultDt: 0.016,
  defaultTrail: 0, // the frozen web IS the visual
  create: (config) => new CosmicWebArchetype(config),
};

import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// 2D Ising Model — the simplest thing in physics that has a phase transition. A square lattice of
// spins, each ±1, wants to agree with its four neighbours (ferromagnetic coupling) but is jostled by
// temperature. We evolve it by the Metropolis Monte-Carlo rule: propose a flip, accept it outright if
// it lowers the energy, otherwise accept with probability e^{−ΔE/T}. Below the Curie point
// Tc = 2/ln(1+√2) ≈ 2.269 the lattice spontaneously MAGNETIZES into large aligned domains; above it,
// thermal noise wins and the spins are a disordered salt-and-pepper. Exactly AT Tc the domains become
// scale-free — fluctuating blobs of every size at once (critical opalescence), the fingerprint of a
// second-order transition. Slide the temperature through Tc to drive the lattice between order and
// chaos. Up-spins glow warm, down-spins cool, so the domain walls read directly. (Ising 1925; Onsager
// solved it exactly in 1944.) Each cell owns two pre-coloured points; only the one matching its spin
// is shown, the other parks off-frame. Bounded.
const TC = 2 / Math.log(1 + Math.SQRT2); // ≈ 2.2692 — the exact critical temperature
const GRID = 384; // fixed lattice side — dense enough that 1px points pack into solid domains
const PARK = -44;

class IsingArchetype implements Archetype {
  readonly id = 'ising';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly W: number; private readonly H: number;
  private readonly spin: Int8Array; // ±1 lattice
  private readonly px: Float32Array; private readonly py: Float32Array; // baked grid position per cell
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private rng: () => number;
  private temperature = TC;
  private rate = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    // fixed lattice (2 points per cell: a warm + a cool ghost) so the resolution never depends on the
    // capture's particle budget
    const W = GRID;
    this.W = W; this.H = W;
    const NC = W * W;
    this.particleCount = NC * 2;
    this.spin = new Int8Array(NC);
    this.px = new Float32Array(NC); this.py = new Float32Array(NC);
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.rng = mulberry32((config.seed ^ 0x9e3779b9) >>> 0);
    this.readParams(config.params);
    const rng = this.rng;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        this.spin[i] = rng() < 0.5 ? 1 : -1; // random hot start
        // jitter within the cell breaks the regular grid so 1px points fill domains as SOLID clouds
        // instead of a moiré-beating lattice
        const cw = 3.0 / W;
        this.px[i] = (x / (W - 1) - 0.5) * 3.0 + (rng() - 0.5) * cw * 1.4;
        this.py[i] = (y / (W - 1) - 0.5) * 3.0 + (rng() - 0.5) * cw * 1.4;
        // two baked colours: warm gold (spin up) + cool blue (spin down), brightened for bloom
        const jU = 0.8 + 0.4 * rng(), jD = 0.8 + 0.4 * rng();
        const oU = i * 6, oD = i * 6 + 3;
        this.colors[oU] = 2.5 * jU; this.colors[oU + 1] = 1.2 * jU; this.colors[oU + 2] = 0.3 * jU;
        this.colors[oD] = 0.3 * jD; this.colors[oD + 1] = 0.9 * jD; this.colors[oD + 2] = 2.2 * jD;
      }
    }
    for (let s = 0; s < 130; s++) this.sweep(); // equilibrate so domains have coarsened into big blobs
    // spontaneous magnetization picks a sign at random; force the majority to spin-up (bright gold)
    // so the default view is always a luminous field, never an all-dark down quench
    let mag = 0; for (let i = 0; i < NC; i++) mag += this.spin[i];
    if (mag < 0) for (let i = 0; i < NC; i++) this.spin[i] = -this.spin[i] as -1 | 1;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.temperature = Math.max(0.2, p.temperature ?? 1.9);
    this.rate = p.rate ?? 1;
  }

  // one Metropolis checkerboard sweep (both sublattices), periodic boundaries
  private sweep(): void {
    const { W, H, spin } = this;
    const T = this.temperature;
    const rng = this.rng;
    // precompute the few possible Boltzmann factors (ΔE ∈ {4, 8} matter; ≤0 always accepted)
    const e4 = Math.exp(-4 / T), e8 = Math.exp(-8 / T);
    for (let parity = 0; parity < 2; parity++) {
      for (let y = 0; y < H; y++) {
        const yUp = ((y + 1) % H) * W, yDn = ((y - 1 + H) % H) * W, yc = y * W;
        for (let x = 0; x < W; x++) {
          if (((x + y) & 1) !== parity) continue;
          const s = spin[yc + x];
          const xR = (x + 1) % W, xL = (x - 1 + W) % W;
          const h = spin[yUp + x] + spin[yDn + x] + spin[yc + xR] + spin[yc + xL];
          const dE = 2 * s * h; // ∈ {−8,−4,0,4,8}
          if (dE <= 0) { spin[yc + x] = -s as -1 | 1; }
          else if (rng() < (dE === 4 ? e4 : e8)) { spin[yc + x] = -s as -1 | 1; }
        }
      }
    }
  }

  private syncPositions(): void {
    const pos = this.positions;
    const NC = this.W * this.H;
    for (let i = 0; i < NC; i++) {
      const up = this.spin[i] > 0;
      const oU = i * 6, oD = i * 6 + 3;
      if (up) {
        pos[oU] = this.px[i]; pos[oU + 1] = this.py[i]; pos[oU + 2] = 0;
        pos[oD] = 0; pos[oD + 1] = PARK; pos[oD + 2] = 0;
      } else {
        pos[oU] = 0; pos[oU + 1] = PARK; pos[oU + 2] = 0;
        pos[oD] = this.px[i]; pos[oD + 1] = this.py[i]; pos[oD + 2] = 0;
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt * this.rate;
    const sweeps = Math.max(1, Math.round(this.rate * 2));
    for (let s = 0; s < sweeps; s++) this.sweep();
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Ising lattice (Metropolis Monte-Carlo)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.013 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const isingFactory: ArchetypeFactory = {
  id: 'ising',
  label: 'Ising Model',
  category: 'Matter',
  kind: 'flow',
  params: [
    { key: 'temperature', label: 'temperature (Tc≈2.27)', min: 0.6, max: 4, step: 0.02, default: 1.9 },
    { key: 'rate', label: 'MC speed', min: 0.2, max: 5, step: 0.1, default: 1 },
  ],
  defaultParticleCount: GRID * GRID * 2,
  particleCountOptions: [GRID * GRID * 2],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new IsingArchetype(config),
};

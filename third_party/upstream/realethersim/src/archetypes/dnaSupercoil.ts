import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// DNA Supercoiling. A closed double helix carries a topological invariant — its linking number
// Lk, the number of times the two strands wind around each other — and Lk cannot change unless an
// enzyme cuts a strand. White's theorem (Călugăreanu–White–Fuller) splits it into two geometric
// pieces that CAN trade freely: Lk = Tw + Wr, twist (how fast the strands wind about the helix
// axis) plus writhe (how much the axis itself coils in space). Over- or under-wind the molecule
// and the elastic strain relaxes by converting twist into writhe: the axis buckles out of plane
// into a supercoil. That is what a cell's topoisomerases and the packing of two metres of DNA into
// every nucleus are fighting over. Here the axis is a closed superhelix wound n times on a torus;
// as the imposed strain cycles, the coil amplitude grows, writhe rises, and the base-pair twist
// visibly SLOWS to keep Lk fixed — then relaxes back. Every colour is baked; the topology lives in
// positions. Bounded (a closed loop).
const TAU = Math.PI * 2;
const R = 1.0; // radius of the coil's guiding circle
const RH = 0.055; // double-helix radius (strand offset from the axis)
const N_RUNGS = 224; // base-pair rungs around the loop

class DnaSupercoilArchetype implements Archetype {
  readonly id = 'dnaSupercoil';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly role: Uint8Array; // 0,1 = backbone strands; 2 = base-pair rung
  private readonly sv: Float64Array; // arc parameter s ∈ [0, 2π)
  private readonly frac: Float64Array; // rung: fraction across the ladder (else unused)
  private coils = 11; // n super-turns (rebuild)
  private linking = 26; // Lk — total strand windings (live)
  private supercoil = 1; // strain amplitude (live)
  private relax = 1; // cycle speed (live)
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(1024, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.role = new Uint8Array(N);
    this.sv = new Float64Array(N);
    this.frac = new Float64Array(N);
    const rng = mulberry32((config.seed ^ 0x1b873593) >>> 0);
    // base-pair identity baked per rung station: A·T (red) or G·C (blue)
    const rungHue = new Uint8Array(N_RUNGS);
    for (let r = 0; r < N_RUNGS; r++) rungHue[r] = rng() < 0.5 ? 0 : 1;
    for (let i = 0; i < N; i++) {
      const u = rng();
      const o = i * 3;
      if (u < 0.36) {
        this.role[i] = 0;
        this.sv[i] = rng() * TAU;
        const b = 0.7 + 0.35 * rng();
        this.colors[o] = 1.0 * b; this.colors[o + 1] = 0.72 * b; this.colors[o + 2] = 0.26 * b; // amber backbone
      } else if (u < 0.72) {
        this.role[i] = 1;
        this.sv[i] = rng() * TAU;
        const b = 0.7 + 0.35 * rng();
        this.colors[o] = 1.0 * b; this.colors[o + 1] = 0.83 * b; this.colors[o + 2] = 0.5 * b; // paler gold backbone
      } else {
        this.role[i] = 2;
        const station = Math.floor(rng() * N_RUNGS);
        this.sv[i] = (station / N_RUNGS) * TAU;
        this.frac[i] = rng();
        const b = 1.15 + 0.6 * rng();
        if (rungHue[station] === 0) { this.colors[o] = 1.0 * b; this.colors[o + 1] = 0.26 * b; this.colors[o + 2] = 0.24 * b; } // A·T
        else { this.colors[o] = 0.32 * b; this.colors[o + 1] = 0.52 * b; this.colors[o + 2] = 1.0 * b; } // G·C
      }
    }
    this.readParams(config.params);
    // start where the ~3.2-sim-second thumbnail capture lands the coil near full writhe (the
    // recognisable supercoiled state), while a live visitor arrives mid-relaxation
    this.t = 3.1;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.coils = Math.round(p.coils ?? 11);
    this.linking = p.linking ?? 26;
    this.supercoil = p.supercoil ?? 1;
    this.relax = p.relax ?? 1;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    const n = this.coils;
    // imposed strain cycles: flat ring (all linking is twist) → coiled supercoil (writhe absorbs it)
    const theta = this.t * this.relax * 0.5;
    const rho = this.supercoil * 0.24 * (0.5 - 0.5 * Math.cos(theta));
    // superhelical writhe from the coil geometry (0 at ρ=0, monotone, saturating below n)
    const x = (n * rho) / R;
    const Wr = (n * x) / (1 + x);
    const Tw = this.linking - Wr; // White's theorem: Lk = Tw + Wr, held fixed → twist gives way
    const spin = 0.15 * this.t; // slow presentation turn
    const csp = Math.cos(spin), ssp = Math.sin(spin);
    for (let i = 0; i < N; i++) {
      const s = this.sv[i];
      const cs = Math.cos(s), sn = Math.sin(s);
      const cns = Math.cos(n * s), sns = Math.sin(n * s);
      // axis: a superhelix of n turns wound on a torus of guiding radius R
      const f = R + rho * cns;
      const fp = -rho * n * sns;
      const ax = f * cs, ay = f * sn, az = rho * sns;
      // analytic tangent
      let tx = fp * cs - f * sn, ty = fp * sn + f * cs, tz = rho * n * cns;
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // outward torus normal — smooth, never parallel to the tangent → a flip-free frame
      let nx = cns * cs, ny = cns * sn, nz = sns;
      const nd = nx * tx + ny * ty + nz * tz;
      nx -= nd * tx; ny -= nd * ty; nz -= nd * tz;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      // binormal B = T × N
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      // base-pair winding: τ advances Tw times around the loop
      const ang = Tw * s;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const dx = ca * nx + sa * bx, dy = ca * ny + sa * by, dz = ca * nz + sa * bz;
      let off: number;
      if (this.role[i] === 0) off = RH;
      else if (this.role[i] === 1) off = -RH; // the paired strand rides diametrically opposite
      else off = RH * (1 - 2 * this.frac[i]); // rung: from one strand through the axis to the other
      let px = ax + off * dx, py = ay + off * dy, pz = az + off * dz;
      // presentation spin about y
      const o = i * 3;
      pos[o] = px * csp - pz * ssp;
      pos[o + 1] = py;
      pos[o + 2] = px * ssp + pz * csp;
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
    return [{ id: 'root', parentId: null, label: 'closed double helix (Lk = Tw + Wr)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.007 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const dnaSupercoilFactory: ArchetypeFactory = {
  id: 'dnaSupercoil',
  label: 'DNA Supercoiling',
  category: 'Parametric',
  kind: 'flow',
  params: [
    { key: 'supercoil', label: 'strain', min: 0, max: 2, step: 0.05, default: 1 }, // writhe amplitude
    { key: 'linking', label: 'linking number', min: 14, max: 40, step: 1, default: 26 }, // Lk
    { key: 'coils', label: 'super-turns', min: 5, max: 18, step: 1, default: 11 }, // n (rebuild)
    { key: 'relax', label: 'relax rate', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the strands are continuous ribbons — trails would blur the ladder
  bloom: 0.32,
  create: (config) => new DnaSupercoilArchetype(config),
};

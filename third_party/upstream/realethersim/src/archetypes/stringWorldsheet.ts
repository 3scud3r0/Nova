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

// String worldsheet. A classical point particle traces a 1-D worldLINE x(t) through spacetime; a
// string sweeps a 2-D worldSHEET. We take a vibrating string as a superposition of standing-wave
// harmonics y(σ,τ)=Σ aₙ sin(nπσ)·cos(nωₙτ+φₙ) (open: pinned ends) with a second transverse
// polarisation z(σ,τ) so the string is a 3-D wiggling curve, then SWEEP it through a τ-window: each
// row of the grid is the string at a retarded time, so the present edge leads and its past trails
// behind — the sheet flows through the (static) spacetime grid as τ advances. Colour is baked once
// (hue along σ, brightness ramps past→present × the standing-wave antinode envelope). Bounded ∀t.
const TAU = Math.PI * 2;
const LSTRING = 3.2; // string extent along x (the σ axis)
const TSPAN = 3.2; // τ-window extent along z (the swept "time" axis)
const SWEEP_GAIN = 0.4; // how much the 2nd transverse polarisation bulges the sheet in z
const MAXN = 8;

class StringWorldsheetArchetype implements Archetype {
  readonly id = 'stringWorldsheet';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly W: number;
  private readonly sigma: Float64Array; // baked σ per point
  private readonly tauLocal: Float64Array; // baked τ-fraction (0=past edge, 1=present edge)
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly amp = new Float64Array(MAXN); // per-mode amplitude aₙ = amp/n
  private readonly phY = new Float64Array(MAXN); // per-mode phase (y polarisation)
  private readonly phZ = new Float64Array(MAXN); // per-mode phase (z polarisation)
  private nHarm = 4;
  private closed = false;
  private tension = 1;
  private ampScale = 0.6;
  private window = 3;
  private t = 0;
  private modeKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    const w = Math.max(24, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    this.sigma = new Float64Array(this.particleCount);
    this.tauLocal = new Float64Array(this.particleCount);
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.seed = config.seed;
    this.rebuild(config.params);
  }

  // Re-bake on a structural change (harmonics / open-vs-closed): per-mode amplitudes + deterministic
  // phases, the σ/τ grid, and the colours (hue from σ, value from τ ramp × antinode envelope).
  private rebuild(p: ResolvedParams): void {
    const w = this.W;
    this.nHarm = Math.max(1, Math.min(MAXN, Math.round(p.harmonics ?? 4)));
    this.closed = (p.openVsClosed ?? 0) >= 0.5;
    this.ampScale = p.amp ?? 0.6;
    this.tension = p.tension ?? 1;
    this.window = p.window ?? 3;
    this.modeKey = `${this.nHarm},${this.closed ? 1 : 0}`;
    const rng = mulberry32((this.seed ^ 0x9e3779b1) + this.nHarm * 2654435761);
    for (let n = 0; n < MAXN; n++) {
      this.amp[n] = 1 / (n + 1); // aₙ = 1/n (n=1..N), high harmonics taper
      this.phY[n] = rng() * TAU;
      this.phZ[n] = rng() * TAU;
    }
    // antinode envelope per σ: sqrt(Σ aₙ² · basis(σ)²) — nodes stay dark, antinodes glow
    const col = this.colors;
    for (let i = 0; i < this.particleCount; i++) {
      const sx = i % w;
      const sy = (i / w) | 0;
      const sg = sx / (w - 1); // σ ∈ [0,1]
      const tl = sy / (w - 1); // τ fraction ∈ [0,1]
      this.sigma[i] = sg;
      this.tauLocal[i] = tl;
      let env = 0;
      for (let n = 1; n <= this.nHarm; n++) {
        const b = this.closed ? Math.cos(TAU * n * sg) : Math.sin(Math.PI * n * sg);
        env += (this.amp[n - 1] * b) * (this.amp[n - 1] * b);
      }
      env = Math.min(1, Math.sqrt(env) * 1.5);
      const hue = 0.58 + sg * 0.34; // teal → violet along the string
      const light = (0.12 + 0.62 * tl) * (0.35 + 0.65 * env); // present-edge bright; antinodes glow
      hslToRgb(hue % 1, 0.8, light, col, i * 3);
    }
    this.syncPositions();
  }

  // The string's two transverse displacements at (σ, retarded τ). out[0]=y, out[1]=z.
  private displace(sg: number, rt: number, out: [number, number]): void {
    const c = Math.sqrt(Math.max(0.05, this.tension));
    let y = 0;
    let z = 0;
    for (let n = 1; n <= this.nHarm; n++) {
      const basis = this.closed ? Math.cos(TAU * n * sg) : Math.sin(Math.PI * n * sg);
      const wn = n * Math.PI * c; // mode frequency ωₙ = nπc
      const a = this.amp[n - 1];
      y += a * basis * Math.cos(wn * rt + this.phY[n - 1]);
      z += a * basis * Math.cos(wn * rt + this.phZ[n - 1]);
    }
    out[0] = y * this.ampScale;
    out[1] = z * this.ampScale;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const d: [number, number] = [0, 0];
    for (let i = 0; i < this.particleCount; i++) {
      const sg = this.sigma[i];
      const tl = this.tauLocal[i];
      const rt = this.t - (1 - tl) * this.window; // present edge (tl=1) = now; past trails behind
      this.displace(sg, rt, d);
      const o = i * 3;
      pos[o] = (sg - 0.5) * LSTRING; // σ along x
      pos[o + 1] = d[0]; // transverse displacement (height)
      pos[o + 2] = (tl - 0.5) * TSPAN + SWEEP_GAIN * d[1]; // τ along z + 2nd-polarisation bulge
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const key = `${Math.max(1, Math.min(MAXN, Math.round(p.harmonics ?? 4)))},${(p.openVsClosed ?? 0) >= 0.5 ? 1 : 0}`;
    if (key !== this.modeKey) {
      this.rebuild(p);
      return;
    }
    this.tension = p.tension ?? 1;
    this.ampScale = p.amp ?? 0.6;
    this.window = p.window ?? 3;
    this.t += dt * (p.sweep ?? 1);
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
    return [{ id: 'root', parentId: null, label: `String worldsheet (${this.nHarm} modes)`, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.009 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const stringWorldsheetFactory: ArchetypeFactory = {
  id: 'stringWorldsheet',
  label: 'String Worldsheet',
  category: 'Parametric',
  kind: 'flow',
  params: [
    { key: 'harmonics', label: 'harmonics N', min: 1, max: 8, step: 1, default: 4, rebuild: true },
    { key: 'openVsClosed', label: 'string type', min: 0, max: 1, step: 1, default: 0, rebuild: true, options: { open: 0, closed: 1 } },
    { key: 'tension', label: 'tension', min: 0.3, max: 3, step: 0.05, default: 1 },
    { key: 'amp', label: 'amplitude', min: 0, max: 1.2, step: 0.02, default: 0.6 },
    { key: 'sweep', label: 'sweep speed', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'window', label: 'τ window', min: 0.5, max: 6, step: 0.1, default: 3 },
  ],
  defaultParticleCount: 90_000,
  particleCountOptions: [40_000, 90_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the swept sheet IS the visual
  create: (config) => new StringWorldsheetArchetype(config),
};

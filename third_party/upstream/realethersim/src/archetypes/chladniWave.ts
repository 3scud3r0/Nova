import type { Archetype, ArchetypeConfig, ArchetypeFactory, NodeSpec, ParamSpec, RenderHint, ResolvedParams } from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Faraday / Chladni wave plate: a 2nd-order wave equation on a FIXED-edge W×W membrane, parametrically
// driven (Mathieu) so subharmonic standing modes lock into symmetric CHLADNI nodal patterns — the sand
// figures of a vibrated plate. üᵢⱼ = c²∇²u − [k0+ε·sin(ωt)]·u − β·u³ − γ·u̇, integrated by LEAPFROG with a
// third buffer u_prev. Dirichlet rim (u=0) gives clean plate eigenmodes; the cubic + capped drive keep
// the Faraday-pumped amplitude bounded. Rendered as a displaced point grid: y = u·relief, colour by |u|
// so nodal lines (u≈0) read DARK and antinodes bright. Stable by construction: the dimensionless
// wave-Courant number c·dt is the slider, capped (with driveAmp) so the Mathieu resonance can't run away.
const EXTENT = 3;
const K0 = 0.08; // baseline restoring (Mathieu δ)
const BETA = 1.0; // cubic saturation

const PARAM_SPEC: ParamSpec[] = [
  // Default = a freely-ringing single eigenmode → a CLEAN Chladni nodal figure. Raising the Faraday
  // drive turns on the parametric (Mathieu) pump → multi-mode chaotic cymatics.
  { key: 'mode', label: 'mode', min: 1, max: 6, step: 1, default: 3, rebuild: true }, // figure = (mode+1, mode)
  // waveSpeed is the dimensionless Courant number c·dt; max 0.5 + Faraday max 0.12 starve the Mathieu
  // instability even at damping 0 (von Neumann + drive bound, verified to W=256).
  { key: 'waveSpeed', label: 'wave speed', min: 0.2, max: 0.5, step: 0.01, default: 0.45 },
  { key: 'damping', label: 'damping', min: 0, max: 0.03, step: 0.001, default: 0 }, // 0 = rings forever (clean)
  { key: 'driveFreq', label: 'drive freq', min: 0.05, max: 0.6, step: 0.01, default: 0.25 },
  { key: 'driveAmp', label: 'Faraday drive', min: 0, max: 0.12, step: 0.005, default: 0 }, // >0 = parametric chaos
  { key: 'relief', label: 'relief', min: 0, max: 3, step: 0.05, default: 0.9 },
];

class ChladniWaveArchetype implements Archetype {
  readonly id = 'chladniWave';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly W: number;
  private u: Float64Array;
  private uPrev: Float64Array;
  private uNext: Float64Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private relief = 0.9;
  private t = 0; // accumulated step count (drive phase)

  constructor(config: ArchetypeConfig) {
    const w = Math.max(24, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    const n = this.particleCount;
    this.u = new Float64Array(n);
    this.uPrev = new Float64Array(n);
    this.uNext = new Float64Array(n);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    const mode = Math.round(config.params.mode ?? 3);
    this.seedField(config.seed, mode + 1, mode);
    this.syncPositions();
  }

  // Seed a single clean (m,n) plate eigenmode (zero on the rim) so a symmetric Chladni nodal figure
  // dominates from the start; a whisper of noise breaks degeneracy. Start at rest (uPrev = u).
  private seedField(seed: number, m: number, nn: number): void {
    const rng = mulberry32(seed);
    const w = this.W;
    for (let y = 1; y < w - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = 0.45 * Math.sin((m * Math.PI * x) / (w - 1)) * Math.sin((nn * Math.PI * y) / (w - 1)) + (rng() - 0.5) * 0.004;
        this.u[i] = v;
        this.uPrev[i] = v;
      }
    }
  }

  step(_dt: number, p: ResolvedParams): void {
    const w = this.W;
    const courant = p.waveSpeed ?? 0.5;
    const C2 = courant * courant; // (c·dt)² — dimensionless; Laplacian is grid-unit
    const gamma = p.damping ?? 0.004;
    const omega = p.driveFreq ?? 0.25;
    const eps = p.driveAmp ?? 0.12;
    this.relief = p.relief ?? 0.9;
    const k = K0 + eps * Math.sin(omega * this.t); // Mathieu parametric stiffness
    const u = this.u, uPrev = this.uPrev, un = this.uNext;
    for (let y = 1; y < w - 1; y++) {
      const yc = y * w, yu = (y - 1) * w, yd = (y + 1) * w;
      for (let x = 1; x < w - 1; x++) {
        const c = yc + x;
        const uc = u[c];
        const lap = u[yc + x - 1] + u[yc + x + 1] + u[yu + x] + u[yd + x] - 4 * uc; // 5-point, grid-unit
        const accel = C2 * lap - k * uc - BETA * uc * uc * uc;
        let next = 2 * uc - uPrev[c] + accel - gamma * (uc - uPrev[c]); // leapfrog + velocity damping
        if (next > 4) next = 4; else if (next < -4) next = -4; else if (!Number.isFinite(next)) next = 0; // self-healing guard
        un[c] = next;
      }
    }
    // FIXED rim: u = 0 on all edges (clean nodal eigenmodes)
    for (let x = 0; x < w; x++) { un[x] = 0; un[(w - 1) * w + x] = 0; }
    for (let y = 0; y < w; y++) { un[y * w] = 0; un[y * w + (w - 1)] = 0; }
    // rotate the three buffers (zero-alloc): prev←u, u←next, next←(old prev, reused as scratch)
    this.uPrev = u;
    this.u = un;
    this.uNext = uPrev;
    this.t += 1;
    this.syncPositions();
  }

  private syncPositions(): void {
    const w = this.W, u = this.u, pos = this.positions, col = this.colors;
    const cell = EXTENT / (w - 1), half = EXTENT / 2, relief = this.relief;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, o = i * 3;
        const uv = u[i];
        pos[o] = x * cell - half;
        pos[o + 1] = uv * relief; // wave height
        pos[o + 2] = y * cell - half;
        const a = Math.min(1, Math.abs(uv) * 5.0); // nodal lines (|u|≈0) → dark, antinodes → bright
        col[o] = 0.06 + 0.94 * a; // teal → white ramp, brightened
        col[o + 1] = 0.35 + 0.6 * a;
        col[o + 2] = 0.6 + 0.4 * a;
      }
    }
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const n = this.particleCount;
    const out = new Float64Array(n * 2);
    out.set(this.u, 0); out.set(this.uPrev, n);
    return out;
  }
  loadState(s: Float64Array): void {
    const n = this.particleCount;
    this.u.set(s.subarray(0, n));
    this.uPrev.set(s.subarray(n, n * 2));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Chladni plate ${this.W}²`, stateOffset: 0, stateLength: this.particleCount * 2 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', exposesField: true, pointSize: 0.02 }; }
  readField(): { texture: unknown; width: number; height: number } { return { texture: this.u, width: this.W, height: this.W }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const chladniWaveFactory: ArchetypeFactory = {
  id: 'chladniWave',
  label: 'Faraday / Chladni Plate',
  category: 'Field',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 40_000, // W≈200
  particleCountOptions: [10_000, 40_000, 90_000],
  defaultDt: 0.016, // step() ignores dt — the drive phase uses an internal dimensionless counter
  defaultTrail: 0, // the wave surface IS the visual
  create: (config) => new ChladniWaveArchetype(config),
};

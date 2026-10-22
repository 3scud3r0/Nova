import type { Archetype, ArchetypeConfig, ArchetypeFactory, NodeSpec, ParamSpec, RenderHint, ResolvedParams } from '../core/archetype';

// Luneburg Lens — focusing an electromagnetic wave with no curved surface at all, only a gradient in
// the medium. A Luneburg lens is a disk whose refractive index falls smoothly from the centre outward,
// n(r) = √(2 − (r/R)²): dense (slow) at the core, unity (vacuum speed) at the rim. A plane wave sweeping
// in is bent continuously — the fast outer edges outrun the slow core — and every parallel ray is
// brought to a single focus on the far surface. We simulate the real 2-D scalar wave equation
// üᵢⱼ = c(x,y)²∇²u by leapfrog on a grid, with the wave SPEED baked per cell from the Luneburg profile
// (c = c₀/n, so the core is slow). A soft line source on the left launches the plane wave; a damping
// sponge at the borders swallows outgoing waves so nothing reflects. The field is drawn as a nearly-flat
// grid coloured by amplitude — orange crests, blue troughs — with the lens disk faintly lit, so you
// watch straight wavefronts curl inward and pinch to a bright focus. Stable by construction (the vacuum
// Courant number is the cap; the slower core only helps). (R. K. Luneburg, 1944.)
const EXTENT = 3.4;
const SPONGE = 22; // absorbing-border width in cells

const PARAM_SPEC: ParamSpec[] = [
  { key: 'frequency', label: 'wavelength', min: 0.08, max: 0.5, step: 0.01, default: 0.17 }, // source ω (smaller ω = longer waves)
  { key: 'courant', label: 'wave speed', min: 0.2, max: 0.5, step: 0.01, default: 0.5 }, // vacuum c·dt (stability cap 0.5)
  { key: 'gain', label: 'contrast', min: 0.5, max: 3, step: 0.1, default: 1.3 },
  { key: 'relief', label: 'relief', min: 0, max: 1.6, step: 0.02, default: 0.8 },
];

class LuneburgLensArchetype implements Archetype {
  readonly id = 'luneburgLens';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly W: number;
  private u: Float64Array;
  private uPrev: Float64Array;
  private uNext: Float64Array;
  private readonly c2: Float64Array; // per-cell (c·dt)² from the Luneburg profile
  private readonly damp: Float64Array; // border sponge (0 interior → absorbing near edges)
  private readonly inLens: Uint8Array; // 1 inside the lens disk (for the faint disk tint)
  private readonly ring: Float64Array; // soft highlight at the lens rim
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly srcX: number;
  private readonly cx: number; private readonly cy: number; private readonly R: number;
  private freq = 0.3; private gain = 1.8; private relief = 0.28; private courant = 0.5;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const w = Math.max(120, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    const n = this.particleCount;
    this.u = new Float64Array(n); this.uPrev = new Float64Array(n); this.uNext = new Float64Array(n);
    this.c2 = new Float64Array(n); this.damp = new Float64Array(n); this.inLens = new Uint8Array(n); this.ring = new Float64Array(n);
    this.positions = new Float32Array(n * 3); this.colors = new Float32Array(n * 3);
    this.readParams(config.params);
    // lens centred a little right of middle so the plane wave has room to arrive and focus past it
    this.cx = w * 0.52; this.cy = w * 0.5; this.R = w * 0.26;
    this.srcX = Math.round(w * 0.14); // soft source column
    this.buildMedium();
    for (let s = 0; s < 620; s++) this.advance(); // burn in so the wave has crossed and is focusing at t=0
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.freq = p.frequency ?? 0.17;
    this.courant = Math.min(0.5, p.courant ?? 0.5);
    this.gain = p.gain ?? 1.3;
    this.relief = p.relief ?? 0.8;
  }

  // bake the Luneburg speed profile, the absorbing sponge, and the lens-disk markers (once)
  private buildMedium(): void {
    const w = this.W, cx = this.cx, cy = this.cy, R = this.R, c0 = this.courant;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const dx = x - cx, dy = y - cy, r = Math.sqrt(dx * dx + dy * dy);
        let c = c0;
        if (r < R) {
          const nr = Math.sqrt(Math.max(1, 2 - (r / R) * (r / R))); // n(r) = √(2 − (r/R)²), ≥1
          c = c0 / nr; // slow core, vacuum-speed rim
          this.inLens[i] = 1;
        }
        this.c2[i] = c * c;
        // soft rim highlight so the lens disk reads even where the field is quiet
        this.ring[i] = Math.exp(-((r - R) * (r - R)) / (2 * (w * 0.012) * (w * 0.012)));
        // absorbing sponge: quadratic ramp of extra damping inside the border band
        const edge = Math.min(x, y, w - 1 - x, w - 1 - y);
        this.damp[i] = edge < SPONGE ? 0.12 * ((SPONGE - edge) / SPONGE) ** 2 : 0;
      }
    }
  }

  step(_dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.advance();
    this.syncPositions();
  }

  // one leapfrog step of the scalar wave field (used per frame AND for the constructor burn-in)
  private advance(): void {
    const w = this.W, u = this.u, uPrev = this.uPrev, un = this.uNext, c2 = this.c2, damp = this.damp;
    for (let y = 1; y < w - 1; y++) {
      const yc = y * w, yu = (y - 1) * w, yd = (y + 1) * w;
      for (let x = 1; x < w - 1; x++) {
        const c = yc + x;
        const uc = u[c];
        const lap = u[yc + x - 1] + u[yc + x + 1] + u[yu + x] + u[yd + x] - 4 * uc;
        const accel = c2[c] * lap;
        let next = (2 * uc - uPrev[c] + accel) * (1 - damp[c]); // leapfrog + border sponge
        if (next > 3) next = 3; else if (next < -3) next = -3; else if (!Number.isFinite(next)) next = 0;
        un[c] = next;
      }
    }
    // open edges (copy inward) — the sponge already killed the amplitude here, so no reflection
    for (let x = 0; x < w; x++) { un[x] = un[w + x] * 0.5; un[(w - 1) * w + x] = un[(w - 2) * w + x] * 0.5; }
    for (let y = 0; y < w; y++) { un[y * w] = un[y * w + 1] * 0.5; un[y * w + (w - 1)] = un[y * w + (w - 2)] * 0.5; }
    // soft plane-wave source: a full in-phase column → a rightward-travelling plane wave (transparent
    // to returning waves because it's ADDED, not clamped)
    const drive = Math.sin(this.freq * this.t) * 1.6;
    const taper = SPONGE + 4;
    for (let y = taper; y < w - taper; y++) un[y * w + this.srcX] += drive;
    // rotate buffers (zero-alloc)
    this.uPrev = u; this.u = un; this.uNext = uPrev;
    this.t += 1;
  }

  private syncPositions(): void {
    const w = this.W, u = this.u, pos = this.positions, col = this.colors;
    const cell = EXTENT / (w - 1), half = EXTENT / 2, relief = this.relief, gain = this.gain;
    // normalise by the MEAN amplitude (not the peak) so the ordinary wavefronts read bright and the
    // focus is left to saturate white — normalising by the peak would dim everything against that spike
    let sum = 0;
    for (let i = 0; i < this.particleCount; i++) sum += Math.abs(u[i]);
    const scale = 3 * (sum / this.particleCount) + 1e-6;
    const norm = gain / scale, hnorm = relief / scale; // normalise colour AND ridge height
    for (let i = 0; i < this.particleCount; i++) {
      const x = i % w, y = (i / w) | 0, o = i * 3;
      const uv = u[i];
      pos[o] = x * cell - half;
      pos[o + 1] = uv * hnorm; // wavefronts stand up as ridges regardless of absolute amplitude
      pos[o + 2] = y * cell - half;
      // diverging colormap: orange crests (+), blue troughs (−); faint lens disk + rim glow underneath
      const a = Math.min(1, Math.abs(uv) * norm);
      const amb = this.inLens[i] ? 0.05 : 0.0;
      const rim = this.ring[i] * 0.22;
      if (uv >= 0) {
        col[o] = amb + rim * 0.5 + a * 2.2; col[o + 1] = amb * 1.4 + rim + a * 0.95; col[o + 2] = amb * 1.6 + rim + a * 0.2;
      } else {
        col[o] = amb + rim * 0.5 + a * 0.2; col[o + 1] = amb * 1.4 + rim + a * 1.0; col[o + 2] = amb * 1.6 + rim + a * 2.3;
      }
    }
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const n = this.particleCount; const out = new Float64Array(n * 2 + 1);
    out[0] = this.t; out.set(this.u, 1); out.set(this.uPrev, n + 1); return out;
  }
  loadState(s: Float64Array): void {
    const n = this.particleCount; this.t = s[0] ?? 0;
    this.u.set(s.subarray(1, n + 1)); this.uPrev.set(s.subarray(n + 1, 2 * n + 1)); this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'gradient-index wave lens (Luneburg)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', exposesField: true, pointSize: 0.02 }; }
  readField(): { texture: unknown; width: number; height: number } { return { texture: this.u, width: this.W, height: this.W }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const luneburgLensFactory: ArchetypeFactory = {
  id: 'luneburgLens',
  label: 'Luneburg Lens',
  category: 'Spectral',
  kind: 'flow',
  mainThread: true, // field-texture render needs the wave grid on the main thread
  fieldRender: true, // draw the continuous field as a smooth colour map, not a point cloud
  params: PARAM_SPEC,
  defaultParticleCount: 52_900, // W≈230
  particleCountOptions: [22_500, 52_900, 90_000],
  defaultDt: 0.016, // step() ignores dt — an internal counter drives the source phase
  defaultTrail: 0,
  bloom: 0.35,
  create: (config) => new LuneburgLensArchetype(config),
};

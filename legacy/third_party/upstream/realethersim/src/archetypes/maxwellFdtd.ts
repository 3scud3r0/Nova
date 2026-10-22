import type { Archetype, ArchetypeConfig, ArchetypeFactory, NodeSpec, RenderHint, ResolvedParams } from '../core/archetype';

// Maxwell's Equations (FDTD) — light as it really is: an electric and a magnetic field that keep regenerating
// each other. This solves Maxwell's equations directly on a grid, in two dimensions (the electric field Eᶻ
// points out of the screen, the magnetic field (Hˣ, Hʸ) lies in it), with Yee's 1966 staggered-grid scheme:
// E is updated from the curl of H, then H from the curl of E, half a step apart. Nothing about waves,
// diffraction or refraction is put in by hand — they come out. Four set-ups: a single antenna (a line current
// oscillating up and down) radiating circular waves; two antennas half a wavelength apart whose relative phase
// steers the beam (a phased array); a plane wave through a metal wall with two slits (Young's interference); and
// a plane wave arriving at an angle on a block of glass (refraction, partial reflection — and with the right
// angle, total internal reflection on the way out). Orange is Eᶻ > 0, blue Eᶻ < 0; or switch to the energy
// density or the time-averaged intensity (where interference fringes stand still). Walls and glass are drawn faintly underneath. The edges are graded absorbing layers so waves leave
// instead of bouncing back.

const S = 0.5; // Courant number c·dt/dx (2-D stability limit 1/√2)
const PML = 24; // absorbing border width (cells)
const SCENES = { antenna: 0, 'phased array': 1, 'double slit': 2, 'glass block': 3 };

class MaxwellFdtdArchetype implements Archetype {
  readonly id = 'maxwellFdtd';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly W: number;
  private readonly ez: Float64Array; private readonly hx: Float64Array; private readonly hy: Float64Array;
  private readonly ca: Float64Array; private readonly cb: Float64Array; // E update: ez = ca·ez + cb·curl H
  private readonly da: Float64Array; private readonly db: Float64Array; // H update (matched magnetic loss in the border)
  private readonly mask: Float32Array; // walls (1) and glass (0.4), for the faint underlay
  private readonly show: Float64Array; // what is drawn: Ez, the energy density, or the time-averaged intensity
  private readonly avg: Float64Array; // ⟨Eᶻ²⟩, a running average over about two periods
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly scene: number;
  private readonly lambda: number; private readonly nGlass: number; private readonly angle: number;
  private phase = 0; private view = 0; private speed = 2;
  private n = 0; // time steps done

  constructor(config: ArchetypeConfig) {
    const w = Math.max(120, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    const N = w * w;
    this.ez = new Float64Array(N); this.hx = new Float64Array(N); this.hy = new Float64Array(N);
    this.ca = new Float64Array(N); this.cb = new Float64Array(N); this.da = new Float64Array(N); this.db = new Float64Array(N);
    this.mask = new Float32Array(N); this.show = new Float64Array(N); this.avg = new Float64Array(N);
    this.positions = new Float32Array(N * 3); this.colors = new Float32Array(N * 3);
    const p = config.params;
    this.scene = Math.round(p.scene ?? 0);
    this.lambda = Math.max(8, p.wavelength ?? 22) * (w / 300); // wavelength in cells, scaled with the grid
    this.nGlass = p.n ?? 1.5;
    this.angle = ((p.angle ?? 30) * Math.PI) / 180;
    this.readParams(p);
    this.buildMedium();
    // a flat grid of points (only used for picking/bounds — the field panel draws the picture)
    const cell = 3.4 / (w - 1);
    for (let i = 0; i < N; i++) { const o = i * 3; this.positions[o] = (i % w) * cell - 1.7; this.positions[o + 2] = ((i / w) | 0) * cell - 1.7; this.colors[o] = 0.3; this.colors[o + 1] = 0.3; this.colors[o + 2] = 0.3; }
    // run until the waves fill the domain, so it opens formed
    const steps = Math.round((w * 1.6) / S);
    for (let k = 0; k < steps; k++) this.advance();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.phase = ((p.phase ?? 90) * Math.PI) / 180;
    this.view = Math.round(p.view ?? 0);
    this.speed = Math.max(0, Math.round(p.speed ?? 2));
  }

  private buildMedium(): void {
    const w = this.W;
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let eps = 1, pec = false;
      if (this.scene === 2) { // a metal wall with two slits
        const x0 = Math.round(w * 0.36), d = this.lambda * 2.6, half = Math.max(1.5, this.lambda * 0.35), yc = w / 2;
        if (i >= x0 && i < x0 + 3 && Math.abs(Math.abs(j - yc) - d / 2) > half) pec = true;
      } else if (this.scene === 3) { // a glass block on the right
        if (i >= Math.round(w * 0.5) && i < Math.round(w * 0.8)) eps = this.nGlass * this.nGlass;
      }
      // graded loss in the border: σ ramps up quadratically; matched electric and magnetic loss absorbs
      const d = Math.min(i, j, w - 1 - i, w - 1 - j);
      const sig = d < PML ? 0.35 * ((PML - d) / PML) ** 3 : 0;
      if (pec) { this.ca[k] = 0; this.cb[k] = 0; this.mask[k] = 1; }
      else {
        const l = sig / (2 * eps);
        this.ca[k] = (1 - l) / (1 + l); this.cb[k] = S / eps / (1 + l);
        this.mask[k] = eps > 1 ? 0.4 : 0;
      }
      const lm = sig / 2;
      this.da[k] = (1 - lm) / (1 + lm); this.db[k] = S / (1 + lm);
    }
  }

  // the sources: soft (added) so returning waves pass through them
  private drive(): void {
    const w = this.W, ez = this.ez, om = (2 * Math.PI * S) / this.lambda, t = this.n;
    const ramp = Math.min(1, t / (3 * this.lambda / S)); // switch on smoothly
    if (this.scene === 0 || this.scene === 1) {
      const pts = this.scene === 0 ? [[w * 0.5, 0]] : [[w * 0.5 - this.lambda / 4, 0], [w * 0.5 + this.lambda / 4, this.phase]];
      for (const [yc, ph] of pts) {
        const i0 = Math.round(w * 0.5), j0 = Math.round(yc);
        ez[j0 * w + i0] += ramp * 0.6 * Math.sin(om * t + ph);
      }
    } else {
      // a line source with a tapered aperture; for the glass block it is tilted (phase delay along y)
      const i0 = Math.round(w * (this.scene === 2 ? 0.14 : 0.12));
      const sinA = this.scene === 3 ? Math.sin(this.angle) : 0, k = (2 * Math.PI) / this.lambda;
      const yc = this.scene === 3 ? w * 0.36 : w * 0.5, sig = this.scene === 3 ? w * 0.14 : w * 0.3;
      for (let j = PML; j < w - PML; j++) {
        const g = Math.exp(-(((j - yc) / sig) ** 4));
        ez[j * w + i0] += ramp * 0.1 * g * Math.sin(om * t - k * sinA * (j - yc)); // k_y = k sin θ
      }
    }
  }

  private advance(): void {
    const w = this.W, ez = this.ez, hx = this.hx, hy = this.hy, ca = this.ca, cb = this.cb, da = this.da, db = this.db;
    // H from the curl of E
    for (let j = 0; j < w - 1; j++) for (let i = 0; i < w - 1; i++) {
      const k = j * w + i;
      hx[k] = da[k] * hx[k] - db[k] * (ez[k + w] - ez[k]);
      hy[k] = da[k] * hy[k] + db[k] * (ez[k + 1] - ez[k]);
    }
    // E from the curl of H
    for (let j = 1; j < w - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      ez[k] = ca[k] * ez[k] + cb[k] * (hy[k] - hy[k - 1] - (hx[k] - hx[k - w]));
    }
    this.drive();
    const al = S / (2 * this.lambda), avg = this.avg; // ≈ two periods
    for (let k = 0; k < w * w; k++) avg[k] += (ez[k] * ez[k] - avg[k]) * al;
    this.n++;
  }

  private syncPositions(): void {
    const N = this.particleCount, ez = this.ez, hx = this.hx, hy = this.hy, out = this.show;
    if (this.view === 1) for (let k = 0; k < N; k++) out[k] = ez[k] * ez[k] + hx[k] * hx[k] + hy[k] * hy[k];
    else if (this.view === 2) out.set(this.avg);
    else out.set(ez);
    // a little relief on the (hidden) grid so bounds and picking see the wave
    for (let k = 0; k < N; k++) { const v = ez[k] * 0.5; this.positions[k * 3 + 1] = v > 0.3 ? 0.3 : v < -0.3 ? -0.3 : v; }
  }

  step(_dt: number, p: ResolvedParams): void {
    this.readParams(p);
    for (let s = 0; s < this.speed; s++) this.advance();
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const N = this.particleCount, out = new Float64Array(1 + 3 * N);
    out[0] = this.n; out.set(this.ez, 1); out.set(this.hx, 1 + N); out.set(this.hy, 1 + 2 * N);
    return out;
  }
  loadState(s: Float64Array): void {
    const N = this.particleCount;
    if (s.length !== 1 + 3 * N) return;
    this.n = s[0]; this.ez.set(s.subarray(1, 1 + N)); this.hx.set(s.subarray(1 + N, 1 + 2 * N)); this.hy.set(s.subarray(1 + 2 * N));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const lam = this.lambda;
    let label: string;
    if (this.scene === 0) label = 'one antenna: circular waves, amplitude falling as 1/√r in two dimensions';
    else if (this.scene === 1) {
      // two sources λ/2 apart, phase Δ: main lobe where k·d·sin θ = Δ (θ from the broadside direction)
      const s = this.phase / Math.PI;
      label = `two antennas λ/2 apart, phase difference ${(this.phase * 180 / Math.PI).toFixed(0)}° → main beam ${Math.abs(s) <= 1 ? (Math.asin(s) * 180 / Math.PI).toFixed(0) + '° from broadside' : 'none (end-fire limit passed)'}`;
    } else if (this.scene === 2) {
      const d = lam * 2.6;
      label = `double slit, spacing d = ${(d / lam).toFixed(1)}λ → bright fringes at sin θ = mλ/d: ${[1, 2].map((m) => (Math.asin(m * lam / d) * 180 / Math.PI).toFixed(1) + '°').join(', ')}`;
    } else {
      const th = Math.asin(Math.sin(this.angle) / this.nGlass), crit = Math.asin(1 / this.nGlass);
      label = `glass n = ${this.nGlass.toFixed(2)}, incidence ${(this.angle * 180 / Math.PI).toFixed(0)}° → refracted ${(th * 180 / Math.PI).toFixed(1)}° (Snell) · critical angle inside ${(crit * 180 / Math.PI).toFixed(1)}°`;
    }
    return [{ id: 'root', parentId: null, label: `${label} · λ = ${lam.toFixed(1)} cells`, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', exposesField: true, pointSize: 0.02 }; }
  readField(): { texture: unknown; width: number; height: number; mask: ArrayLike<number> } {
    return { texture: this.show, width: this.W, height: this.W, mask: this.mask };
  }
  dispose(): void { /* buffers GC with the instance */ }
}

export const maxwellFdtdFactory: ArchetypeFactory = {
  id: 'maxwellFdtd',
  label: "Maxwell's Equations (FDTD)",
  category: 'Field',
  kind: 'flow',
  mainThread: true, // field-texture render needs the grid on the main thread
  fieldRender: true,
  params: [
    { key: 'scene', label: 'set-up', min: 0, max: 3, step: 1, default: 2, options: SCENES, rebuild: true },
    { key: 'wavelength', label: 'wavelength (cells)', min: 12, max: 40, step: 1, default: 22, rebuild: true },
    { key: 'phase', label: 'array phase difference (°)', min: -180, max: 180, step: 5, default: 90 },
    { key: 'n', label: 'glass refractive index', min: 1, max: 2.4, step: 0.05, default: 1.5, rebuild: true },
    { key: 'angle', label: 'angle of incidence (°)', min: 0, max: 60, step: 1, default: 30, rebuild: true },
    { key: 'view', label: 'show', min: 0, max: 2, step: 1, default: 0, options: { 'electric field Eᶻ': 0, 'energy density': 1, 'intensity (time-averaged)': 2 } },
    { key: 'speed', label: 'steps per frame', min: 0, max: 4, step: 1, default: 2 },
  ],
  defaultParticleCount: 90_000, // W = 300
  particleCountOptions: [40_000, 90_000, 160_000],
  defaultDt: 0.016, // step() ignores dt — the FDTD clock is the step count
  defaultTrail: 0,
  bloom: 0.35,
  create: (config) => new MaxwellFdtdArchetype(config),
};

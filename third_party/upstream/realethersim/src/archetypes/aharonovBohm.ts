import type { Archetype, ArchetypeConfig, ArchetypeFactory, NodeSpec, RenderHint, ResolvedParams } from '../core/archetype';

// Aharonov–Bohm Effect — a magnetic field that is never touched still moves the interference fringes. An
// electron wave (a packet, shown as its amplitude) passes through two slits and interferes on a screen. Just
// behind the wall, between the slits, sits a thin, perfectly shielded solenoid: all of its magnetic field is
// inside it, the electron can't go in, and everywhere the electron can go the magnetic field is exactly zero.
// Yet turning up the flux slides the fringes sideways — by exactly one fringe for each flux quantum h/e, and
// back to where they started after a whole quantum. In quantum mechanics the electron feels the vector potential
// A, not just the field B: the two paths round the solenoid pick up a phase difference (e/ħ)∮A·dl = 2π Φ/Φ₀.
// Predicted by Aharonov and Bohm in 1959 and confirmed by Tonomura's electron holography in 1986, with the
// field sealed inside superconducting shielding. On the right: the pattern building up on the screen (bright
// strip) next to the pattern with no flux (dim strip), so the shift is easy to see.

const NX = 288, NY = 192;
const WALL_X = 100, WALL_W = 3, SLIT_SEP = 30, SLIT_W = 7;
const SOL_X = WALL_X + WALL_W + 6, SOL_R = 3.5; // the solenoid, just behind the wall's middle bar
const DET_X = NX - 44; // the screen
const SPONGE = 18;
const K0 = 0.9; // packet wavenumber (radians per cell)

class AharonovBohmArchetype implements Archetype {
  readonly id = 'aharonovBohm';
  readonly kind = 'flow' as const;
  readonly particleCount = NX * NY;
  readonly alpha: number; // flux in units of the flux quantum h/e
  // two runs side by side: [0] with the flux, [1] without (the reference)
  readonly re: Float64Array[]; readonly im: Float64Array[]; readonly reP: Float64Array[]; readonly imP: Float64Array[];
  private readonly hr: Float64Array; private readonly hi: Float64Array;
  readonly wall: Uint8Array; private readonly absorb: Float64Array;
  readonly screen: Float64Array[]; // accumulated |ψ|² on the screen (per row)
  private readonly mask: Float32Array; private readonly show: Float64Array;
  private readonly positions: Float32Array; private readonly colors: Float32Array;
  readonly dt = 0.2;
  private speed = 1; t = 0; private peak = 1e-9; launches = 0;

  constructor(config: ArchetypeConfig) {
    this.alpha = config.params.flux ?? 0.5;
    this.readParams(config.params);
    const N = NX * NY;
    const f = (): Float64Array => new Float64Array(N);
    this.re = [f(), f()]; this.im = [f(), f()]; this.reP = [f(), f()]; this.imP = [f(), f()];
    this.hr = f(); this.hi = f(); this.absorb = f(); this.show = f();
    this.screen = [new Float64Array(NY), new Float64Array(NY)];
    this.wall = new Uint8Array(N); this.mask = new Float32Array(N);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, dy = j - NY / 2;
      const inWall = i >= WALL_X && i < WALL_X + WALL_W && Math.abs(Math.abs(dy) - SLIT_SEP / 2) > SLIT_W / 2;
      const inSol = Math.hypot(i - SOL_X, dy) <= SOL_R;
      if (inWall || inSol) { this.wall[k] = 1; this.mask[k] = inSol ? 0.9 : 0.45; }
      const d = Math.min(i, j, NX - 1 - i, NY - 1 - j);
      this.absorb[k] = d < SPONGE ? 1 - 0.06 * ((SPONGE - d) / SPONGE) ** 2 : 1;
    }
    this.positions = new Float32Array(N * 3); this.colors = new Float32Array(N * 3).fill(0.3);
    for (let k = 0; k < N; k++) { this.positions[k * 3] = ((k % NX) / NX - 0.5) * 3.4; this.positions[k * 3 + 1] = (Math.floor(k / NX) / NY - 0.5) * 3.4 * (NY / NX); }
    this.launch();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  /** A Gaussian packet moving right, wide enough to light both slits. */
  launch(): void {
    for (let r = 0; r < 2; r++) {
      const re = this.re[r], im = this.im[r];
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const k = j * NX + i, x = i - 45, y = j - NY / 2;
        const a = this.wall[k] ? 0 : Math.exp(-(x * x) / (2 * 9 * 9) - (y * y) / (2 * 26 * 26));
        re[k] = a * Math.cos(K0 * i); im[k] = a * Math.sin(K0 * i);
      }
      // normalise
      let n = 0; for (let k = 0; k < re.length; k++) n += re[k] * re[k] + im[k] * im[k];
      const s = 1 / Math.sqrt(n);
      for (let k = 0; k < re.length; k++) { re[k] *= s; im[k] *= s; }
      // the leapfrog needs ψ one step earlier: ψ(−dt) ≈ ψ + i dt Hψ − dt²/2 H²ψ
      const h1r = new Float64Array(re.length), h1i = new Float64Array(re.length);
      this.applyH(r, re, im); h1r.set(this.hr); h1i.set(this.hi);
      this.applyH(r, h1r, h1i);
      for (let k = 0; k < re.length; k++) {
        this.reP[r][k] = re[k] - this.dt * h1i[k] - 0.5 * this.dt * this.dt * this.hr[k];
        this.imP[r][k] = im[k] + this.dt * h1r[k] - 0.5 * this.dt * this.dt * this.hi[k];
      }
      this.screen[r].fill(0);
    }
    this.t = 0; this.launches++;
  }

  /** Hψ into (hr, hi): H = −½∇² on the lattice, with the solenoid's flux as a Peierls phase on the links that
   *  cross the cut running up from the solenoid (hopping right across it multiplies by e^{2πiα}). */
  private applyH(run: number, re: Float64Array, im: Float64Array): void {
    const hr = this.hr, hi = this.hi, wall = this.wall, a = run === 0 ? this.alpha : 0;
    const c = Math.cos(2 * Math.PI * a), s = Math.sin(2 * Math.PI * a), cutI = Math.floor(SOL_X), cutJ = NY / 2;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      if (wall[k]) { hr[k] = 0; hi[k] = 0; continue; }
      let sr = 0, si = 0;
      // left neighbour (hop from i−1 to i): across the cut it carries e^{+iθ}
      if (i > 0 && !wall[k - 1]) {
        if (i - 1 === cutI && j > cutJ) { sr += c * re[k - 1] - s * im[k - 1]; si += s * re[k - 1] + c * im[k - 1]; }
        else { sr += re[k - 1]; si += im[k - 1]; }
      }
      // right neighbour (hop from i+1 to i): across the cut it carries e^{−iθ}
      if (i < NX - 1 && !wall[k + 1]) {
        if (i === cutI && j > cutJ) { sr += c * re[k + 1] + s * im[k + 1]; si += -s * re[k + 1] + c * im[k + 1]; }
        else { sr += re[k + 1]; si += im[k + 1]; }
      }
      if (j > 0 && !wall[k - NX]) { sr += re[k - NX]; si += im[k - NX]; }
      if (j < NY - 1 && !wall[k + NX]) { sr += re[k + NX]; si += im[k + NX]; }
      hr[k] = 2 * re[k] - 0.5 * sr; hi[k] = 2 * im[k] - 0.5 * si;
    }
  }

  /** One second-order-differencing step: ψ⁺ = ψ⁻ − 2i dt Hψ (norm-preserving for dt·E_max < 1). */
  advance(): void {
    for (let r = 0; r < 2; r++) {
      const re = this.re[r], im = this.im[r], rp = this.reP[r], ip = this.imP[r];
      this.applyH(r, re, im);
      const hr = this.hr, hi = this.hi, ab = this.absorb, dt2 = 2 * this.dt;
      for (let k = 0; k < re.length; k++) {
        const nr = rp[k] + dt2 * hi[k], ni = ip[k] - dt2 * hr[k];
        rp[k] = re[k] * ab[k]; ip[k] = im[k] * ab[k];
        re[k] = nr * ab[k]; im[k] = ni * ab[k];
      }
      const sc = this.screen[r];
      for (let j = 0; j < NY; j++) { const k = j * NX + DET_X; sc[j] += re[k] * re[k] + im[k] * im[k]; }
    }
    this.t += this.dt;
  }

  norm(run: number): number { let n = 0; const re = this.re[run], im = this.im[run]; for (let k = 0; k < re.length; k++) n += re[k] * re[k] + im[k] * im[k]; return n; }

  /** The fringe shift, in fringes: phase of the screen pattern's main fringe component, relative to the reference. */
  fringeShift(): { shift: number; period: number } {
    const a = this.screen[0], b = this.screen[1];
    let best = 0, bestQ = 0;
    for (let per = 14; per < 70; per += 0.25) { // find the fringe spacing from the reference pattern
      const q = (2 * Math.PI) / per; let c = 0, s = 0;
      for (let j = SPONGE; j < NY - SPONGE; j++) { c += b[j] * Math.cos(q * j); s += b[j] * Math.sin(q * j); }
      const pw = c * c + s * s; if (pw > best) { best = pw; bestQ = q; }
    }
    const ph = (arr: Float64Array): number => { let c = 0, s = 0; for (let j = SPONGE; j < NY - SPONGE; j++) { c += arr[j] * Math.cos(bestQ * (j - NY / 2)); s += arr[j] * Math.sin(bestQ * (j - NY / 2)); } return Math.atan2(s, c); };
    let d = (ph(a) - ph(b)) / (2 * Math.PI);
    d -= Math.round(d);
    return { shift: d, period: (2 * Math.PI) / (bestQ || 1) };
  }

  private syncPositions(): void {
    const re = this.re[0], im = this.im[0], show = this.show;
    let m = 0;
    for (let k = 0; k < re.length; k++) { const v = Math.sqrt(re[k] * re[k] + im[k] * im[k]); show[k] = v; if (v > m) m = v; }
    this.peak = Math.max(m, this.peak * 0.996);
    // the screen: two strips at the right — bright = with flux, dim = without
    const s0 = this.screen[0], s1 = this.screen[1];
    let mx = 1e-30; for (let j = 0; j < NY; j++) mx = Math.max(mx, s0[j], s1[j]);
    for (let j = 0; j < NY; j++) {
      for (let i = DET_X + 8; i < DET_X + 22; i++) show[j * NX + i] = (s0[j] / mx) * this.peak * 0.9;
      for (let i = DET_X + 26; i < DET_X + 32; i++) show[j * NX + i] = (s1[j] / mx) * this.peak * 0.32;
    }
  }

  step(_dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const steps = Math.round(6 * this.speed);
    for (let s = 0; s < steps; s++) this.advance();
    if (this.norm(0) < 0.01 && this.t > 100) { const keep = [this.screen[0].slice(), this.screen[1].slice()]; this.launch(); this.screen[0].set(keep[0]); this.screen[1].set(keep[1]); } // keep building the pattern
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(): void { /* rebuilt, not restored */ }
  getHierarchy(): NodeSpec[] {
    const f = this.fringeShift();
    return [{
      id: 'root', parentId: null,
      label: `flux Φ = ${this.alpha.toFixed(2)} h/e → phase difference 2π × ${this.alpha.toFixed(2)} between the two paths → fringes shift by ${(this.alpha - Math.round(this.alpha)).toFixed(2)} of a fringe (measured on the screen: ${f.shift.toFixed(2)}) · packets so far ${this.launches}`,
      stateOffset: 0, stateLength: 1,
    }];
  }
  renderHint(): RenderHint { return { geometry: 'points', exposesField: true, pointSize: 0.02 }; }
  readField(): { texture: unknown; width: number; height: number; mask: ArrayLike<number>; scale: number; aspect: number; upright: boolean } {
    return { texture: this.show, width: NX, height: NY, mask: this.mask, scale: this.peak, aspect: NY / NX, upright: true };
  }
  dispose(): void { /* buffers GC with the instance */ }
}

export const aharonovBohmFactory: ArchetypeFactory = {
  id: 'aharonovBohm',
  label: 'Aharonov–Bohm Effect',
  category: 'Quantum',
  kind: 'flow',
  mainThread: true,
  fieldRender: true,
  params: [
    { key: 'flux', label: 'flux in the solenoid (units of h/e)', min: 0, max: 2, step: 0.05, default: 0.5, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: NX * NY,
  particleCountOptions: [NX * NY],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.35,
  create: (config) => new AharonovBohmArchetype(config),
};

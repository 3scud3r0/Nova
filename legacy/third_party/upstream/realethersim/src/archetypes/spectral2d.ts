// A small pseudo-spectral solver for 2-D incompressible flow with a buoyancy (or passive) scalar, on a doubly
// periodic box — shared by Rayleigh–Bénard convection and the shear/buoyancy instabilities. Vorticity–
// streamfunction form (u = −∂ψ/∂z, w = ∂ψ/∂x, ω = ∇²ψ):
//   ∂ω/∂t + u·∇ω = ν∇²ω + G ∂b/∂x
//   ∂b/∂t + u·∇b = κ∇²b + S w
// G couples buoyancy into the flow, S is a background gradient (S = 1 for convection with temperature falling
// linearly upward). Derivatives are exact in Fourier space; the products are done on the grid with 2/3
// dealiasing; diffusion is integrated exactly (integrating factor) and the rest with second-order
// Adams–Bashforth. Grid sizes must be powers of two.

export class FFT {
  readonly n: number;
  private readonly cos: Float64Array; private readonly sin: Float64Array; private readonly rev: Uint32Array;
  constructor(n: number) {
    this.n = n;
    this.cos = new Float64Array(n / 2); this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) { this.cos[k] = Math.cos((2 * Math.PI * k) / n); this.sin[k] = Math.sin((2 * Math.PI * k) / n); }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
  }
  /** In-place complex FFT of (re, im) at offset o with stride s; inverse = true for the unnormalised inverse. */
  run(re: Float64Array, im: Float64Array, o: number, s: number, inverse: boolean): void {
    const n = this.n, rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const a = o + i * s, b = o + j * s;
        let t = re[a]; re[a] = re[b]; re[b] = t;
        t = im[a]; im[a] = im[b]; im[b] = t;
      }
    }
    const sg = inverse ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, stepT = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * stepT], wi = sg * this.sin[k * stepT];
          const a = o + (i + k) * s, b = o + (i + k + half) * s;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }
}

export interface FlowParams {
  nu: number; // viscosity
  kappa: number; // scalar diffusivity
  G: number; // buoyancy coupling: ω gains G ∂b/∂x
  S: number; // background gradient: b gains S w
  oddZ: boolean; // keep ψ, ω, b odd about z = 0 (free-slip walls at z = 0 and z = Lz/2)
}

export class Boussinesq2D {
  readonly nx: number; readonly nz: number; readonly lx: number; readonly lz: number;
  readonly p: FlowParams;
  // spectral state
  readonly wr: Float64Array; readonly wi: Float64Array; // ω̂
  readonly br: Float64Array; readonly bi: Float64Array; // b̂
  // previous explicit right-hand sides (for Adams–Bashforth)
  private readonly rwr: Float64Array; private readonly rwi: Float64Array; private readonly rbr: Float64Array; private readonly rbi: Float64Array;
  private hasPrev = false; private lastDt = 0;
  private readonly kx: Float64Array; private readonly kz: Float64Array; private readonly k2: Float64Array; private readonly keep: Uint8Array;
  private readonly fx: FFT; private readonly fz: FFT;
  // grid work arrays
  private readonly ar: Float64Array; private readonly ai: Float64Array; private readonly cr: Float64Array; private readonly ci: Float64Array; private readonly er: Float64Array; private readonly ei: Float64Array;
  readonly u: Float64Array; readonly w: Float64Array; readonly b: Float64Array; readonly omega: Float64Array; // physical fields (after toGrid)
  private readonly g1: Float64Array; private readonly g2: Float64Array; private readonly g3: Float64Array; private readonly g4: Float64Array; // gradients
  private readonly nwr: Float64Array; private readonly nwi: Float64Array; private readonly nbr: Float64Array; private readonly nbi: Float64Array; // this step's right-hand sides
  t = 0;

  constructor(nx: number, nz: number, lx: number, lz: number, p: FlowParams) {
    this.nx = nx; this.nz = nz; this.lx = lx; this.lz = lz; this.p = p;
    const N = nx * nz;
    const mk = (): Float64Array => new Float64Array(N);
    this.wr = mk(); this.wi = mk(); this.br = mk(); this.bi = mk();
    this.rwr = mk(); this.rwi = mk(); this.rbr = mk(); this.rbi = mk();
    this.ar = mk(); this.ai = mk(); this.cr = mk(); this.ci = mk(); this.er = mk(); this.ei = mk();
    this.u = mk(); this.w = mk(); this.b = mk(); this.omega = mk();
    this.g1 = mk(); this.g2 = mk(); this.g3 = mk(); this.g4 = mk();
    this.nwr = mk(); this.nwi = mk(); this.nbr = mk(); this.nbi = mk();
    this.kx = mk(); this.kz = mk(); this.k2 = mk(); this.keep = new Uint8Array(N);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, mi = i <= nx / 2 ? i : i - nx, mj = j <= nz / 2 ? j : j - nz;
      this.kx[k] = (2 * Math.PI * mi) / lx; this.kz[k] = (2 * Math.PI * mj) / lz;
      this.k2[k] = this.kx[k] ** 2 + this.kz[k] ** 2;
      this.keep[k] = Math.abs(mi) < nx / 3 && Math.abs(mj) < nz / 3 ? 1 : 0; // 2/3 rule
    }
    this.fx = new FFT(nx); this.fz = new FFT(nz);
  }

  /** 2-D FFT in place (rows then columns). Inverse is normalised. */
  fft2(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const nx = this.nx, nz = this.nz;
    for (let j = 0; j < nz; j++) this.fx.run(re, im, j * nx, 1, inverse);
    for (let i = 0; i < nx; i++) this.fz.run(re, im, i, nx, inverse);
    if (inverse) { const s = 1 / (nx * nz); for (let k = 0; k < nx * nz; k++) { re[k] *= s; im[k] *= s; } }
  }

  /** Load physical fields ω and b (grid arrays) into the spectral state. */
  setFields(omega: Float64Array, b: Float64Array): void {
    this.wr.set(omega); this.wi.fill(0); this.fft2(this.wr, this.wi, false);
    this.br.set(b); this.bi.fill(0); this.fft2(this.br, this.bi, false);
    this.project();
    this.hasPrev = false;
  }

  /** Two real fields from their spectra at once: a = IFFT(A), c = IFFT(C) via one complex transform of A + iC. */
  private toGrid2(Ar: Float64Array, Ai: Float64Array, Cr: Float64Array, Ci: Float64Array, outA: Float64Array, outC: Float64Array): void {
    const N = this.nx * this.nz, er = this.er, ei = this.ei;
    for (let k = 0; k < N; k++) { er[k] = Ar[k] - Ci[k]; ei[k] = Ai[k] + Cr[k]; }
    this.fft2(er, ei, true);
    outA.set(er); outC.set(ei);
  }

  /** Spectra of two real grid fields at once (one complex transform), into (Ar, Ai) and (Cr, Ci). */
  private toSpec2(a: Float64Array, c: Float64Array, Ar: Float64Array, Ai: Float64Array, Cr: Float64Array, Ci: Float64Array): void {
    const nx = this.nx, nz = this.nz, er = this.er, ei = this.ei;
    er.set(a); ei.set(c);
    this.fft2(er, ei, false);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, m = ((nz - j) % nz) * nx + ((nx - i) % nx); // index of −k
      Ar[k] = 0.5 * (er[k] + er[m]); Ai[k] = 0.5 * (ei[k] - ei[m]);
      Cr[k] = 0.5 * (ei[k] + ei[m]); Ci[k] = -0.5 * (er[k] - er[m]);
    }
  }

  /** Physical u, w, b, ω on the grid from the current state. */
  toGrid(): void {
    const N = this.nx * this.nz, { wr, wi, kx, kz, k2 } = this;
    const ur = this.ar, ui = this.ai, vr = this.cr, vi = this.ci;
    for (let k = 0; k < N; k++) {
      const inv = k2[k] > 0 ? -1 / k2[k] : 0, pr = wr[k] * inv, pi = wi[k] * inv; // ψ̂ = −ω̂/k²
      ur[k] = kz[k] * pi; ui[k] = -kz[k] * pr; // û = −i kz ψ̂
      vr[k] = -kx[k] * pi; vi[k] = kx[k] * pr; // ŵ = i kx ψ̂
    }
    this.toGrid2(ur, ui, vr, vi, this.u, this.w);
    this.toGrid2(this.wr, this.wi, this.br, this.bi, this.omega, this.b);
  }

  /** Only ω and b on the grid (one transform) — enough for drawing. */
  scalarsToGrid(): void { this.toGrid2(this.wr, this.wi, this.br, this.bi, this.omega, this.b); }

  /** Explicit right-hand sides (advection, buoyancy, background) for the current state into (Rw, Rb). */
  private rhs(Rwr: Float64Array, Rwi: Float64Array, Rbr: Float64Array, Rbi: Float64Array): void {
    const N = this.nx * this.nz, { wr, wi, br, bi, kx, kz, keep } = this, p = this.p;
    this.toGrid();
    // gradients of ω and b
    const g1 = this.g1, g2 = this.g2, g3 = this.g3, g4 = this.g4;
    const ar = this.ar, ai = this.ai, cr = this.cr, ci = this.ci;
    for (let k = 0; k < N; k++) { ar[k] = -kx[k] * wi[k]; ai[k] = kx[k] * wr[k]; cr[k] = -kz[k] * wi[k]; ci[k] = kz[k] * wr[k]; }
    this.toGrid2(ar, ai, cr, ci, g1, g2); // ω_x, ω_z
    for (let k = 0; k < N; k++) { ar[k] = -kx[k] * bi[k]; ai[k] = kx[k] * br[k]; cr[k] = -kz[k] * bi[k]; ci[k] = kz[k] * br[k]; }
    this.toGrid2(ar, ai, cr, ci, g3, g4); // b_x, b_z
    const u = this.u, w = this.w;
    for (let k = 0; k < N; k++) { g1[k] = -(u[k] * g1[k] + w[k] * g2[k]); g3[k] = -(u[k] * g3[k] + w[k] * g4[k]) + p.S * w[k]; }
    this.toSpec2(g1, g3, Rwr, Rwi, Rbr, Rbi);
    for (let k = 0; k < N; k++) {
      if (!keep[k]) { Rwr[k] = 0; Rwi[k] = 0; Rbr[k] = 0; Rbi[k] = 0; continue; }
      Rwr[k] += p.G * -kx[k] * bi[k]; Rwi[k] += p.G * kx[k] * br[k]; // + G ∂b/∂x
    }
  }

  /** Keep the symmetry the walls need (odd in z), and remove the mean of ω. */
  private project(): void {
    const { nx, nz } = this;
    this.wr[0] = 0; this.wi[0] = 0;
    if (!this.p.oddZ) return;
    for (const [re, im] of [[this.wr, this.wi], [this.br, this.bi]] as const) {
      for (let j = 0; j <= nz / 2; j++) {
        const jm = (nz - j) % nz;
        for (let i = 0; i < nx; i++) {
          const a = j * nx + i, b = jm * nx + i;
          if (a === b) { re[a] = 0; im[a] = 0; continue; }
          const r = 0.5 * (re[a] - re[b]), q = 0.5 * (im[a] - im[b]);
          re[a] = r; im[a] = q; re[b] = -r; im[b] = -q;
        }
      }
    }
  }

  /** Largest advective speed on the grid (for the time-step choice) — from the last toGrid() or step(). */
  maxSpeed(): number { let m = 0; for (let k = 0; k < this.u.length; k++) m = Math.max(m, Math.abs(this.u[k]) + Math.abs(this.w[k])); return m; }

  /** One integrating-factor Adams–Bashforth-2 step of size dt. */
  step(dt: number): void {
    const N = this.nx * this.nz, { k2 } = this, p = this.p;
    const Rwr = this.nwr, Rwi = this.nwi, Rbr = this.nbr, Rbi = this.nbi;
    this.rhs(Rwr, Rwi, Rbr, Rbi);
    const ab = this.hasPrev && Math.abs(dt - this.lastDt) < 1e-12 * dt + 1e-15;
    for (let k = 0; k < N; k++) {
      const Ew = Math.exp(-p.nu * k2[k] * dt), Eb = Math.exp(-p.kappa * k2[k] * dt);
      if (ab) {
        this.wr[k] = Ew * (this.wr[k] + 1.5 * dt * Rwr[k]) - 0.5 * dt * Ew * Ew * this.rwr[k];
        this.wi[k] = Ew * (this.wi[k] + 1.5 * dt * Rwi[k]) - 0.5 * dt * Ew * Ew * this.rwi[k];
        this.br[k] = Eb * (this.br[k] + 1.5 * dt * Rbr[k]) - 0.5 * dt * Eb * Eb * this.rbr[k];
        this.bi[k] = Eb * (this.bi[k] + 1.5 * dt * Rbi[k]) - 0.5 * dt * Eb * Eb * this.rbi[k];
      } else { // first step (or after dt changed): integrating-factor Euler
        this.wr[k] = Ew * (this.wr[k] + dt * Rwr[k]); this.wi[k] = Ew * (this.wi[k] + dt * Rwi[k]);
        this.br[k] = Eb * (this.br[k] + dt * Rbr[k]); this.bi[k] = Eb * (this.bi[k] + dt * Rbi[k]);
      }
    }
    this.rwr.set(Rwr); this.rwi.set(Rwi); this.rbr.set(Rbr); this.rbi.set(Rbi);
    this.hasPrev = true; this.lastDt = dt;
    this.project();
    this.t += dt;
  }
}

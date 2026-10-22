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

// Star: Balance and Collapse — a star is a ball of gas held up by its own pressure against its own gravity.
// Shown as a slice through the middle, hot core white, cooler layers red; the brightness follows the density.
// "A star in balance": the classic model of a Sun-like star (a polytrope of index 3, Eddington's "standard
// model"), with pressure and gravity balanced at every depth — give it a nudge and it rings, breathing in and
// out, with a period set by its mean density alone (the reason a Cepheid's pulsation period tells you its
// size). "Core collapse": the same ball, but with the gas made slightly too soft to hold itself up — as happens
// when an old star's iron core can no longer generate heat and its electrons are squeezed into nuclei. It falls
// inward, faster and faster, until the centre reaches nuclear density and suddenly becomes stiff: the inner core
// stops and rebounds, and the infalling layers slam into it, launching a shock wave outward — the start of a
// core-collapse supernova. This is a toy: it leaves out the neutrinos and the energy lost breaking up nuclei that
// make the real shock stall (and need neutrino heating to restart it).

const SCENES = { 'a star in balance': 0, 'core collapse': 1 };
const NZ = 160; // mass shells
const MEXP = 1.3; // mass-coordinate stretch (finer shells near the centre)
const G = 1;

/** Lane–Emden θ(ξ) for index n: returns arrays up to the first zero ξ₁. */
export function laneEmden(n: number, h = 1e-4): { xi: number[]; theta: number[]; dtheta: number[]; xi1: number; mass: number } {
  // θ'' + (2/ξ)θ' + θⁿ = 0, series start θ ≈ 1 − ξ²/6
  let xi = 1e-4, th = 1 - (xi * xi) / 6, dth = -xi / 3;
  const XI = [0, xi], TH = [1, th], DTH = [0, dth];
  const f = (x: number, t: number, d: number): [number, number] => [d, -Math.pow(Math.max(t, 0), n) - (2 / x) * d];
  while (th > 0) {
    const k1 = f(xi, th, dth), k2 = f(xi + h / 2, th + (h / 2) * k1[0], dth + (h / 2) * k1[1]);
    const k3 = f(xi + h / 2, th + (h / 2) * k2[0], dth + (h / 2) * k2[1]), k4 = f(xi + h, th + h * k3[0], dth + h * k3[1]);
    const nth = th + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), ndth = dth + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    if (nth <= 0) { // the surface: interpolate to θ = 0
      const f0 = th / (th - nth), xi1 = xi + f0 * h, d1 = dth + f0 * (ndth - dth);
      XI.push(xi1); TH.push(0); DTH.push(d1);
      return { xi: XI, theta: TH, dtheta: DTH, xi1, mass: -xi1 * xi1 * d1 };
    }
    xi += h; th = nth; dth = ndth;
    XI.push(xi); TH.push(th); DTH.push(dth);
  }
  return { xi: XI, theta: TH, dtheta: DTH, xi1: xi, mass: -xi * xi * dth };
}

class StellarCollapseArchetype implements Archetype {
  readonly id = 'stellarCollapse';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  readonly scene: number;
  // Lagrangian hydro: interfaces r[0..NZ] (r[0] = 0), velocities u at interfaces, per-shell mass, internal energy
  readonly r = new Float64Array(NZ + 1); readonly u = new Float64Array(NZ + 1);
  readonly dm = new Float64Array(NZ); readonly e = new Float64Array(NZ); readonly rho = new Float64Array(NZ);
  private readonly P = new Float64Array(NZ); private readonly q = new Float64Array(NZ); private readonly menc = new Float64Array(NZ + 1);
  readonly K: number; readonly rhoC0: number; readonly gamma1: number;
  readonly rhoNuc: number;
  // EOS: ideal gas (Γ = 5/3) in balance; hybrid (soft below nuclear density, stiff above, thermal part Γ_th) for collapse
  private readonly G1: number; private readonly G2 = 2.5; private readonly Gth = 1.5; private readonly K1: number; private readonly K2: number; private readonly E3: number;
  // drawing
  private readonly shellOf: Uint16Array; private readonly frac: Float32Array; private readonly ang: Float32Array;
  private speed = 1;
  t = 0; bounceT = -1; private loops = 0;
  readonly R0: number;
  readonly dynTime: number;

  constructor(config: ArchetypeConfig, kick = true) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    this.scene = Math.round(config.params.scene ?? 0);
    this.gamma1 = config.params.gamma ?? 1.3;
    this.R0 = config.params.radius ?? 1;
    this.readParams(config.params);
    // the n = 3 polytrope with M = 1, R = R0
    const le = laneEmden(3), alpha = this.R0 / le.xi1;
    this.rhoC0 = 1 / (4 * Math.PI * alpha ** 3 * le.mass); // M = 4π ρc α³ (−ξ₁² θ'(ξ₁))
    this.K = (4 * Math.PI * G * alpha * alpha * Math.pow(this.rhoC0, 2 / 3)) / 4; // α² = (n+1) K ρc^{1/n − 1} / (4πG)
    this.dynTime = 1 / Math.sqrt(G * (3 / (4 * Math.PI * this.R0 ** 3)));
    // equal-ish mass shells, finer towards the centre (by mass coordinate)
    const mOf = (xi: number): number => { // enclosed mass at ξ (interpolated from the table)
      let lo = 0, hi = le.xi.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (le.xi[m] < xi) lo = m; else hi = m; }
      const f = (xi - le.xi[lo]) / (le.xi[hi] - le.xi[lo] || 1), d = le.dtheta[lo] + f * (le.dtheta[hi] - le.dtheta[lo]);
      return (-xi * xi * d) / le.mass;
    };
    // interface radii: mass coordinate m_i = (i/NZ)^MEXP (finer near the centre, where things happen)
    this.r[0] = 0;
    for (let i = 1; i <= NZ; i++) {
      const mt = Math.pow(i / NZ, MEXP);
      let a = 0, b = le.xi1;
      for (let k = 0; k < 60; k++) { const m = (a + b) / 2; if (mOf(m) < mt) a = m; else b = m; }
      this.r[i] = (i === NZ ? le.xi1 : (a + b) / 2) * alpha;
    }
    for (let j = 0; j < NZ; j++) this.dm[j] = Math.pow((j + 1) / NZ, MEXP) - Math.pow(j / NZ, MEXP);
    // EOS constants
    this.G1 = this.scene === 0 ? 5 / 3 : this.gamma1;
    this.rhoNuc = this.rhoC0 * 400; // the core stiffens at 400× its starting density (a toy "nuclear density")
    this.K1 = this.K; // the same K: with Γ1 < 4/3 the gas is softer than the star needs wherever ρ > 1
    this.K2 = this.K1 * Math.pow(this.rhoNuc, this.G1 - this.G2);
    this.E3 = (this.K1 * Math.pow(this.rhoNuc, this.G1 - 1)) / (this.G1 - 1) - (this.K2 * Math.pow(this.rhoNuc, this.G2 - 1)) / (this.G2 - 1);
    // initial internal energy: whatever gives the polytrope's pressure P = K ρ^{4/3} under this EOS
    this.density();
    for (let j = 0; j < NZ; j++) {
      const rh = this.rho[j], Pw = this.K * Math.pow(rh, 4 / 3);
      if (this.scene === 0) this.e[j] = Pw / ((5 / 3 - 1) * rh);
      else this.e[j] = this.eCold(rh); // cold: the soft EOS can't quite support it → collapse
    }
    this.mass();
    this.pressure();
    if (this.scene === 0) {
      // settle onto this grid's own balance (the smooth polytrope is only nearly balanced once cut into shells)
      for (let k = 0; k < 4000; k++) { this.advance(0.02 * this.dynTime); for (let i = 0; i <= NZ; i++) this.u[i] *= 0.97; }
      this.u.fill(0); this.q.fill(0); this.t = 0;
      if (kick) for (let i = 1; i <= NZ; i++) this.u[i] = 0.02 * (this.r[i] / this.R0) / this.dynTime; // a gentle outward nudge
    }

    // drawing: points across the slice, more where the gas is denser (∝ ρ·r·dr per shell at the start)
    const rng = mulberry32(config.seed);
    const wts = new Float64Array(NZ);
    let wsum = 0;
    for (let j = 0; j < NZ; j++) { const rm = 0.5 * (this.r[j] + this.r[j + 1]); wts[j] = Math.pow(this.rho[j], 0.35) * rm * (this.r[j + 1] - this.r[j]); wsum += wts[j]; }
    this.shellOf = new Uint16Array(P); this.frac = new Float32Array(P); this.ang = new Float32Array(P);
    let p = 0;
    for (let j = 0; j < NZ; j++) {
      const n = j === NZ - 1 ? P - p : Math.round((wts[j] / wsum) * P);
      for (let q = 0; q < n && p < P; q++, p++) { this.shellOf[p] = j; this.frac[p] = rng(); this.ang[p] = rng() * Math.PI * 2; }
    }
    for (; p < P; p++) { this.shellOf[p] = NZ - 1; this.frac[p] = rng(); this.ang[p] = rng() * Math.PI * 2; }
    // colour by the starting temperature (T ∝ P/ρ): white-hot core → yellow → deep red outside
    let tmax = 0;
    for (let j = 0; j < NZ; j++) tmax = Math.max(tmax, this.P[j] / this.rho[j]);
    for (let k = 0; k < P; k++) {
      const j = this.shellOf[k], T = Math.pow((this.K * Math.pow(this.rho[j], 4 / 3)) / this.rho[j] / tmax, 0.6);
      hslToRgb(0.0 + 0.13 * T, 0.95, 0.35 + 0.45 * T, this.colors, k * 3);
    }
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  private eCold(rh: number): number {
    return rh < this.rhoNuc ? (this.K1 * Math.pow(rh, this.G1 - 1)) / (this.G1 - 1) : (this.K2 * Math.pow(rh, this.G2 - 1)) / (this.G2 - 1) + this.E3;
  }
  private pCold(rh: number): number { return rh < this.rhoNuc ? this.K1 * Math.pow(rh, this.G1) : this.K2 * Math.pow(rh, this.G2); }

  private pAt(rh: number, e: number): number {
    return this.scene === 0 ? (5 / 3 - 1) * rh * e : this.pCold(rh) + (this.Gth - 1) * rh * Math.max(0, e - this.eCold(rh));
  }

  private density(): void {
    for (let j = 0; j < NZ; j++) this.rho[j] = this.dm[j] / ((4 * Math.PI / 3) * (this.r[j + 1] ** 3 - this.r[j] ** 3));
  }
  private mass(): void { this.menc[0] = 0; for (let j = 0; j < NZ; j++) this.menc[j + 1] = this.menc[j] + this.dm[j]; }
  private pressure(): void {
    for (let j = 0; j < NZ; j++) {
      const rh = this.rho[j];
      if (this.scene === 0) this.P[j] = (5 / 3 - 1) * rh * this.e[j];
      else this.P[j] = this.pCold(rh) + (this.Gth - 1) * rh * Math.max(0, this.e[j] - this.eCold(rh));
    }
  }

  /** One von Neumann–Richtmyer step (leapfrog, artificial viscosity); returns dt. */
  advance(maxDt: number): number {
    const { r, u, dm, e, rho, P, q, menc } = this;
    // time step: sound crossing of the thinnest shell
    let dt = maxDt;
    for (let j = 0; j < NZ; j++) {
      const cs = Math.sqrt(Math.max(1e-12, (this.scene === 0 ? 5 / 3 : Math.max(this.G2, this.Gth)) * P[j] / rho[j]));
      dt = Math.min(dt, (0.25 * (r[j + 1] - r[j])) / (cs + Math.abs(u[j + 1] - u[j]) + 1e-12));
    }
    // accelerate the interfaces: pressure (and viscosity) gradient + gravity
    for (let i = 1; i <= NZ; i++) {
      const pin = P[i - 1] + q[i - 1], pout = i < NZ ? P[i] + q[i] : 0;
      const mavg = i < NZ ? 0.5 * (dm[i - 1] + dm[i]) : 0.5 * dm[i - 1];
      const a = (-4 * Math.PI * r[i] * r[i] * (pout - pin)) / mavg - (G * menc[i]) / (r[i] * r[i]);
      u[i] += a * dt;
    }
    const vOld = new Float64Array(NZ);
    for (let j = 0; j < NZ; j++) vOld[j] = 1 / rho[j];
    for (let i = 1; i <= NZ; i++) r[i] += u[i] * dt;
    for (let i = 1; i <= NZ; i++) if (r[i] <= r[i - 1]) r[i] = r[i - 1] * 1.0001 + 1e-9; // never let a shell turn inside out
    this.density();
    // artificial viscosity (only in compression) and the energy equation de = −(P̄ + q) dV, with P̄ the average of
    // the old and new pressure (predictor–corrector) so the work done in compression is counted properly
    for (let j = 0; j < NZ; j++) {
      const du = u[j + 1] - u[j];
      q[j] = du < 0 ? rho[j] * (2 * du * du + 0.3 * Math.abs(du) * Math.sqrt(Math.max(1e-12, P[j] / rho[j]))) : 0;
      const dV = 1 / rho[j] - vOld[j], pOld = P[j];
      let eNew = e[j] - (pOld + q[j]) * dV;
      for (let it = 0; it < 2; it++) eNew = e[j] - (0.5 * (pOld + this.pAt(rho[j], eNew)) + q[j]) * dV;
      e[j] = Math.max(eNew, 1e-12);
    }
    this.pressure();
    this.t += dt;
    return dt;
  }

  /** Total energy: kinetic + internal − gravitational binding. */
  energy(): number {
    let ek = 0, ei = 0, eg = 0;
    for (let j = 0; j < NZ; j++) {
      const um = 0.5 * (this.u[j] + this.u[j + 1]); ek += 0.5 * this.dm[j] * um * um; ei += this.dm[j] * this.e[j];
      const rm = 0.5 * (this.r[j] + this.r[j + 1]); eg -= (G * (this.menc[j] + 0.5 * this.dm[j]) * this.dm[j]) / rm;
    }
    return ek + ei + eg;
  }

  private syncPositions(): void {
    const pos = this.positions, s = 1.55 / this.R0;
    for (let k = 0; k < this.particleCount; k++) {
      const j = this.shellOf[k], f = this.frac[k];
      // uniform in area across the shell's annulus
      const r0 = this.r[j], r1 = this.r[j + 1], rr = Math.sqrt(r0 * r0 + f * (r1 * r1 - r0 * r0)) * s;
      const rd = Math.min(rr, 40); // ejected gas simply flies out of the frame
      pos[k * 3] = rd * Math.cos(this.ang[k]); pos[k * 3 + 1] = rd * Math.sin(this.ang[k]); pos[k * 3 + 2] = 0;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    // pace: the balance scene shows a few breaths; the collapse slows down near bounce automatically (small dt)
    let T = dt * this.speed * this.dynTime * (this.scene === 0 ? 1.2 : 0.12);
    let guard = 0;
    while (T > 1e-12 && guard++ < 400) T -= this.advance(T);
    if (this.scene === 1) {
      if (this.bounceT < 0 && this.rho[0] > this.rhoNuc && this.u[1] > 0) this.bounceT = this.t;
      if (this.bounceT > 0 && this.t > this.bounceT + 2.5 * this.dynTime) this.restart();
    }
    this.syncPositions();
  }

  private restart(): void {
    const fresh = new StellarCollapseArchetype({ particleCount: 16, seed: 1, params: { scene: this.scene, gamma: this.gamma1, radius: this.R0, speed: this.speed } as unknown as ResolvedParams });
    this.r.set(fresh.r); this.u.set(fresh.u); this.e.set(fresh.e);
    this.density(); this.pressure(); this.q.fill(0);
    this.t = 0; this.bounceT = -1; this.loops++;
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(): void { /* rebuilt, not restored */ }
  getHierarchy(): NodeSpec[] {
    const t = this.t / this.dynTime;
    let label: string;
    if (this.scene === 0) label = `n = 3 polytrope (M = 1, R = ${this.R0}), central density ${(this.rhoC0 / (3 / (4 * Math.PI * this.R0 ** 3))).toFixed(1)}× the mean · breathing after a nudge · t = ${t.toFixed(2)} dynamical times`;
    else label = `Γ = ${this.gamma1} (< 4/3: too soft to stand) · central density ${(this.rho[0] / this.rhoC0).toFixed(1)}× start${this.bounceT > 0 ? ` · bounce at t = ${(this.bounceT / this.dynTime).toFixed(2)}; the shock is moving out` : ' · collapsing'} · run ${this.loops + 1}`;
    return [{ id: 'root', parentId: null, label, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const stellarCollapseFactory: ArchetypeFactory = {
  id: 'stellarCollapse',
  label: 'Star: Balance and Collapse',
  category: 'Cosmology',
  kind: 'flow',
  params: [
    { key: 'scene', label: 'set-up', min: 0, max: 1, step: 1, default: 1, options: SCENES, rebuild: true },
    { key: 'gamma', label: 'collapse: softness Γ', min: 1.2, max: 1.33, step: 0.005, default: 1.3, rebuild: true },
    { key: 'radius', label: 'balance: star radius', min: 0.6, max: 1.5, step: 0.05, default: 1, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new StellarCollapseArchetype(config),
};

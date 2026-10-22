import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';

// Analog Warp Bubble (Flume) — a warp bubble you could build on a lab bench. Surface waves on moving
// water obey the same equation as light on a curved spacetime (Unruh's acoustic metric, 1981), and with
// the flow shaped like the Alcubierre shift vector the water reproduces a warp bubble's horizons. In the
// frame of the "ship" (a wave plunger at the centre) water streams past at speed U everywhere except
// inside a sheltered pocket whose edge has the Alcubierre top-hat profile. When the stream is faster than
// the wave speed (Froude number Fr = U/c > 1), the pocket edge where the flow reaches c is a horizon:
// crests sent forward stall and bunch up at the front wall (a white-hole horizon, blueshift), crests sent
// back are swept away (a black-hole horizon). Lower Fr below 1 and the horizons vanish. Colour marks the
// water itself: blue where waves can still travel upstream (flow slower than c), orange where the stream
// outruns them; the red ring is the horizon. This system was first written with the Gravity MCP server
// for the AWB-1 analog-warp-flume experiment design (a 1.5 m acrylic channel, 20 mm deep, Fr 0.6 vs 1.6).

class WarpFlumeArchetype implements Archetype {
  readonly id = 'warpFlume';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly NX: number; private readonly NY: number; private readonly N: number;
  private readonly eta: Float32Array; private readonly phi: Float32Array;
  private readonly ta: Float32Array; private readonly tb: Float32Array;
  private readonly vx: Float32Array; private readonly sponge: Float32Array;
  private readonly cx: number; private readonly cy: number; private readonly SC: number;
  private readonly Fr: number; private readonly R: number; private readonly sigma: number;
  private rh = -1;
  private omega = 0.5;
  private amp = 0.5;
  private speed = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const n = config.particleCount;
    this.particleCount = n;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.Fr = config.params.Fr ?? 1.6;
    this.R = config.params.R ?? 34;
    this.sigma = config.params.sigma ?? 0.22;
    this.readParams(config.params);
    // grid sized to the particle budget, aspect 5:2, leaving ~6% for the horizon ring and plunger
    const cells = Math.floor(n * 0.94);
    this.NY = Math.max(16, Math.floor(Math.sqrt(cells / 2.5)));
    this.NX = Math.max(40, Math.floor(cells / this.NY));
    this.N = this.NX * this.NY;
    const N = this.N;
    this.eta = new Float32Array(N); this.phi = new Float32Array(N); this.ta = new Float32Array(N); this.tb = new Float32Array(N);
    this.vx = new Float32Array(N); this.sponge = new Float32Array(N);
    this.cx = this.NX * 0.5; this.cy = this.NY * 0.5; this.SC = 16 / this.NX;
    const SPONGE = Math.max(6, Math.floor(this.NX * 0.06));
    const shape = (r: number): number => (Math.tanh(this.sigma * (r + this.R)) - Math.tanh(this.sigma * (r - this.R))) / (2 * Math.tanh(this.sigma * this.R));
    for (let j = 0; j < this.NY; j++) for (let i = 0; i < this.NX; i++) {
      const k = j * this.NX + i, r = Math.hypot(i - this.cx, j - this.cy);
      this.vx[k] = -this.Fr * (1 - shape(r));
      const d = Math.min(i, this.NX - 1 - i, j, this.NY - 1 - j);
      this.sponge[k] = d < SPONGE ? 0.25 * Math.pow(1 - d / SPONGE, 2) : 0;
      // colour: how fast the water runs compared with the wave speed (|V| = c is the horizon)
      const sp = Math.abs(this.vx[k]);
      if (sp < 1) hslToRgb(0.57, 0.8, 0.5 + 0.2 * (1 - sp), this.colors, k * 3);
      else hslToRgb(0.07, 0.9, 0.55 + 0.1 * Math.min(1, sp - 1), this.colors, k * 3);
      for (let c = 0; c < 3; c++) this.colors[k * 3 + c] *= 1.35;
    }
    if (this.Fr > 1) { // the horizon radius: 1 − f(r) = 1/Fr, by bisection on the monotone wall
      let a = 0, b = this.R * 3;
      for (let k = 0; k < 60; k++) { const m = (a + b) / 2; if (1 - shape(m) < 1 / this.Fr) a = m; else b = m; }
      this.rh = (a + b) / 2;
    }
    const mN = n - N;
    for (let q = 0; q < mN; q++) {
      if (q < mN * 0.8) hslToRgb(0.98, 0.9, 0.6, this.colors, (N + q) * 3); // horizon (red, as in River of Space) / pocket wall
      else hslToRgb(0.12, 0.9, 0.65, this.colors, (N + q) * 3); // the plunger
    }
    // let the wave pattern establish itself so the system opens formed
    for (let k = 0; k < 260; k++) this.advance(0.05);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.omega = p.omega ?? 0.5;
    this.amp = p.amp ?? 0.5;
    this.speed = p.speed ?? 1;
  }

  // cubic (Catmull–Rom) sample along x of row j: the stream runs along x, so advection is 1-D per row
  private sampleX(f: Float32Array, x: number, j: number): number {
    const NX = this.NX;
    x = Math.max(1, Math.min(NX - 2.001, x));
    const i = x | 0, u = x - i, k = j * NX + i;
    const p0 = f[k - 1], p1 = f[k], p2 = f[k + 1], p3 = f[Math.min(k + 2, j * NX + NX - 1)];
    return p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));
  }

  private substep(h: number): void {
    const { NX, NY, N, eta, phi, ta, tb, vx, sponge, cx, cy } = this;
    // 1. advect η and φ with the stream
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, x0 = i - vx[k] * h;
      ta[k] = this.sampleX(eta, x0, j); tb[k] = this.sampleX(phi, x0, j);
    }
    eta.set(ta); phi.set(tb);
    // 2. waves: φ_t = −η ; η_t = −∇²φ   (g = 1, depth = c² = 1)
    for (let k = 0; k < N; k++) phi[k] -= h * eta[k];
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = j * NX + i;
      eta[k] -= h * (phi[k - 1] + phi[k + 1] + phi[k - NX] + phi[k + NX] - 4 * phi[k]);
    }
    // 3. the plunger at the ship (a soft disc source) and absorbing edges
    const src = this.amp * Math.sin(this.omega * this.t) * h * 0.6;
    for (let j = Math.floor(cy - 3); j <= cy + 3; j++) for (let i = Math.floor(cx - 3); i <= cx + 3; i++) {
      const d2 = (i - cx) ** 2 + (j - cy) ** 2;
      if (d2 < 9) eta[j * NX + i] += src * Math.exp(-d2 / 4);
    }
    for (let k = 0; k < N; k++) { const s = 1 - sponge[k]; eta[k] *= s; phi[k] *= s; }
    this.t += h;
  }

  private advance(dt: number): void {
    const h = dt * 10; // two substeps of 0.25 cell-times at dt = 0.05
    this.substep(h / 2); this.substep(h / 2);
  }

  private syncPositions(): void {
    const { NX, NY, N, eta, cx, cy, SC } = this;
    const pos = this.positions;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, o = k * 3;
      pos[o] = (i - cx) * SC; pos[o + 1] = Math.max(-1.5, Math.min(1.5, eta[k] * 2.2)); pos[o + 2] = (j - cy) * SC;
    }
    const mN = this.particleCount - N;
    for (let q = 0; q < mN; q++) {
      const o = (N + q) * 3;
      if (q < mN * 0.8) {
        const a = (q / (mN * 0.8)) * Math.PI * 2, r = this.rh > 0 ? this.rh : this.R;
        pos[o] = r * Math.cos(a) * SC; pos[o + 1] = 0.55; pos[o + 2] = r * Math.sin(a) * SC;
      } else {
        const s = (q - mN * 0.8) / (mN * 0.2);
        pos[o] = 0.04 * Math.cos(s * 40); pos[o + 1] = 0.1 + s * 0.9; pos[o + 2] = 0.04 * Math.sin(s * 40);
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const h = dt * this.speed;
    if (h > 0) this.advance(h);
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const s = new Float64Array(1 + 2 * this.N);
    s[0] = this.t; s.set(this.eta, 1); s.set(this.phi, 1 + this.N);
    return s;
  }
  loadState(s: Float64Array): void {
    if (s.length !== 1 + 2 * this.N) return;
    this.t = s[0]; this.eta.set(s.subarray(1, 1 + this.N)); this.phi.set(s.subarray(1 + this.N));
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const label = this.Fr > 1
      ? `Fr = ${this.Fr.toFixed(2)}: horizons at r = ${(this.rh / this.R).toFixed(2)} R (front white-hole, rear black-hole)`
      : `Fr = ${this.Fr.toFixed(2)}: no horizon — waves escape upstream`;
    return [{ id: 'root', parentId: null, label, stateOffset: 0, stateLength: 1 + 2 * this.N }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const warpFlumeFactory: ArchetypeFactory = {
  id: 'warpFlume',
  label: 'Analog Warp Bubble (Flume)',
  category: 'Spacetime',
  kind: 'flow',
  params: [
    { key: 'Fr', label: 'stream speed / wave speed (Fr)', min: 0.2, max: 2.5, step: 0.05, default: 1.6, rebuild: true },
    { key: 'R', label: 'pocket radius (cells)', min: 12, max: 44, step: 1, default: 34, rebuild: true },
    { key: 'sigma', label: 'wall sharpness σ', min: 0.06, max: 0.6, step: 0.01, default: 0.22, rebuild: true },
    { key: 'omega', label: 'plunger frequency ω', min: 0.25, max: 1.2, step: 0.05, default: 0.5 },
    { key: 'amp', label: 'plunger amplitude', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'speed', label: 'speed', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 80_000,
  particleCountOptions: [40_000, 80_000, 160_000],
  defaultDt: 0.05,
  defaultTrail: 0,
  bloom: 0.8,
  create: (config) => new WarpFlumeArchetype(config),
};

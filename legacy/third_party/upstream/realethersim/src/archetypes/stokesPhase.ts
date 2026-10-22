import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';

// Stokes phase surface. In asymptotic analysis an integral ∫e^{Φ(z;s)/ħ}dz is dominated by its saddle
// points, and a hidden exponential can switch on/off as you cross a special direction — the Stokes
// phenomenon. We take the cubic phase Φ(z;s) = z³/3 − s·z over the complex z-plane and render its
// landscape h = Re Φ as a 3-D terrain. Its two saddles z± = ±√s sit where Φ'(z)=z²−s=0. The glowing
// curves are the STEEPEST-DESCENT paths through each saddle — the level set Im Φ = Im Φ(z±) along which
// Re Φ falls — baked into the colour (warm from z₊, cool from z₋). The Stokes condition
// Im(Φ(z₊)−Φ(z₋))=0 ⇔ Im(s^{3/2})=0, i.e. arg(s) ∈ {0, 2π/3, 4π/3}: scrub arg(s) and watch the two
// descent contours swing into alignment as a saddle's contribution switches on. Bounded (tanh-capped).
const EXTENT = 1.6; // render half-width of the (x,z) terrain
const R = 1.8; // complex-plane half-width sampled (saddles z±=±√|s| stay inside)
const HMAX = 3.0; // height cap (the monkey-saddle grows like x³ — must saturate, and stay test-finite)

const PARAM_SPEC: ParamSpec[] = [
  { key: 'smag', label: '|s|', min: 0.3, max: 2.5, step: 0.05, default: 1.1 }, // saddle separation z±=±√|s|
  { key: 'stokes', label: 'arg(s) sweep', min: 0, max: 1, step: 0.005, default: 0.16 }, // 0..1 → arg(s)∈[0,2π); crosses Stokes lines
  { key: 'glowWidth', label: 'glow width', min: 0.03, max: 0.5, step: 0.01, default: 0.2 }, // descent-contour band
  { key: 'relief', label: 'relief', min: 0.1, max: 1.4, step: 0.02, default: 0.75 },
  { key: 'speed', label: 'shimmer', min: 0, max: 3, step: 0.05, default: 1 }, // gentle vertical breathing
];

const TAU = Math.PI * 2;

class StokesPhaseArchetype implements Archetype {
  readonly id = 'stokesPhase';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly W: number;
  private readonly h: Float64Array; // saturated Re Φ per cell
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private relief = 0.75;
  private speed = 1;
  private t = 0;
  private key = '';

  constructor(config: ArchetypeConfig) {
    const w = Math.max(24, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    this.h = new Float64Array(this.particleCount);
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.relief = config.params.relief ?? 0.75;
    this.speed = config.params.speed ?? 1;
    this.recompute(config.params);
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round((p.smag ?? 1.1) * 40)},${Math.round((p.stokes ?? 0.16) * 240)},${Math.round((p.glowWidth ?? 0.13) * 100)}`;
  }

  // Recompute the height field h=ReΦ AND the descent-glow colours (only when |s|/arg(s)/glow change —
  // colours upload once, so this is the drumhead "rebuild on key change" pattern, not per-frame).
  private recompute(p: ResolvedParams): void {
    this.key = this.keyOf(p);
    const w = this.W;
    const smag = p.smag ?? 1.1;
    const arg = (p.stokes ?? 0.16) * TAU;
    const sRe = smag * Math.cos(arg);
    const sIm = smag * Math.sin(arg);
    // saddles z± = ±√s (√s: magnitude √|s|, angle arg/2)
    const rr = Math.sqrt(smag);
    const zpx = rr * Math.cos(arg / 2);
    const zpy = rr * Math.sin(arg / 2);
    const rePhi = (x: number, y: number): number => (x * x * x) / 3 - x * y * y - sRe * x + sIm * y;
    const imPhi = (x: number, y: number): number => x * x * y - (y * y * y) / 3 - sRe * y - sIm * x;
    const imP = imPhi(zpx, zpy); // Im Φ on the z₊ descent contour
    const imM = imPhi(-zpx, -zpy); // … and z₋
    const reP = rePhi(zpx, zpy);
    const reM = rePhi(-zpx, -zpy);
    const gw = p.glowWidth ?? 0.13;
    const gw2 = gw * gw;
    const h = this.h;
    const col = this.colors;
    for (let j = 0; j < w; j++) {
      const y = (j / (w - 1) - 0.5) * 2 * R;
      for (let i = 0; i < w; i++) {
        const x = (i / (w - 1) - 0.5) * 2 * R;
        const rp = rePhi(x, y);
        const ip = imPhi(x, y);
        const idx = j * w + i;
        h[idx] = HMAX * Math.tanh(rp / HMAX); // saturate the cubic blow-up
        // steepest-descent glow: near Im Φ = Im Φ(saddle), on the DESCENDING side (Re Φ ≤ Re Φ(saddle))
        const gP = Math.exp(-((ip - imP) * (ip - imP)) / gw2) * (rp <= reP + 0.2 ? 1 : 0.15);
        const gM = Math.exp(-((ip - imM) * (ip - imM)) / gw2) * (rp <= reM + 0.2 ? 1 : 0.15);
        const lift = 0.5 + 0.5 * Math.tanh(rp * 1.2); // terrain shading by height, 0..1
        // brighter terrain base (additive blending on black, so the whole sheet reads, not just the glow)
        let r = 0.18 + 0.34 * lift;
        let g = 0.24 + 0.42 * lift;
        let b = 0.38 + 0.54 * lift;
        r += gP * 2.6 + gM * 0.2; // z₊ descent path → warm orange
        g += gP * 1.1 + gM * 1.0;
        b += gP * 0.2 + gM * 2.6; // z₋ descent path → cool cyan/blue
        col[idx * 3] = Math.min(1, r);
        col[idx * 3 + 1] = Math.min(1, g);
        col[idx * 3 + 2] = Math.min(1, b);
      }
    }
    // saddle markers: bright warm-white (z₊) / cool-white (z₋) patches at each saddle
    this.markSaddle(zpx, zpy, 1, 0.95, 0.8);
    this.markSaddle(-zpx, -zpy, 0.8, 0.95, 1);
    this.syncPositions();
  }

  private markSaddle(zx: number, zy: number, mr: number, mg: number, mb: number): void {
    const w = this.W;
    const ci = Math.round(((zx / R) * 0.5 + 0.5) * (w - 1));
    const cj = Math.round(((zy / R) * 0.5 + 0.5) * (w - 1));
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || i >= w || j < 0 || j >= w) continue;
        const fall = di * di + dj * dj <= 4 ? 1 : 0.5; // round-ish 5×5 blob
        const o = (j * w + i) * 3;
        this.colors[o] = mr * fall + (1 - fall);
        this.colors[o + 1] = mg * fall + (1 - fall);
        this.colors[o + 2] = mb * fall + (1 - fall);
      }
    }
  }

  private syncPositions(): void {
    const w = this.W;
    const h = this.h;
    const pos = this.positions;
    const breath = 1 + 0.05 * Math.sin(this.speed * this.t);
    const relief = this.relief * breath;
    const yOff = -HMAX * this.relief * 0.1;
    for (let j = 0; j < w; j++) {
      const z = (j / (w - 1) - 0.5) * 2 * EXTENT;
      for (let i = 0; i < w; i++) {
        const o = (j * w + i) * 3;
        pos[o] = (i / (w - 1) - 0.5) * 2 * EXTENT;
        pos[o + 1] = h[j * w + i] * relief + yOff;
        pos[o + 2] = z;
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.relief = p.relief ?? 0.75;
    this.speed = p.speed ?? 1;
    const k = this.keyOf(p);
    if (k !== this.key) {
      this.recompute(p);
      return;
    }
    this.t += dt;
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
    return [{ id: 'root', parentId: null, label: `Stokes phase Φ=z³/3−sz`, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.012 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const stokesPhaseFactory: ArchetypeFactory = {
  id: 'stokesPhase',
  label: 'Stokes Phase Surface',
  category: 'Spectral',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 40_000, // W ≈ 200
  particleCountOptions: [10_000, 40_000, 90_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the landscape IS the visual
  create: (config) => new StokesPhaseArchetype(config),
};

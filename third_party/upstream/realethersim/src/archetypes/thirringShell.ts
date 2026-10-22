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

// Rotating Shell (Frame Dragging) — spinning matter drags space with it. Hans Thirring showed in 1918
// that inside a massive spherical shell spinning at Ω, general relativity makes the local inertial
// frames rotate too, at ω = (4/3)(GM/Rc²)·Ω (to first order in the shell's compactness GM/Rc²). So a
// pendulum hung at the centre does not keep swinging in a plane fixed to the distant stars — its plane
// slowly turns WITH the shell, drawing a rosette, even though nothing touches it: a Foucault pendulum whose
// "Earth" is a shell of matter around it. (Set the compactness to 0 for the Newtonian answer: the plane
// stays put.) This is a matter shell with a shift vector inside — the same shape as the positive-energy
// "physical" warp drives of Bobrick & Martire (2021) and Fell & Heisenberg (2024), which are massive
// shells carrying their interior along (below light speed). The effect is real but tiny for ordinary
// matter: a shell with the Earth's mass and size would turn its interior about 10⁻⁹ times as fast as itself
// (Gravity Probe B measured the Earth's frame dragging outside it in 2011).

const RSH = 1.5; // shell radius (render units)
const AMP = 1.0; // pendulum amplitude
const W0 = 2.2; // pendulum frequency
const TRAIL = 46; // seconds of swing history drawn
const EARTH_K = 6.967e-10; // GM/(Rc²) for the Earth

class ThirringShellArchetype implements Archetype {
  readonly id = 'thirringShell';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly shell0: number; private readonly shellN: number; private readonly sx: Float32Array; private readonly sy: Float32Array; private readonly sz: Float32Array;
  private readonly trail0: number; private readonly trailN: number;
  private readonly bob0: number; private readonly bobN: number; private readonly bx: Float32Array; private readonly by: Float32Array; private readonly bz: Float32Array;
  private kappa = 0.15;
  private spin = 0.5;
  private speed = 1;
  private t = 0;
  private dragAngle = 0; // accumulated ∫ω dt (so changing a knob doesn't jump the pendulum)
  private shellAngle = 0;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const rng = mulberry32(config.seed);
    this.readParams(config.params);
    const col = this.colors, pos = this.positions;
    let p = 0;
    // fixed stars: a faint distant ring with brighter ticks every 30° (static — the reference frame)
    const starN = Math.floor(P * 0.05);
    for (let k = 0; k < starN; k++, p++) {
      const a = (k / starN) * Math.PI * 2, tick = (k % Math.max(1, Math.floor(starN / 12))) < Math.max(1, Math.floor(starN / 240));
      pos[p * 3] = Math.cos(a) * 3.3; pos[p * 3 + 1] = tick ? (rng() - 0.5) * 0.18 : 0; pos[p * 3 + 2] = Math.sin(a) * 3.3;
      hslToRgb(0.6, 0.2, tick ? 0.85 : 0.45, col, p * 3);
    }
    // the shell: a Fibonacci sphere, amber, with meridian stripes so its spin is visible
    this.shell0 = p; this.shellN = Math.floor(P * 0.36);
    this.sx = new Float32Array(this.shellN); this.sy = new Float32Array(this.shellN); this.sz = new Float32Array(this.shellN);
    for (let k = 0; k < this.shellN; k++, p++) {
      const y = 1 - (2 * (k + 0.5)) / this.shellN, r = Math.sqrt(1 - y * y), a = k * 2.399963229728653;
      this.sx[k] = Math.cos(a) * r * RSH; this.sy[k] = y * RSH; this.sz[k] = Math.sin(a) * r * RSH;
      const lon = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const stripe = Math.abs(((lon / (Math.PI / 6)) % 1) - 0.5) > 0.44;
      const marker = lon < 0.12;
      hslToRgb(marker ? 0.02 : 0.09, 0.85, marker ? 0.62 : stripe ? 0.5 : 0.24, col, p * 3);
    }
    // the pendulum's swing history (cyan, fading) and its bob
    this.trail0 = p; this.bobN = Math.floor(P * 0.02); this.trailN = P - p - this.bobN;
    for (let k = 0; k < this.trailN; k++, p++) {
      const age = k / this.trailN, fade = Math.pow(1 - age, 1.3);
      hslToRgb(0.5, 0.85, 0.35 + 0.3 * fade, col, p * 3);
      for (let c = 0; c < 3; c++) col[p * 3 + c] *= 0.35 + 1.0 * fade;
    }
    this.bob0 = p;
    this.bx = new Float32Array(this.bobN); this.by = new Float32Array(this.bobN); this.bz = new Float32Array(this.bobN);
    for (let k = 0; k < this.bobN; k++, p++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2, rr = 0.07 * Math.cbrt(rng()), s = Math.sqrt(1 - u * u) * rr;
      this.bx[k] = s * Math.cos(a); this.by[k] = u * rr; this.bz[k] = s * Math.sin(a);
      hslToRgb(0.5, 0.6, 0.8, col, p * 3);
    }
    // open with the rosette already drawn
    this.t = TRAIL;
    this.dragAngle = this.omegaDrag() * TRAIL;
    this.shellAngle = this.spin * TRAIL;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.kappa = p.kappa ?? 0.15;
    this.spin = p.spin ?? 0.5;
    this.speed = p.speed ?? 1;
  }

  /** Thirring's interior dragging rate (weak field): ω = (4/3)(GM/Rc²)Ω. */
  private omegaDrag(): number { return (4 / 3) * this.kappa * this.spin; }

  // The pendulum in the local inertial frame swings in a fixed plane; that frame turns at ω about the spin axis.
  // Its position τ seconds ago, in the frame of the distant stars:
  private bob(tau: number, out: Float64Array): void {
    const t = this.t - tau, a = this.dragAngle - this.omegaDrag() * tau;
    const s = AMP * Math.cos(W0 * t);
    out[0] = s * Math.cos(a); out[1] = 0; out[2] = -s * Math.sin(a);
  }

  private syncPositions(): void {
    const pos = this.positions;
    const ca = Math.cos(this.shellAngle), sa = Math.sin(this.shellAngle);
    for (let k = 0; k < this.shellN; k++) {
      const o = (this.shell0 + k) * 3, x = this.sx[k], z = this.sz[k];
      pos[o] = x * ca + z * sa; pos[o + 1] = this.sy[k]; pos[o + 2] = -x * sa + z * ca;
    }
    const b = new Float64Array(3);
    for (let k = 0; k < this.trailN; k++) {
      this.bob((k / this.trailN) * TRAIL, b);
      const o = (this.trail0 + k) * 3;
      pos[o] = b[0]; pos[o + 1] = b[1]; pos[o + 2] = b[2];
    }
    this.bob(0, b);
    for (let k = 0; k < this.bobN; k++) {
      const o = (this.bob0 + k) * 3;
      pos[o] = b[0] + this.bx[k]; pos[o + 1] = b[1] + this.by[k]; pos[o + 2] = b[2] + this.bz[k];
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    const h = dt * this.speed;
    if (h > 0) {
      this.t += h;
      this.dragAngle += this.omegaDrag() * h;
      this.shellAngle += this.spin * h;
    }
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t, this.dragAngle, this.shellAngle]); }
  loadState(s: Float64Array): void {
    if (s.length !== 3) return;
    this.t = s[0]; this.dragAngle = s[1]; this.shellAngle = s[2];
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    const ratio = (4 / 3) * this.kappa;
    const earth = ((4 / 3) * EARTH_K).toExponential(1);
    return [{
      id: 'root', parentId: null,
      label: `compactness GM/Rc² = ${this.kappa.toFixed(3)} · inside, inertial frames turn at ω = ${ratio.toFixed(3)} Ω (Thirring 1918) · an Earth-sized shell of Earth's mass: ${earth} Ω`,
      stateOffset: 0, stateLength: 3,
    }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const thirringShellFactory: ArchetypeFactory = {
  id: 'thirringShell',
  label: 'Rotating Shell (Frame Dragging)',
  category: 'Spacetime',
  kind: 'flow',
  params: [
    { key: 'kappa', label: 'compactness GM/Rc² (0 = Newton)', min: 0, max: 0.2, step: 0.005, default: 0.15 },
    { key: 'spin', label: 'shell spin Ω', min: 0, max: 1.5, step: 0.05, default: 0.5 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.5,
  create: (config) => new ThirringShellArchetype(config),
};

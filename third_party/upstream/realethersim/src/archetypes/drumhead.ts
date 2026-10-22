import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { besselJn, besselJzero } from './bessel';

// Vibrating drumhead — the normal modes of a circular MEMBRANE (∇²u = c⁻²ü, unlike a stiff Chladni
// PLATE which is ∇⁴). Fixed at its rim, the standing waves are the Bessel eigenmodes
// uₘₙ(r,θ) = Jₘ(λₘₙ·r)·cos(mθ), where λₘₙ is the n-th positive zero of Jₘ (so the rim r=1 is a node,
// Jₘ(λₘₙ)=0). The nodal set — where the membrane stands still — is m straight diameters (cos mθ = 0)
// plus n−1 concentric circles (the interior zeros of Jₘ). Each mode has its OWN frequency ωₘₙ ∝ λₘₙ,
// and those ratios are inharmonic (2.295, 3.598, 1.593…), which is why a drum is not pitched like a
// string. Sampled as an area-uniform polar disk displaced by y = u·cos(ωₘₙ·t) and coloured ONCE by |u|
// so the nodal figure (dark) reads. Bessel is evaluated only on a mode change; per frame is a cheap
// cos scale. Bounded ∀t.
const TAU = Math.PI * 2;
const SCALE = 2.5; // disk radius in render units

const PARAM_SPEC: ParamSpec[] = [
  { key: 'circles', label: 'radial nodes n', min: 0, max: 8, step: 1, default: 3, rebuild: true }, // concentric nodal circles
  { key: 'diameters', label: 'angular nodes m', min: 0, max: 7, step: 1, default: 5, rebuild: true }, // nodal diameters
  { key: 'relief', label: 'relief', min: 0, max: 1.5, step: 0.02, default: 0.7 },
  { key: 'speed', label: 'frequency', min: 0, max: 4, step: 0.05, default: 1.6 },
];

class DrumheadArchetype implements Archetype {
  readonly id = 'drumhead';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly px: Float64Array; // fixed disk x (render units)
  private readonly pz: Float64Array; // fixed disk z
  private readonly u0: Float64Array; // eigenmode amplitude at each point (full amplitude)
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private relief = 0.7;
  private speed = 1.6;
  private t = 0;
  private modeKey = '';
  private freqRatio = 1; // f_{m,n}/f_{0,1} = λ_{m,n}/λ_{0,1} — the true relative pitch of this mode
  private mNodes = 5; // nodal diameters m
  private nMode = 4; // radial index n (= circles + 1)

  constructor(config: ArchetypeConfig) {
    const n = config.particleCount;
    this.particleCount = n;
    this.px = new Float64Array(n);
    this.pz = new Float64Array(n);
    this.u0 = new Float64Array(n);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.rebuild(config.params);
  }

  // Recompute the eigenmode + colours (only on a mode change — Bessel is evaluated here, not per frame).
  private rebuild(p: ResolvedParams): void {
    const nCircles = Math.round(p.circles ?? 3);
    const m = Math.round(p.diameters ?? 5);
    this.modeKey = `${nCircles},${m}`;
    const lambda = besselJzero(m, nCircles + 1); // (nCircles+1)-th zero ⇒ nCircles interior nodal rings
    // eigenfrequency ∝ the Bessel zero, so each mode has its own pitch: f_{m,n}/f_{0,1} = λ_{m,n}/λ_{0,1}.
    // These ratios are INHARMONIC (2.295, 3.598, 1.593…) — why a drum sounds nothing like a string.
    this.freqRatio = lambda / besselJzero(0, 1);
    this.mNodes = m; this.nMode = nCircles + 1;
    const n = this.particleCount;
    let umax = 1e-6;
    // Area-uniform POLAR grid (rings × spokes, spokes ∝ circumference) — aligned with the nodal
    // structure so the m diameters and n circles read as crisp curves (a phyllotaxis spiral smears them).
    const rings = Math.max(14, Math.round(Math.sqrt(n / Math.PI)));
    let i = 0;
    for (let j = 0; j < rings && i < n; j++) {
      const rr = (j + 0.5) / rings; // radius fraction in (0,1)
      const spokes = Math.max(3, Math.round(TAU * (j + 0.5)));
      for (let k = 0; k < spokes && i < n; k++, i++) {
        const th = (k / spokes) * TAU;
        this.px[i] = rr * Math.cos(th) * SCALE;
        this.pz[i] = rr * Math.sin(th) * SCALE;
        const u = besselJn(m, lambda * rr) * Math.cos(m * th);
        this.u0[i] = u;
        const a = Math.abs(u);
        if (a > umax) umax = a;
      }
    }
    for (; i < n; i++) {
      this.px[i] = 0; // any leftover points sit at the centre (J_m(0)=0 for m>0 → a node, stays dark)
      this.pz[i] = 0;
      this.u0[i] = besselJn(m, 0);
    }
    // colour once by normalised |u|: the antinode lobes glow gold, the nodal lines (m diameters + n
    // circles) stay dark — so the mode's structure reads as a luminous rippled membrane.
    const col = this.colors;
    for (let i = 0; i < n; i++) {
      const a = Math.min(1, (Math.abs(this.u0[i]) / umax) * 1.35);
      col[i * 3] = 0.06 + 0.94 * a; // warm gold ramp
      col[i * 3 + 1] = 0.05 + 0.62 * a;
      col[i * 3 + 2] = 0.02 + 0.16 * a;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    // breathe at the mode's TRUE eigenfrequency (∝ λ_{m,n}): higher modes ripple faster, exactly in the
    // inharmonic ratios that guide drum tuning — switching modes now changes the pitch.
    const osc = Math.cos(this.speed * this.freqRatio * this.t) * this.relief;
    const pos = this.positions;
    for (let i = 0; i < this.particleCount; i++) {
      const o = i * 3;
      pos[o] = this.px[i];
      pos[o + 1] = this.u0[i] * osc; // membrane height, breathing in time
      pos[o + 2] = this.pz[i];
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const nextKey = `${Math.round(p.circles ?? 3)},${Math.round(p.diameters ?? 5)}`;
    if (nextKey !== this.modeKey) {
      this.modeKey = nextKey;
      this.relief = p.relief ?? 0.7;
      this.speed = p.speed ?? 1.6;
      this.rebuild(p);
      return;
    }
    this.relief = p.relief ?? 0.7;
    this.speed = p.speed ?? 1.6;
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
    return [{ id: 'root', parentId: null, label: `drumhead J${this.mNodes},${this.nMode} · f/f₀₁ = ${this.freqRatio.toFixed(3)}`, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.01 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const drumheadFactory: ArchetypeFactory = {
  id: 'drumhead',
  label: 'Drumhead (Bessel modes)',
  category: 'Field',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 60_000,
  particleCountOptions: [20_000, 60_000, 120_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the membrane surface IS the visual
  create: (config) => new DrumheadArchetype(config),
};

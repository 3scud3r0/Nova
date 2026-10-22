import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';
import { hslToRgb } from '../core/color';

// Orbit Weave — collective trajectories in a central HARMONIC potential. A test particle in a force
// F = −k·x (Hooke's law toward the origin) traces a closed ELLIPSE centred on the origin: the exact
// solution x(t) = a·cos(ωt)·Û + b·sin(ωt)·V̂. Each particle gets a random orbit plane (Û,V̂), radius a,
// phase, and a slightly different rate; with a small semi-minor axis b = ecc·a the ellipses are nearly
// radial slivers that plunge through the centre and reach a shell at radius a. Drawn with long trails,
// the ensemble weaves a luminous sphere shot through with radial streaks. Closed-form ⇒ unconditionally
// bounded (|x| ≤ a) and never blows up. Colour is fixed per particle (uploaded once at build).
const TAU = Math.PI * 2;

const PARAM_SPEC: ParamSpec[] = [
  { key: 'ecc', label: 'orbit width', min: 0.02, max: 1, step: 0.01, default: 0.06 }, // b/a: 0 = radial slivers, 1 = circles
  { key: 'speed', label: 'speed', min: 0.05, max: 2, step: 0.01, default: 0.5 },
  { key: 'shell', label: 'shell radius', min: 1, max: 3, step: 0.05, default: 2.3, rebuild: true },
];

class OrbitWeaveArchetype implements Archetype {
  readonly id = 'orbitWeave';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly aR: Float64Array; // semi-major axis (reach) per particle
  private readonly om: Float64Array; // per-particle relative rate
  private readonly ph: Float64Array; // phase offset
  private readonly U: Float64Array; // orbit-plane basis vector 1 (n×3)
  private readonly V: Float64Array; // orbit-plane basis vector 2 (n×3)
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const n = config.particleCount;
    this.particleCount = n;
    this.aR = new Float64Array(n);
    this.om = new Float64Array(n);
    this.ph = new Float64Array(n);
    this.U = new Float64Array(n * 3);
    this.V = new Float64Array(n * 3);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.seed(config);
    this.syncPositions(0.16);
  }

  private seed(config: ArchetypeConfig): void {
    const n = this.particleCount;
    const R = (config.params.shell as number) ?? 2.3;
    const rng = mulberry32(config.seed);
    const randUnit = (out: Float64Array, o: number): void => {
      const z = 2 * rng() - 1;
      const phi = TAU * rng();
      const s = Math.sqrt(Math.max(0, 1 - z * z));
      out[o] = s * Math.cos(phi);
      out[o + 1] = s * Math.sin(phi);
      out[o + 2] = z;
    };
    const tmp = new Float64Array(3);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      randUnit(this.U, o); // orbit-plane axis 1
      // axis 2 ⟂ axis 1: random vector projected off U, renormalised
      let vx = 0;
      let vy = 0;
      let vz = 0;
      let len = 0;
      do {
        randUnit(tmp, 0);
        const d = tmp[0] * this.U[o] + tmp[1] * this.U[o + 1] + tmp[2] * this.U[o + 2];
        vx = tmp[0] - d * this.U[o];
        vy = tmp[1] - d * this.U[o + 1];
        vz = tmp[2] - d * this.U[o + 2];
        len = Math.hypot(vx, vy, vz);
      } while (len < 1e-4);
      this.V[o] = vx / len;
      this.V[o + 1] = vy / len;
      this.V[o + 2] = vz / len;
      this.aR[i] = R * (0.32 + 0.68 * Math.sqrt(rng())); // reach: biased toward the outer shell
      this.om[i] = 0.82 + 0.36 * rng(); // slight per-particle rate spread → the weave shimmers, never freezes
      this.ph[i] = TAU * rng();
      // colour once: bright cool blue-white, inner orbits a touch warmer/brighter (luminous-trails look)
      const tt = this.aR[i] / R;
      hslToRgb(0.56 + 0.06 * tt, 0.22, 0.96 - 0.22 * tt, this.colors, o);
    }
  }

  private syncPositions(ecc: number): void {
    const pos = this.positions;
    const aR = this.aR;
    const om = this.om;
    const ph = this.ph;
    const U = this.U;
    const V = this.V;
    const t = this.t;
    for (let i = 0; i < this.particleCount; i++) {
      const o = i * 3;
      const ang = om[i] * t + ph[i];
      const c = aR[i] * Math.cos(ang);
      const s = aR[i] * ecc * Math.sin(ang);
      pos[o] = c * U[o] + s * V[o];
      pos[o + 1] = c * U[o + 1] + s * V[o + 1];
      pos[o + 2] = c * U[o + 2] + s * V[o + 2];
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.t += dt * (p.speed ?? 0.5); // speed-scaled clock → changing speed never jumps the phase
    this.syncPositions(p.ecc ?? 0.16);
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
    this.syncPositions(0.16);
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Orbit ensemble', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.006 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const orbitWeaveFactory: ArchetypeFactory = {
  id: 'orbitWeave',
  label: 'Orbit Weave',
  category: 'Orbital',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 16000,
  particleCountOptions: [8000, 16000, 32000],
  defaultDt: 0.016,
  defaultTrail: 520, // long luminous trails ARE the weave (24 trail slots → need many particles to read)
  create: (config) => new OrbitWeaveArchetype(config),
};

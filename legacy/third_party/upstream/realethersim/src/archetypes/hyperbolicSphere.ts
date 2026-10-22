import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Hyperbolic Sphere. Take the hyperbolic plane in its band coordinates w = u + iv (the conformal
// log of the upper half-plane, ζ = e^w): the curves u = const are true geodesics — under the map
// back to the Poincaré picture they are the circular arcs that meet the boundary at right angles —
// and u-translation, u → u + t, is a genuine one-parameter hyperbolic isometry (a dilation of the
// half-plane). Now push the whole plane through the stereographic projection onto the Riemann
// sphere. The diagonal grid lines u ± p·v = k·c become LOXODROMES — the double spiral families
// that wind from pole to pole crossing every meridian at a constant angle — and the isometry
// becomes the loxodromic Möbius flow of the sphere: the two fixed points are the poles, and the
// entire grid streams from one to the other forever without ever changing shape, because the flow
// is an isometry of the geometry that drew it. Amber one family, blue the other, like the
// original. Every colour is baked; the Möbius flow lives entirely in positions. Bounded.
const TAU = Math.PI * 2;
const K = 16; // grid curves per family
const U_WRAP = 2.6; // band half-extent before a curve recycles pole-to-pole
const R = 1.12; // sphere radius

class HyperbolicSphereArchetype implements Archetype {
  readonly id = 'hyperbolicSphere';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly fam: Uint8Array; // which loxodrome family (winds left / winds right)
  private readonly k: Float64Array; // grid-curve index (with a hair of cross-curve jitter)
  private readonly v: Float64Array; // longitude parameter along the curve
  private flow = 1;
  private pitch = 1;
  private grid = 0.3;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(256, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.fam = new Uint8Array(N);
    this.k = new Float64Array(N);
    this.v = new Float64Array(N);
    const rng = mulberry32((config.seed ^ 0x2545f491) >>> 0);
    for (let i = 0; i < N; i++) {
      const fam = rng() < 0.5 ? 0 : 1;
      this.fam[i] = fam;
      this.k[i] = Math.floor(rng() * K) - K / 2 + (rng() - 0.5) * 0.1; // bold bright lines
      this.v[i] = rng() * TAU;
      const bri = 1.35 + 0.9 * rng();
      const o = i * 3;
      if (fam === 0) {
        this.colors[o] = 1.0 * bri; this.colors[o + 1] = 0.58 * bri; this.colors[o + 2] = 0.12 * bri; // amber
      } else {
        this.colors[o] = 0.16 * bri; this.colors[o + 1] = 0.38 * bri; this.colors[o + 2] = 1.0 * bri; // blue
      }
    }
    this.readParams(config.params);
    this.t = 5;
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.flow = p.flow ?? 1;
    this.pitch = p.pitch ?? 1;
    this.grid = p.grid ?? 0.3;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    const t = this.t;
    const drift = 0.16 * this.flow * t; // the loxodromic Möbius flow: u → u + t
    const spin = 0.07 * t; // slow presentation turn of the whole sphere
    const cs = Math.cos(spin), sn = Math.sin(spin);
    for (let i = 0; i < N; i++) {
      const p = this.fam[i] === 0 ? this.pitch * 0.55 : -this.pitch * 0.55;
      const v = this.v[i];
      let u = this.k[i] * this.grid + p * v + drift;
      // recycle pole-to-pole: the flow feeds curves into one pole and out of the other
      u = ((u + U_WRAP) % (2 * U_WRAP) + 2 * U_WRAP) % (2 * U_WRAP) - U_WRAP;
      // ζ = e^{u+iv}, then inverse stereographic onto the sphere (poles on ±y)
      const zr = Math.exp(u);
      const denom = zr * zr + 1;
      const sx = (2 * zr * Math.cos(v)) / denom;
      const sy = (zr * zr - 1) / denom;
      const sz = (2 * zr * Math.sin(v)) / denom;
      const o = i * 3;
      pos[o] = R * (sx * cs - sz * sn);
      pos[o + 1] = R * sy;
      pos[o + 2] = R * (sx * sn + sz * cs);
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'loxodromic Möbius flow', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.016 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const hyperbolicSphereFactory: ArchetypeFactory = {
  id: 'hyperbolicSphere',
  label: 'Hyperbolic Sphere',
  category: 'Conformal',
  kind: 'flow',
  params: [
    { key: 'flow', label: 'möbius flow', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'pitch', label: 'spiral pitch', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { key: 'grid', label: 'grid spacing', min: 0.15, max: 0.6, step: 0.01, default: 0.3 },
  ],
  defaultParticleCount: 90_000,
  particleCountOptions: [40_000, 90_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the grid is the drawing — trails would fill the gaps between curves
  bloom: 0.5,
  create: (config) => new HyperbolicSphereArchetype(config),
};

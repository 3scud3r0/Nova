import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';

// Vortex Funnel (draining whirlpool): points sit on a surface of revolution — a flat, rippled rim that
// steepens into a narrow throat, the free surface of a bathtub/drain vortex modelled as a Lorentzian
// dimple z = −depth·c²/(r²+c²). A DIFFERENTIAL swirl (inner rings spin faster, like Ω∝1/r) winds the
// spiral arms; traveling surface ripples animate the "water". Each point keeps a FIXED radius, so its
// colour — white throat → orange glow at the lip → dark rim — stays correct even as it rotates (the
// colour buffer is uploaded once at build; per-frame recolour would not show). Bounded by construction.
const TAU = Math.PI * 2;
const RMAX = 2.4; // outer rim radius (render units)
const THROAT_FRAC = 0.12; // inner throat radius as a fraction of RMAX

const PARAM_SPEC: ParamSpec[] = [
  { key: 'depth', label: 'funnel depth', min: 0.5, max: 4, step: 0.05, default: 2.3 },
  { key: 'throat', label: 'throat width', min: 0.1, max: 1.2, step: 0.02, default: 0.45 }, // Lorentzian core c
  { key: 'swirl', label: 'swirl', min: 0, max: 2, step: 0.02, default: 0.7 }, // 0 = a still funnel you orbit
  { key: 'ripple', label: 'ripples', min: 0, max: 0.4, step: 0.01, default: 0.12 }, // traveling surface waves
  { key: 'turns', label: 'spiral turns', min: 0, max: 8, step: 0.5, default: 3, rebuild: true }, // arm tightness
];

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

class VortexFunnelArchetype implements Archetype {
  readonly id = 'vortexFunnel';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly r: Float64Array; // fixed radius per point (render units)
  private readonly th0: Float64Array; // fixed base angle per point (spiral seed)
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly clock = new Float64Array(1); // accumulated time (snapshot state)

  constructor(config: ArchetypeConfig) {
    const n = config.particleCount;
    this.particleCount = n;
    this.r = new Float64Array(n);
    this.th0 = new Float64Array(n);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);

    const turns = (config.params.turns as number) ?? 3;
    // Structured polar grid: `rings` concentric rings × `perRing` spokes, with a per-radius spiral
    // twist so the dots form winding arms (and concentric rings near the rim).
    const rings = Math.max(8, Math.round(Math.sqrt(n) * 0.8));
    const perRing = Math.max(1, Math.floor(n / rings));
    for (let i = 0; i < n; i++) {
      const ring = Math.min(rings - 1, Math.floor(i / perRing));
      const k = i - ring * perRing;
      const u = rings > 1 ? ring / (rings - 1) : 0; // 0 (throat) → 1 (rim)
      this.r[i] = (THROAT_FRAC + (1 - THROAT_FRAC) * u) * RMAX;
      const spoke = (k + 0.5) / perRing; // 0..1 around the ring
      this.th0[i] = spoke * TAU + turns * u * TAU; // spiral twist by radius
      this.colorAt(u, i * 3);
    }
    this.syncPositions(config.params);
  }

  // Fixed WARM radial palette (hue stays in amber→red so it never washes through green): near-white
  // throat → vivid glowing amber/orange lip → deep dark-red rim. Additive blending turns the dense,
  // bright, saturated lip band into the funnel's signature orange glow.
  private colorAt(u: number, o: number): void {
    const h = 0.09 - 0.09 * smoothstep(0.45, 1.0, u); // amber (0.09) → red (0) toward the rim
    const s = 0.12 + 0.88 * smoothstep(0.02, 0.32, u); // desaturated white throat → vivid
    const l = 0.96 - 0.72 * smoothstep(0.32, 1.0, u); // bright throat + lip → dark rim
    hslToRgb(h, s, l, this.colors, o);
  }

  private syncPositions(p: ResolvedParams): void {
    const depth = p.depth ?? 2.3;
    const core = p.throat ?? 0.45;
    const swirl = p.swirl ?? 0.7;
    const ripple = p.ripple ?? 0.12;
    const c2 = core * core;
    const t = this.clock[0];
    const yMid = depth * 0.5; // recentre: funnel spans [−depth, ~0] → centre on the origin
    const r = this.r;
    const th0 = this.th0;
    const pos = this.positions;
    for (let i = 0; i < this.particleCount; i++) {
      const rr = r[i];
      const u = rr / RMAX;
      const om = swirl / (u + 0.18); // differential rotation: inner rings spin faster (Ω ∝ 1/r)
      const th = th0[i] + om * t;
      const funnel = -depth * (c2 / (rr * rr + c2)); // Lorentzian dimple — deep narrow throat
      const wave = ripple * u * Math.cos(6.0 * rr - 2.2 * t); // traveling ripples, growing toward the rim
      const o = i * 3;
      pos[o] = rr * Math.cos(th);
      pos[o + 1] = funnel + wave + yMid;
      pos[o + 2] = rr * Math.sin(th);
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.clock[0] += dt;
    this.syncPositions(p);
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return this.clock;
  }
  loadState(s: Float64Array): void {
    this.clock[0] = s[0] ?? 0;
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Vortex funnel', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.007 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const vortexFunnelFactory: ArchetypeFactory = {
  id: 'vortexFunnel',
  label: 'Vortex Funnel',
  category: 'Fluid',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 120_000,
  particleCountOptions: [40_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the rippling surface IS the visual; trails just smear it
  create: (config) => new VortexFunnelArchetype(config),
};

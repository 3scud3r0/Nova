import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Spiral Galaxy (density wave). Spiral arms are one of astronomy's great illusions: they are not
// streams of stars but WAVES. Lindblad & Lin–Shu's density-wave theory: each star rides a slightly
// elliptical orbit, and if every orbit's ellipse is turned a little more than the one inside it, the
// ellipses crowd together along two spiral loci — a standing density wave. Stars flow THROUGH the
// arms (like cars through a traffic jam) while the pattern itself turns at its own slow "pattern
// speed." That is why the arms don't wind up over billions of years, and why measuring an arm's exact
// distance is so slippery — it's a wave, not a wall. Here: a disk of stars on precessing ellipses, a
// bright bulge and emergent bar at the centre, pink star-forming knots in the arms. Bounded ∀t.
const CORE = 0.15; // softens the rotation curve at the centre
const TAU = Math.PI * 2;

class SpiralGalaxyArchetype implements Archetype {
  readonly id = 'spiralGalaxy';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly a: Float64Array; // baked orbit semi-major axis (radius)
  private readonly psi0: Float64Array; // baked orbital phase
  private readonly z0: Float64Array; // baked disk-thickness offset
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private pitch = 6; // dθ₀/da — how tightly the ellipses wind
  private ecc = 0.4; // orbit eccentricity
  private pattern = 0.1; // pattern (arm) angular speed
  private vel = 0.35; // orbital speed scale (flat rotation curve)
  private t = 0;
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    this.particleCount = Math.max(1, config.particleCount);
    this.a = new Float64Array(this.particleCount);
    this.psi0 = new Float64Array(this.particleCount);
    this.z0 = new Float64Array(this.particleCount);
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.seed = config.seed;
    this.rebuild(config.params);
  }

  // Bake the star distribution + colours once (the visual params — winding, eccentricity, pattern
  // speed — are all applied live in syncPositions, so nothing here depends on them).
  private rebuild(p: ResolvedParams): void {
    this.pitch = p.pitch ?? 6;
    this.ecc = p.eccentricity ?? 0.4;
    this.pattern = p.patternSpeed ?? 0.1;
    this.vel = p.orbitSpeed ?? 0.35;
    const rng = mulberry32((this.seed ^ 0x1b56c4e9) >>> 0);
    const N = this.particleCount;
    const col = this.colors;
    const nBulge = Math.floor(N * 0.14);
    for (let i = 0; i < N; i++) {
      let a: number;
      let bright: number;
      let r0: number, g0: number, b0: number;
      if (i < nBulge) {
        // bright central bulge — a 3-D spheroid (vertical extent ≈ its in-plane size, rounder at core)
        a = 0.015 + 0.22 * Math.sqrt(rng());
        this.z0[i] = (rng() * 2 - 1) * 0.3 * Math.sqrt(Math.max(0, 1 - (a / 0.24) * (a / 0.24)));
        bright = (1.3 + 0.6 * rng()) * (1 - a / 0.24) + 0.5; // hot, brightest at the very core
        r0 = 1.0; g0 = 0.82; b0 = 0.5;
      } else {
        // disk: radius spread out to the rim, with a thin scale height that FLARES outward
        a = 0.2 + 1.35 * Math.pow(rng(), 0.85);
        const f = (a - 0.2) / 1.35; // 0 inner disk → 1 rim
        this.z0[i] = ((rng() + rng() + rng() - 1.5) / 1.5) * (0.03 + 0.06 * f); // Gaussian-ish, flaring
        // warm-white inner disk → blue outer arms
        r0 = 1.0 - 0.5 * f;
        g0 = 0.84 - 0.2 * f;
        b0 = 0.55 + 0.5 * f;
        bright = 0.8 + 0.7 * rng();
        if (rng() < 0.03) { r0 = 1.0; g0 = 0.4; b0 = 0.52; bright *= 1.8; } // pink HII star-forming knots
      }
      this.a[i] = a;
      this.psi0[i] = rng() * TAU;
      col[i * 3] = r0 * bright;
      col[i * 3 + 1] = g0 * bright;
      col[i * 3 + 2] = b0 * bright;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const N = this.particleCount;
    const pos = this.positions;
    const t = this.t;
    const pitch = this.pitch;
    const patT = this.pattern * t;
    const oneMinusE = 1 - this.ecc;
    for (let i = 0; i < N; i++) {
      const a = this.a[i];
      const psi = this.psi0[i] + (this.vel / (a + CORE)) * t; // orbital phase (flat-ish rotation curve)
      const th0 = pitch * a + patT; // ellipse orientation: winds with radius, precesses with the pattern
      const b = a * oneMinusE;
      const ex = a * Math.cos(psi);
      const ey = b * Math.sin(psi);
      const ct = Math.cos(th0), st = Math.sin(th0);
      const o = i * 3;
      pos[o] = ct * ex - st * ey; // galaxy disk lies in the X–Z plane (horizontal)…
      pos[o + 1] = this.z0[i]; // …with real thickness in Y (scale height + 3-D bulge)
      pos[o + 2] = st * ex + ct * ey;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.pitch = p.pitch ?? 6;
    this.ecc = p.eccentricity ?? 0.4;
    this.pattern = p.patternSpeed ?? 0.1;
    this.vel = p.orbitSpeed ?? 0.35;
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
    return [{ id: 'root', parentId: null, label: 'Spiral galaxy (density wave)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.0065 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const spiralGalaxyFactory: ArchetypeFactory = {
  id: 'spiralGalaxy',
  label: 'Spiral Galaxy',
  category: 'Cosmology',
  kind: 'flow',
  params: [
    { key: 'pitch', label: 'winding', min: 2, max: 12, step: 0.2, default: 6 }, // dθ₀/da → arm tightness
    { key: 'eccentricity', label: 'ellipticity', min: 0.1, max: 0.6, step: 0.02, default: 0.4 },
    { key: 'patternSpeed', label: 'pattern speed', min: -0.4, max: 0.4, step: 0.02, default: 0.1 },
    { key: 'orbitSpeed', label: 'orbit speed', min: 0, max: 0.8, step: 0.02, default: 0.35 },
  ],
  defaultParticleCount: 120_000,
  particleCountOptions: [60_000, 120_000, 200_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the star disk IS the visual
  create: (config) => new SpiralGalaxyArchetype(config),
};

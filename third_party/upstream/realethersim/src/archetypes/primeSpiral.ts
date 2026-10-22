import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';

// Prime Spiral (Vogel) — number theory allowed to arrange itself geometrically. Place every integer n
// on a sunflower: at radius √n and angle n·137.507° — the GOLDEN ANGLE, 360°·(1−1/φ), the most
// irrational rotation there is. This is Vogel's model of phyllotaxis, the packing real sunflowers and
// pinecones use, and its interlocking spiral families (parastichies, counted by Fibonacci numbers)
// arise purely from that irrational spacing. Now colour by PRIMALITY: the primes flare ember-to-ivory
// while the composites sink to a dim violet haze. The primes don't scatter randomly — they trace and
// thin the spiral arms, a quiet portrait of how the multiplicative structure of the integers threads
// through the golden-angle packing. Primality is found once by the Sieve of Eratosthenes; positions
// bake, the whole bloom turns slowly. Bounded. (Vogel 1979; a phyllotactic cousin of the Ulam spiral.)
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad = 137.507°, the golden angle
const RADIUS = 2.45; // outer radius in render units

class PrimeSpiralArchetype implements Archetype {
  readonly id = 'primeSpiral';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly bx: Float64Array; private readonly by: Float64Array; // baked sunflower positions
  private speed = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(2048, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.bx = new Float64Array(N); this.by = new Float64Array(N);
    // Sieve of Eratosthenes: primality of 0..N, computed ONCE (not "one million times per frame")
    const comp = new Uint8Array(N + 1);
    for (let p = 2; p * p <= N; p++) if (!comp[p]) for (let m = p * p; m <= N; m += p) comp[m] = 1;
    const c = RADIUS / Math.sqrt(N); // Vogel scale so the last integer sits at the rim
    for (let n = 1; n <= N && n - 1 < N; n++) {
      const r = c * Math.sqrt(n);
      const th = n * GOLDEN;
      const i = n - 1;
      this.bx[i] = r * Math.cos(th);
      this.by[i] = r * Math.sin(th);
      const o = i * 3;
      const prime = n >= 2 && comp[n] === 0;
      if (prime) {
        // incandescent: ember orange (hot core) → warm ivory (rim), kept warm (r≥g>b) so it never
        // reads cold blue; very bright so the isolated 1px primes flare under bloom. A radial boost
        // lifts the sparse central primes so the core glows instead of leaving a hole.
        const f = r / RADIUS;
        const boost = 1 + 2.2 * Math.exp(-f * 5);
        this.colors[o] = (5.0 - 1.0 * f) * boost;
        this.colors[o + 1] = (1.5 + 1.7 * f) * boost;
        this.colors[o + 2] = (0.3 + 2.1 * f) * boost;
      } else {
        // composites: a faint violet haze that reveals the phyllotactic spiral arms (parastichies)
        this.colors[o] = 0.035; this.colors[o + 1] = 0.012; this.colors[o + 2] = 0.075;
      }
    }
    this.readParams(config.params);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.speed = p.speed ?? 1;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const ang = this.t * this.speed * 0.05; // slow bloom rotation
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < this.particleCount; i++) {
      const x = this.bx[i], y = this.by[i];
      const o = i * 3;
      pos[o] = x * ca - y * sa;
      pos[o + 1] = x * sa + y * ca;
      pos[o + 2] = 0;
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
    return [{ id: 'root', parentId: null, label: 'primes on a golden-angle sunflower', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const primeSpiralFactory: ArchetypeFactory = {
  id: 'primeSpiral',
  label: 'Prime Spiral',
  category: 'Number',
  kind: 'flow',
  params: [
    { key: 'speed', label: 'rotation', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 200_000,
  particleCountOptions: [100_000, 200_000, 320_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.7,
  create: (config) => new PrimeSpiralArchetype(config),
};

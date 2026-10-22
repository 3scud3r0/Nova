import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Jellyfish Fountain. A dome of luminous tendrils that pulses like a jellyfish bell — each strand a
// real rope simulation, not a keyframed curve (a nod to the "Atokirina" jellyfish-fountain pieces of
// the creative-coding world). Every tendril is a VERLET ROPE: nodes integrate as x ← x + (x − x_prev)
// + a·dt², then a few constraint passes pin each segment back to its rest length — the classic
// position-based rope. Roots are pinned to a crown ring that BEATS: each pulse widens the ring and
// pushes the ropes outward, the kick propagates down the strands through the constraints, and gravity
// + damping settle them back into the dangling dome between beats. Render points are interpolated
// densely along the segments, colour-graded once from a warm crown to cyan tips. Bounded (pinned,
// damped, and the rope can never exceed its own length).
const TAU = Math.PI * 2;
const K = 18; // nodes per rope
const SEG = 0.062; // rope segment rest length
const CROWN_Y = 0.72; // crown ring height

class JellyfishFountainArchetype implements Archetype {
  readonly id = 'jellyfishFountain';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private S = 48; // strand count (rebuilds the rope set on change)
  private nodes = new Float64Array(0); // S·K·3 current positions
  private prev = new Float64Array(0); // S·K·3 previous positions (Verlet)
  private phis = new Float64Array(0); // strand azimuths
  private t = 0;
  private key = '';
  private pulseRate = 0.7;
  private gravity = 1;
  private sway = 0.35;
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    this.particleCount = Math.max(64, config.particleCount);
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.seed = config.seed;
    this.readParams(config.params);
    this.rebuildRopes();
    // colours bake once: warm luminous crown → cyan tips, per-point noise for sparkle
    const rng = mulberry32((this.seed ^ 0x3c6ef372) >>> 0);
    const col = this.colors;
    const N = this.particleCount;
    for (let i = 0; i < N; i++) {
      const frac = this.pointFrac(i);
      const v = 0.5 + 0.6 * rng();
      const r = (0.95 - 0.6 * frac) * v;
      const g = (0.88 + 0.12 * frac) * v;
      const b = (1.08 - 0.1 * frac) * v;
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b * 1.05;
    }
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.S = Math.max(8, Math.min(96, Math.round(p.strands ?? 48)));
    this.pulseRate = p.pulse ?? 0.7;
    this.gravity = p.gravity ?? 1;
    this.sway = p.sway ?? 0.35;
  }

  // fraction along the rope for render point i (points are dealt strand-major, K−1 segments each)
  private pointFrac(i: number): number {
    const perStrand = Math.max(1, Math.floor(this.particleCount / this.S));
    const j = i % perStrand;
    return j / perStrand;
  }

  private rebuildRopes(): void {
    this.key = `${this.S}`;
    const rng = mulberry32((this.seed ^ Math.imul(this.S, 0x9e3779b9)) >>> 0);
    this.nodes = new Float64Array(this.S * K * 3);
    this.prev = new Float64Array(this.S * K * 3);
    this.phis = new Float64Array(this.S);
    for (let s = 0; s < this.S; s++) {
      const phi = (s / this.S) * TAU + (rng() - 0.5) * 0.06;
      this.phis[s] = phi;
      const ox = Math.cos(phi), oz = Math.sin(phi);
      for (let k = 0; k < K; k++) {
        // seed each rope as an outward-falling arc — roughly the fountain dome it will settle into
        const w = k / (K - 1);
        const reach = Math.sin(w * 1.9) * 0.75;
        const drop = w * w * 0.9;
        const o3 = (s * K + k) * 3;
        this.nodes[o3] = ox * (0.26 + reach);
        this.nodes[o3 + 1] = CROWN_Y - drop;
        this.nodes[o3 + 2] = oz * (0.26 + reach);
        this.prev[o3] = this.nodes[o3];
        this.prev[o3 + 1] = this.nodes[o3 + 1];
        this.prev[o3 + 2] = this.nodes[o3 + 2];
      }
    }
  }

  private stepRopes(dt: number): void {
    const t = this.t;
    const beat = Math.pow(Math.max(0, Math.sin(TAU * this.pulseRate * t)), 3); // sharp bell-beat envelope
    const ringR = 0.26 * (1 + 0.45 * beat);
    const crownY = CROWN_Y + 0.05 * beat;
    const g = -1.15 * this.gravity;
    const dt2 = dt * dt;
    const damp = 0.985;
    for (let s = 0; s < this.S; s++) {
      const phi = this.phis[s];
      const ox = Math.cos(phi), oz = Math.sin(phi);
      // Verlet integrate the free nodes
      for (let k = 1; k < K; k++) {
        const o3 = (s * K + k) * 3;
        const x = this.nodes[o3], y = this.nodes[o3 + 1], z = this.nodes[o3 + 2];
        // outward "ejection pressure" (strong on the beat) + lateral sway breeze
        const ax = ox * (0.22 + 1.5 * beat) + this.sway * 0.35 * Math.sin(0.6 * t + phi * 2.3);
        const az = oz * (0.22 + 1.5 * beat) + this.sway * 0.35 * Math.cos(0.53 * t + phi * 1.7);
        this.nodes[o3] = x + (x - this.prev[o3]) * damp + ax * dt2;
        this.nodes[o3 + 1] = y + (y - this.prev[o3 + 1]) * damp + g * dt2;
        this.nodes[o3 + 2] = z + (z - this.prev[o3 + 2]) * damp + az * dt2;
        this.prev[o3] = x; this.prev[o3 + 1] = y; this.prev[o3 + 2] = z;
      }
      // pin the root to the (pulsing) crown ring
      const r3 = s * K * 3;
      this.nodes[r3] = ox * ringR;
      this.nodes[r3 + 1] = crownY;
      this.nodes[r3 + 2] = oz * ringR;
      this.prev[r3] = this.nodes[r3]; this.prev[r3 + 1] = this.nodes[r3 + 1]; this.prev[r3 + 2] = this.nodes[r3 + 2];
      // constraint passes: pull each segment back to its rest length (root immovable)
      for (let iter = 0; iter < 3; iter++) {
        for (let k = 1; k < K; k++) {
          const a3 = (s * K + k - 1) * 3;
          const b3 = (s * K + k) * 3;
          let dx = this.nodes[b3] - this.nodes[a3];
          let dy = this.nodes[b3 + 1] - this.nodes[a3 + 1];
          let dz = this.nodes[b3 + 2] - this.nodes[a3 + 2];
          const len = Math.hypot(dx, dy, dz) || 1e-9;
          const corr = (len - SEG) / len;
          const wA = k === 1 ? 0 : 0.5; // the root doesn't move
          const wB = k === 1 ? 1 : 0.5;
          dx *= corr; dy *= corr; dz *= corr;
          this.nodes[a3] += dx * wA; this.nodes[a3 + 1] += dy * wA; this.nodes[a3 + 2] += dz * wA;
          this.nodes[b3] -= dx * wB; this.nodes[b3 + 1] -= dy * wB; this.nodes[b3 + 2] -= dz * wB;
        }
      }
    }
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    const perStrand = Math.max(1, Math.floor(N / this.S));
    for (let i = 0; i < N; i++) {
      const s = Math.min(this.S - 1, Math.floor(i / perStrand));
      const j = i - s * perStrand;
      const f = (j / perStrand) * (K - 1);
      const k = Math.min(K - 2, Math.floor(f));
      const u = f - k;
      const a3 = (s * K + k) * 3;
      const b3 = (s * K + k + 1) * 3;
      pos[i * 3] = this.nodes[a3] + (this.nodes[b3] - this.nodes[a3]) * u;
      pos[i * 3 + 1] = this.nodes[a3 + 1] + (this.nodes[b3 + 1] - this.nodes[a3 + 1]) * u;
      pos[i * 3 + 2] = this.nodes[a3 + 2] + (this.nodes[b3 + 2] - this.nodes[a3 + 2]) * u;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    if (`${this.S}` !== this.key) this.rebuildRopes();
    const h = Math.min(dt, 0.03); // clamp the Verlet step for stability
    this.t += h;
    this.stepRopes(h);
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
    return [{ id: 'root', parentId: null, label: `Jellyfish fountain (${this.S} Verlet ropes)`, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.009 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const jellyfishFountainFactory: ArchetypeFactory = {
  id: 'jellyfishFountain',
  label: 'Jellyfish Fountain',
  category: 'Life',
  kind: 'flow',
  params: [
    { key: 'strands', label: 'tendrils', min: 8, max: 96, step: 1, default: 48, rebuild: true }, // rope count (re-seeds dome + colour gradient)
    { key: 'pulse', label: 'bell pulse', min: 0.1, max: 2, step: 0.05, default: 0.7 }, // beat rate
    { key: 'gravity', label: 'gravity', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { key: 'sway', label: 'current', min: 0, max: 1, step: 0.05, default: 0.35 }, // ambient water sway
  ],
  defaultParticleCount: 60_000,
  particleCountOptions: [30_000, 60_000, 120_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the tendril dome IS the visual
  bloom: 0.45,
  create: (config) => new JellyfishFountainArchetype(config),
};

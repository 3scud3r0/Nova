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
import { mulberry32 } from '../state/rng';

// Scale-invariant N-body (PRD §2). Direct O(n²) Plummer-softened gravity integrated with
// velocity-Verlet (symplectic — bounded energy drift, unlike RK4 over long runs). Particles are
// seeded as K hierarchical clusters: each cluster is a contiguous particle range and a child of
// the root node, so the hierarchy tree can select and highlight a cluster. Counts stay modest
// (O(n²) on the CPU worker); GPU tiled all-pairs / Barnes-Hut is the Phase-2 scaling path.
const PARAM_SPEC: ParamSpec[] = [
  { key: 'G', label: 'G', min: 0, max: 2, step: 0.01, default: 0.6 },
  { key: 'softening', label: 'ε soften', min: 0.02, max: 0.6, step: 0.01, default: 0.1 },
  { key: 'spin', label: 'spin', min: 0, max: 1.5, step: 0.01, default: 0.5 },
  // Mild default cross-scale pull toward COM keeps the swarm bound on-screen (set 0 for free dispersal).
  { key: 'coupling', label: 'cross-scale', min: 0, max: 1.0, step: 0.01, default: 0.3 },
  { key: 'clusters', label: 'clusters', min: 1, max: 6, step: 1, default: 4, options: { '1': 1, '2': 2, '3': 3, '4': 4, '6': 6 }, rebuild: true },
];

const DIM = 6; // x,y,z, vx,vy,vz
const RENDER_SCALE = 1;

class NBodyArchetype implements Archetype {
  readonly id = 'nbody';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly clusters: number;
  private readonly state: Float64Array; // SoA-by-body: [x,y,z,vx,vy,vz] × n
  private readonly accel: Float64Array; // n × 3, persisted between Verlet steps
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly clusterRanges: Array<{ start: number; count: number }> = [];

  constructor(config: ArchetypeConfig) {
    this.particleCount = config.particleCount;
    const n = this.particleCount;
    this.clusters = Math.max(1, Math.min(6, Math.round(config.params.clusters ?? 4)));

    this.state = new Float64Array(n * DIM);
    this.accel = new Float64Array(n * 3);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);

    this.seed(config.seed, config.params);
    this.computeAccel(config.params);
    this.syncPositions();
  }

  private seed(seed: number, p: ResolvedParams): void {
    const rng = mulberry32(seed);
    const n = this.particleCount;
    const K = this.clusters;
    const spin = p.spin ?? 0.6;
    const per = Math.floor(n / K);

    let idx = 0;
    for (let c = 0; c < K; c++) {
      const count = c === K - 1 ? n - idx : per;
      const start = idx;
      this.clusterRanges.push({ start, count });

      // Cluster centre on a ring around the origin; whole-cluster orbital velocity about origin.
      const ang = (c / K) * Math.PI * 2;
      const R = K === 1 ? 0 : 1.1;
      const cx = Math.cos(ang) * R;
      const cy = Math.sin(ang) * R * 0.4;
      const cz = Math.sin(ang * 1.3) * R * 0.3;
      const bulkVx = -Math.sin(ang) * spin;
      const bulkVy = Math.cos(ang) * spin * 0.6;

      const hue = K === 1 ? 0.58 : c / K;
      for (let j = 0; j < count; j++) {
        const o = (start + j) * DIM;
        const r = 0.35 * Math.cbrt(rng());
        const th = rng() * Math.PI * 2;
        const ph = Math.acos(2 * rng() - 1);
        const px = cx + r * Math.sin(ph) * Math.cos(th);
        const py = cy + r * Math.sin(ph) * Math.sin(th);
        const pz = cz + r * Math.cos(ph);
        this.state[o] = px;
        this.state[o + 1] = py;
        this.state[o + 2] = pz;
        // internal spin about the cluster centre + bulk drift
        this.state[o + 3] = bulkVx - (py - cy) * spin * 0.8 + (rng() - 0.5) * 0.05;
        this.state[o + 4] = bulkVy + (px - cx) * spin * 0.8 + (rng() - 0.5) * 0.05;
        this.state[o + 5] = (rng() - 0.5) * 0.05;
        hslToRgb(hue * 0.85, 0.8, 0.62, this.colors, (start + j) * 3);
      }
      idx += count;
    }
  }

  private computeAccel(p: ResolvedParams): void {
    const n = this.particleCount;
    const st = this.state;
    const a = this.accel;
    const G = p.G ?? 0.6;
    const eps2 = (p.softening ?? 0.1) * (p.softening ?? 0.1);
    const coupling = p.coupling ?? 0;
    const m = 1; // equal masses; G absorbs the scale

    a.fill(0);
    // Symmetric pairwise accumulation: compute each pair once, apply to both (Newton's 3rd law).
    for (let i = 0; i < n; i++) {
      const oi = i * DIM;
      const xi = st[oi];
      const yi = st[oi + 1];
      const zi = st[oi + 2];
      let axi = 0;
      let ayi = 0;
      let azi = 0;
      for (let j = i + 1; j < n; j++) {
        const oj = j * DIM;
        const dx = st[oj] - xi;
        const dy = st[oj + 1] - yi;
        const dz = st[oj + 2] - zi;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const inv = 1 / (r2 * Math.sqrt(r2)); // (r²+ε²)^(-3/2)
        const f = G * m * inv;
        const fx = dx * f;
        const fy = dy * f;
        const fz = dz * f;
        axi += fx;
        ayi += fy;
        azi += fz;
        const aj = j * 3;
        a[aj] -= fx;
        a[aj + 1] -= fy;
        a[aj + 2] -= fz;
      }
      const ai = i * 3;
      a[ai] += axi;
      a[ai + 1] += ayi;
      a[ai + 2] += azi;
    }

    // Cross-scale coupling: a mild monopole pull toward the global centre of mass (PRD §2).
    if (coupling > 0) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < n; i++) {
        const o = i * DIM;
        cx += st[o];
        cy += st[o + 1];
        cz += st[o + 2];
      }
      cx /= n;
      cy /= n;
      cz /= n;
      for (let i = 0; i < n; i++) {
        const o = i * DIM;
        const ai = i * 3;
        a[ai] += (cx - st[o]) * coupling;
        a[ai + 1] += (cy - st[o + 1]) * coupling;
        a[ai + 2] += (cz - st[o + 2]) * coupling;
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const n = this.particleCount;
    const st = this.state;
    const a = this.accel;
    const halfDt2 = 0.5 * dt * dt;

    // Velocity-Verlet: drift with old accel, recompute accel, half-kick with average accel.
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const ai = i * 3;
      st[o] += st[o + 3] * dt + a[ai] * halfDt2;
      st[o + 1] += st[o + 4] * dt + a[ai + 1] * halfDt2;
      st[o + 2] += st[o + 5] * dt + a[ai + 2] * halfDt2;
      // stash old accel into velocity slot increment later; do half-kick with old accel now
      st[o + 3] += a[ai] * 0.5 * dt;
      st[o + 4] += a[ai + 1] * 0.5 * dt;
      st[o + 5] += a[ai + 2] * 0.5 * dt;
    }
    this.computeAccel(p);
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const ai = i * 3;
      st[o + 3] += a[ai] * 0.5 * dt;
      st[o + 4] += a[ai + 1] * 0.5 * dt;
      st[o + 5] += a[ai + 2] * 0.5 * dt;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const n = this.particleCount;
    const st = this.state;
    const pos = this.positions;
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const po = i * 3;
      pos[po] = st[o] * RENDER_SCALE;
      pos[po + 1] = st[o + 1] * RENDER_SCALE;
      pos[po + 2] = st[o + 2] * RENDER_SCALE;
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }

  readColors(): Float32Array {
    return this.colors;
  }

  readState(): Float64Array {
    return this.state;
  }

  loadState(s: Float64Array): void {
    this.state.set(s.subarray(0, this.state.length));
    this.syncPositions();
  }

  getHierarchy(): NodeSpec[] {
    const nodes: NodeSpec[] = [
      { id: 'root', parentId: null, label: 'System', stateOffset: 0, stateLength: this.state.length, particleStart: 0, particleCount: this.particleCount },
    ];
    this.clusterRanges.forEach((r, c) => {
      nodes.push({
        id: `cluster${c}`,
        parentId: 'root',
        label: `Cluster ${c} (${r.count})`,
        stateOffset: r.start * DIM,
        stateLength: r.count * DIM,
        particleStart: r.start,
        particleCount: r.count,
      });
    });
    return nodes;
  }

  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.02 };
  }

  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const nbodyFactory: ArchetypeFactory = {
  id: 'nbody',
  label: 'N-Body',
  category: 'N-Body',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 3000,
  defaultDt: 0.012,
  particleCountOptions: [1000, 2000, 3000, 5000],
  create: (config) => new NBodyArchetype(config),
};

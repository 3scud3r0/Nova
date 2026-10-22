import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Attractor Swarm. A scatter of strange attractors, each a small tumbling "butterfly" — the Sagan
// image of butterflies "who flutter for a day and think it is forever", and a nod to the butterfly
// effect the Lorenz attractor gave its name to. Each butterfly is a strange-attractor trajectory baked
// once into a point cloud, normalised, given a random orientation, and scattered on a ring; per frame
// each just tumbles about its own axis (the shape is fixed, only the rotation animates). In 'lorenz'
// mode every butterfly is a Lorenz attractor; in 'mixed' mode they cycle through a menagerie of
// species. White on black. Bounded (every attractor here is dissipative + clamped at bake).

type Species = 'lorenz' | 'rossler' | 'aizawa' | 'thomas' | 'halvorsen';
const MENAGERIE: Species[] = ['lorenz', 'rossler', 'aizawa', 'thomas', 'halvorsen'];
const DT: Record<Species, number> = { lorenz: 0.005, rossler: 0.014, aizawa: 0.01, thomas: 0.05, halvorsen: 0.008 };

// one Euler step of each attractor's ODE
function stepSpecies(sp: Species, x: number, y: number, z: number, dt: number): [number, number, number] {
  switch (sp) {
    case 'lorenz':
      return [x + dt * 10 * (y - x), y + dt * (x * (28 - z) - y), z + dt * (x * y - (8 / 3) * z)];
    case 'rossler':
      return [x + dt * (-y - z), y + dt * (x + 0.2 * y), z + dt * (0.2 + z * (x - 5.7))];
    case 'aizawa': {
      const a = 0.95, b = 0.7, c = 0.6, d = 3.5, e = 0.25, f = 0.1;
      return [
        x + dt * ((z - b) * x - d * y),
        y + dt * (d * x + (z - b) * y),
        z + dt * (c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x),
      ];
    }
    case 'thomas': {
      const b = 0.19;
      return [x + dt * (Math.sin(y) - b * x), y + dt * (Math.sin(z) - b * y), z + dt * (Math.sin(x) - b * z)];
    }
    case 'halvorsen': {
      const a = 1.89;
      return [
        x + dt * (-a * x - 4 * y - 4 * z - y * y),
        y + dt * (-a * y - 4 * z - 4 * x - z * z),
        z + dt * (-a * z - 4 * x - 4 * y - x * x),
      ];
    }
  }
}

class AttractorSwarmArchetype implements Archetype {
  readonly id: string;
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly mode: 'lorenz' | 'mixed';
  private readonly bx: Float64Array; // baked oriented + scaled local coords (relative to butterfly centre)
  private readonly by: Float64Array;
  private readonly bz: Float64Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private M = 8; // butterfly count
  private K = 1; // points per butterfly
  private cen: Float64Array = new Float64Array(0); // per-butterfly centre (M·3)
  private axis: Float64Array = new Float64Array(0); // per-butterfly tumble axis (M·3)
  private rate: Float64Array = new Float64Array(0); // per-butterfly tumble rate
  private t = 0;
  private buildKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig, mode: 'lorenz' | 'mixed') {
    this.mode = mode;
    this.id = mode === 'lorenz' ? 'lorenzSwarm' : 'attractorMenagerie';
    this.particleCount = Math.max(1, config.particleCount);
    this.bx = new Float64Array(this.particleCount);
    this.by = new Float64Array(this.particleCount);
    this.bz = new Float64Array(this.particleCount);
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.seed = config.seed;
    this.rebuild(config.params);
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round(p.count ?? 8)},${Math.round((p.scatter ?? 1.5) * 100)}`;
  }

  private rebuild(p: ResolvedParams): void {
    this.M = Math.max(1, Math.round(p.count ?? 8));
    const ring = p.scatter ?? 1.5;
    this.buildKey = this.keyOf(p);
    const rng = mulberry32((this.seed ^ 0x27d4eb2f) >>> 0);
    const N = this.particleCount;
    const M = this.M;
    this.K = Math.max(1, Math.floor(N / M));
    this.cen = new Float64Array(M * 3);
    this.axis = new Float64Array(M * 3);
    this.rate = new Float64Array(M);
    const col = this.colors;
    const tmp = new Float64Array(this.K * 3); // one butterfly's raw trajectory
    for (let b = 0; b < M; b++) {
      const sp: Species = this.mode === 'lorenz' ? 'lorenz' : MENAGERIE[b % MENAGERIE.length];
      const dt = DT[sp];
      // integrate a trajectory, discard the transient, collect K points (guarded against blow-up)
      let x = 0.1 + (rng() - 0.5) * 0.2;
      let y = (rng() - 0.5) * 0.2;
      let z = sp === 'lorenz' ? 0.1 : (rng() - 0.5) * 0.2;
      for (let w = 0; w < 800; w++) [x, y, z] = stepSpecies(sp, x, y, z, dt);
      let cxp = 0, cyp = 0, czp = 0;
      for (let i = 0; i < this.K; i++) {
        [x, y, z] = stepSpecies(sp, x, y, z, dt);
        if (!Number.isFinite(x) || Math.abs(x) + Math.abs(y) + Math.abs(z) > 1e4) {
          x = 0.1; y = 0; z = 0.1; // reset on divergence
        }
        tmp[i * 3] = x; tmp[i * 3 + 1] = y; tmp[i * 3 + 2] = z;
        cxp += x; cyp += y; czp += z;
      }
      cxp /= this.K; cyp /= this.K; czp /= this.K;
      let maxR = 1e-3;
      for (let i = 0; i < this.K; i++) {
        const dx = tmp[i * 3] - cxp, dy = tmp[i * 3 + 1] - cyp, dz = tmp[i * 3 + 2] - czp;
        maxR = Math.max(maxR, Math.hypot(dx, dy, dz));
      }
      const scale = 0.52 / maxR; // normalise each butterfly to ≈radius 0.52
      // a random orientation for this butterfly (two basis vectors → orthonormal frame)
      const [ox, oy, oz, px, py, pz, qx, qy, qz] = randomFrame(rng);
      // scatter centre: on a ring in the view plane, with depth + radial jitter
      const ang = (b / M) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const rr = ring * (0.7 + 0.5 * rng());
      this.cen[b * 3] = Math.cos(ang) * rr;
      this.cen[b * 3 + 1] = Math.sin(ang) * rr * 0.8;
      this.cen[b * 3 + 2] = (rng() - 0.5) * ring * 0.7;
      // tumble axis + rate
      const [axx, ayy, azz] = normalize3(rng() - 0.5, rng() - 0.5, rng() - 0.5);
      this.axis[b * 3] = axx; this.axis[b * 3 + 1] = ayy; this.axis[b * 3 + 2] = azz;
      this.rate[b] = (rng() < 0.5 ? -1 : 1) * (0.12 + 0.28 * rng());
      const start = b * this.K;
      const end = b === M - 1 ? N : start + this.K; // last butterfly absorbs the remainder
      for (let i = start; i < end; i++) {
        const j = Math.min(this.K - 1, i - start);
        const lx = (tmp[j * 3] - cxp) * scale;
        const ly = (tmp[j * 3 + 1] - cyp) * scale;
        const lz = (tmp[j * 3 + 2] - czp) * scale;
        // orient into the butterfly's baked frame
        this.bx[i] = lx * ox + ly * px + lz * qx;
        this.by[i] = lx * oy + ly * py + lz * qy;
        this.bz[i] = lx * oz + ly * pz + lz * qz;
        const v = 0.84 + 0.16 * (j / this.K); // bright, with a faint gradient along the trajectory
        col[i * 3] = v;
        col[i * 3 + 1] = v;
        col[i * 3 + 2] = v * 0.96;
      }
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const pos = this.positions;
    const N = this.particleCount;
    for (let b = 0; b < this.M; b++) {
      const th = this.rate[b] * this.t;
      const c = Math.cos(th), s = Math.sin(th), omc = 1 - c;
      const kx = this.axis[b * 3], ky = this.axis[b * 3 + 1], kz = this.axis[b * 3 + 2];
      const cx = this.cen[b * 3], cy = this.cen[b * 3 + 1], cz = this.cen[b * 3 + 2];
      const start = b * this.K;
      const end = b === this.M - 1 ? N : start + this.K;
      for (let i = start; i < end; i++) {
        const vx = this.bx[i], vy = this.by[i], vz = this.bz[i];
        // Rodrigues rotation of v about unit axis k by angle th
        const kv = kx * vx + ky * vy + kz * vz;
        const crx = ky * vz - kz * vy;
        const cry = kz * vx - kx * vz;
        const crz = kx * vy - ky * vx;
        const o = i * 3;
        pos[o] = cx + vx * c + crx * s + kx * kv * omc;
        pos[o + 1] = cy + vy * c + cry * s + ky * kv * omc;
        pos[o + 2] = cz + vz * c + crz * s + kz * kv * omc;
      }
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const key = this.keyOf(p);
    if (key !== this.buildKey) {
      this.rebuild(p);
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
    return [{ id: 'root', parentId: null, label: this.mode === 'lorenz' ? `Lorenz swarm (${this.M})` : `Attractor menagerie (${this.M})`, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.011 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

// a random right-handed orthonormal frame (3 basis vectors) from the rng
function randomFrame(rng: () => number): number[] {
  let [ax, ay, az] = normalize3(rng() - 0.5, rng() - 0.5, rng() - 0.5);
  let bx = rng() - 0.5, by = rng() - 0.5, bz = rng() - 0.5;
  // Gram–Schmidt: make b ⟂ a
  const d = bx * ax + by * ay + bz * az;
  bx -= d * ax; by -= d * ay; bz -= d * az;
  [bx, by, bz] = normalize3(bx, by, bz);
  // c = a × b
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  return [ax, ay, az, bx, by, bz, cx, cy, cz];
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

const PARAMS = [
  { key: 'count', label: 'butterflies', min: 3, max: 16, step: 1, default: 8, rebuild: true },
  { key: 'scatter', label: 'scatter', min: 0.8, max: 2.4, step: 0.05, default: 1.5, rebuild: true },
];

export const lorenzSwarmFactory: ArchetypeFactory = {
  id: 'lorenzSwarm',
  label: 'Lorenz Butterfly Swarm',
  category: 'Attractor',
  kind: 'flow',
  params: PARAMS,
  defaultParticleCount: 40_000,
  particleCountOptions: [16_000, 40_000, 80_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the baked butterfly shapes ARE the visual
  create: (config) => new AttractorSwarmArchetype(config, 'lorenz'),
};

export const attractorMenagerieFactory: ArchetypeFactory = {
  id: 'attractorMenagerie',
  label: 'Attractor Menagerie',
  category: 'Attractor',
  kind: 'flow',
  params: PARAMS,
  defaultParticleCount: 40_000,
  particleCountOptions: [16_000, 40_000, 80_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  create: (config) => new AttractorSwarmArchetype(config, 'mixed'),
};

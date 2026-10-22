import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Comb Jelly. The ctenophore's rainbow is one of the ocean's best misdirections: it is NOT
// bioluminescence. Eight meridional COMB ROWS of beating cilia plates act as moving diffraction
// gratings, and as metachronal waves of beating sweep down each row, the diffracted colour sweeps
// with them — shimmering rainbow bands travelling aft along a glassy transparent body. We build it
// faithfully within the colours-bake-once rule: each comb row is a TRAIN of points whose baked
// colours cycle through the spectrum in slot order, and the whole train marches down the meridian —
// so the rainbow physically travels, exactly like the metachronal wave. The body is a faint
// translucent ellipsoid speckle; the animal tumbles slowly in the dark. Bounded by construction.
const TAU = Math.PI * 2;
const A = 0.52; // equatorial radius of the body
const B = 0.85; // polar (long) radius
const ROWS = 8; // ctenophores have eight comb rows
const ROW_END = 0.86; // rows run from the aboral pole to ~86% of the meridian

class CombJellyArchetype implements Archetype {
  readonly id = 'combJelly';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly nBody: number;
  private readonly nComb: number;
  private readonly bodyDir: Float64Array; // baked unit directions for the body speckle
  private readonly combRow: Uint8Array; // which comb row each train point belongs to
  private readonly combU0: Float64Array; // baked base fraction along the row
  private readonly combJit: Float64Array; // baked tangential/normal jitter
  private t = 0;
  private wave = 0.22;
  private tumble = 0.3;
  private pulse = 0.5;

  constructor(config: ArchetypeConfig) {
    this.particleCount = Math.max(64, config.particleCount);
    const N = this.particleCount;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.nBody = Math.floor(N * 0.3);
    this.nComb = N - this.nBody;
    this.bodyDir = new Float64Array(this.nBody * 3);
    this.combRow = new Uint8Array(this.nComb);
    this.combU0 = new Float64Array(this.nComb);
    this.combJit = new Float64Array(this.nComb * 2);

    const rng = mulberry32((config.seed ^ 0xa54ff53a) >>> 0);
    const col = this.colors;
    const golden = Math.PI * (3 - Math.sqrt(5));
    let o = 0;
    for (let i = 0; i < this.nBody; i++, o++) {
      // glassy body: a sparse pale speckle on the ellipsoid (translucency by low density)
      const yk = 1 - 2 * ((i + 0.5) / this.nBody);
      const rr = Math.sqrt(Math.max(0, 1 - yk * yk));
      const phi = i * golden;
      this.bodyDir[i * 3] = rr * Math.cos(phi);
      this.bodyDir[i * 3 + 1] = yk;
      this.bodyDir[i * 3 + 2] = rr * Math.sin(phi);
      const v = 0.05 + 0.09 * rng();
      col[o * 3] = v * 0.75; col[o * 3 + 1] = v * 0.95; col[o * 3 + 2] = v * 1.2;
    }
    const perRow = Math.floor(this.nComb / ROWS);
    for (let i = 0; i < this.nComb; i++, o++) {
      const row = Math.min(ROWS - 1, Math.floor(i / perRow));
      const k = i - row * perRow; // index within the row's train
      this.combRow[i] = row;
      this.combU0[i] = (k / perRow + rng() * 0.002) % 1;
      this.combJit[i * 2] = (rng() - 0.5) * 0.02; // tangential spread (comb-plate width)
      this.combJit[i * 2 + 1] = rng() * 0.012; // slight outward lift off the surface
      // the travelling rainbow: colour cycles with slot order (three spectral repeats per row),
      // so as the train marches the bands sweep down the row — the diffraction wave
      const hue = (k / perRow) * 3 % 1;
      const [r, g, b] = hueToRgb(hue);
      const v = 0.55 + 0.65 * rng();
      col[o * 3] = r * v; col[o * 3 + 1] = g * v; col[o * 3 + 2] = b * v;
    }
    this.readParams(config.params);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.wave = p.wave ?? 0.22;
    this.tumble = p.tumble ?? 0.3;
    this.pulse = p.pulse ?? 0.5;
  }

  private syncPositions(): void {
    const pos = this.positions;
    const t = this.t;
    // gentle body breathing + slow tumble about a tilted axis
    const breath = 1 + 0.035 * this.pulse * Math.sin(t * 1.3);
    const a = A * breath;
    const b = B * (2 - breath);
    const thy = this.tumble * t * 0.55;
    const cy = Math.cos(thy), sy = Math.sin(thy);
    const tilt = 0.45, ct = Math.cos(tilt), st = Math.sin(tilt);
    const place = (o: number, x: number, y: number, z: number): void => {
      const rx = x * cy + z * sy; // spin about the long axis's world-Y
      const rz = -x * sy + z * cy;
      pos[o * 3] = rx;
      pos[o * 3 + 1] = y * ct - rz * st; // fixed tilt so the tumble reads in 3-D
      pos[o * 3 + 2] = y * st + rz * ct;
    };
    let o = 0;
    for (let i = 0; i < this.nBody; i++, o++) {
      place(o, this.bodyDir[i * 3] * a, this.bodyDir[i * 3 + 1] * b, this.bodyDir[i * 3 + 2] * a);
    }
    for (let i = 0; i < this.nComb; i++, o++) {
      const row = this.combRow[i];
      // the train marches: base fraction + wave·t, wrapped — the rainbow travels down the row
      const u = (this.combU0[i] + t * this.wave) % 1;
      const theta = u * Math.PI * ROW_END; // 0 = aboral pole → aft
      const phi = (row / ROWS) * TAU + this.combJit[i * 2];
      const lift = 1 + this.combJit[i * 2 + 1];
      const sx = Math.sin(theta) * Math.cos(phi) * a * lift;
      const sy2 = Math.cos(theta) * b * lift;
      const sz = Math.sin(theta) * Math.sin(phi) * a * lift;
      place(o, sx, sy2, sz);
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
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
    return [{ id: 'root', parentId: null, label: 'Ctenophore (8 comb rows)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.009 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

// minimal HSV→RGB (s=1, v=1) for the baked spectral train
function hueToRgb(h: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  switch (i % 6) {
    case 0: return [1, f, 0];
    case 1: return [1 - f, 1, 0];
    case 2: return [0, 1, f];
    case 3: return [0, 1 - f, 1];
    case 4: return [f, 0, 1];
    default: return [1, 0, 1 - f];
  }
}

export const combJellyFactory: ArchetypeFactory = {
  id: 'combJelly',
  label: 'Comb Jelly',
  category: 'Life',
  kind: 'flow',
  params: [
    { key: 'wave', label: 'cilia wave', min: 0.02, max: 0.8, step: 0.01, default: 0.22 }, // metachronal wave speed
    { key: 'tumble', label: 'tumble', min: 0, max: 1.2, step: 0.05, default: 0.3 },
    { key: 'pulse', label: 'breathing', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  defaultParticleCount: 60_000,
  particleCountOptions: [30_000, 60_000, 120_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the shimmering rows ARE the visual
  bloom: 0.45, // iridescent rows on black — glow, but keep the bands crisp
  create: (config) => new CombJellyArchetype(config),
};

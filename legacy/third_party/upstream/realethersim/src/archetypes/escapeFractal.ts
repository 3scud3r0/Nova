import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
} from '../core/archetype';

// Escape-time fractals (Mandelbrot / Julia / Burning Ship). Unlike the point-cloud systems these are
// a W×W image grid: each cell maps to a complex number c = center + (gridpos)·scale and is coloured
// by how fast z_{n+1} = z_n² + c escapes to infinity (smooth iteration count → a cosine palette);
// points that never escape are the black "set". The render pipeline uploads colours once, so the CPU
// path shows a static view at the default framing — live pan/zoom (changing center/scale/iterations)
// is the GPU-compute path, which recomputes the whole grid every frame.
const EXTENT = 3;
const TAU = Math.PI * 2;
const ITER_OPTIONS = { '64': 64, '128': 128, '192': 192, '256': 256 };

type Kind = 'mandelbrot' | 'julia' | 'burning-ship';

// 3D relief: extrude each cell along Z by its smooth escape value, turning the flat image into an
// orbitable glowing landscape (0 = the classic flat view). Shared across all escape systems.
const RELIEF: ParamSpec = { key: 'relief', label: '3D relief', min: 0, max: 1.5, step: 0.01, default: 0.6 };
const RELIEF_K = 0.16; // height = sqrt(escape) · relief · RELIEF_K  (sqrt compresses the tall boundary)

export interface EscapeSystem {
  id: string;
  label: string;
  kind: Kind;
  paramSpec: ParamSpec[];
  defaults: Record<string, number>;
  pointSize: number;
}

export const ESCAPE_SYSTEMS: Record<string, EscapeSystem> = {
  mandelbrot: {
    id: 'mandelbrot', label: 'Mandelbrot', kind: 'mandelbrot', pointSize: 0.012,
    defaults: { centerRe: -0.5, centerIm: 0, scale: 1.5, maxIter: 128, relief: 0.6 },
    paramSpec: [
      { key: 'centerRe', label: 'center x', min: -2.5, max: 1, step: 0.0005, default: -0.5 },
      { key: 'centerIm', label: 'center y', min: -1.5, max: 1.5, step: 0.0005, default: 0 },
      { key: 'scale', label: 'zoom ½-width', min: 0.0002, max: 2.5, step: 0.0002, default: 1.5 },
      { key: 'maxIter', label: 'iterations', min: 32, max: 256, step: 1, default: 128, options: ITER_OPTIONS },
      RELIEF,
    ],
  },
  julia: {
    id: 'julia', label: 'Julia', kind: 'julia', pointSize: 0.012,
    defaults: { cRe: -0.8, cIm: 0.156, centerRe: 0, centerIm: 0, scale: 1.6, maxIter: 128, relief: 0.6 },
    paramSpec: [
      { key: 'cRe', label: 'c real', min: -2, max: 2, step: 0.0005, default: -0.8 },
      { key: 'cIm', label: 'c imag', min: -2, max: 2, step: 0.0005, default: 0.156 },
      { key: 'centerRe', label: 'center x', min: -2, max: 2, step: 0.0005, default: 0 },
      { key: 'centerIm', label: 'center y', min: -2, max: 2, step: 0.0005, default: 0 },
      { key: 'scale', label: 'zoom ½-width', min: 0.0002, max: 2, step: 0.0002, default: 1.6 },
      { key: 'maxIter', label: 'iterations', min: 32, max: 256, step: 1, default: 128, options: ITER_OPTIONS },
      RELIEF,
    ],
  },
  'burning-ship': {
    id: 'burning-ship', label: 'Burning Ship', kind: 'burning-ship', pointSize: 0.012,
    defaults: { centerRe: -0.5, centerIm: -0.5, scale: 1.5, maxIter: 128, relief: 0.6 },
    paramSpec: [
      { key: 'centerRe', label: 'center x', min: -2, max: 1.5, step: 0.0005, default: -0.5 },
      { key: 'centerIm', label: 'center y', min: -2.2, max: 1, step: 0.0005, default: -0.5 },
      { key: 'scale', label: 'zoom ½-width', min: 0.0002, max: 2, step: 0.0002, default: 1.5 },
      { key: 'maxIter', label: 'iterations', min: 32, max: 256, step: 1, default: 128, options: ITER_OPTIONS },
      RELIEF,
    ],
  },
};

// Smooth escape value: 0 for interior (never escaped), else continuous iteration count.
function escape(kind: Kind, cre: number, cim: number, cR: number, cI: number, maxIter: number): number {
  let zr = kind === 'julia' ? cre : 0;
  let zi = kind === 'julia' ? cim : 0;
  const ucr = kind === 'julia' ? cR : cre;
  const uci = kind === 'julia' ? cI : cim;
  let zr2 = zr * zr;
  let zi2 = zi * zi;
  let n = 0;
  while (n < maxIter && zr2 + zi2 <= 4) {
    const ar = kind === 'burning-ship' ? Math.abs(zr) : zr;
    const ai = kind === 'burning-ship' ? Math.abs(zi) : zi;
    zr = ar * ar - ai * ai + ucr;
    zi = 2 * ar * ai + uci;
    zr2 = zr * zr;
    zi2 = zi * zi;
    n++;
  }
  if (n >= maxIter) return 0;
  return n + 1 - Math.log(Math.log(Math.sqrt(zr2 + zi2))) / Math.LN2;
}

function palette(s: number, out: Float32Array, o: number): void {
  if (s <= 0) {
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
    return;
  }
  const t = s * 0.04 + 0.5;
  out[o] = 0.5 + 0.5 * Math.cos(TAU * (t + 0.0));
  out[o + 1] = 0.5 + 0.5 * Math.cos(TAU * (t + 0.18));
  out[o + 2] = 0.5 + 0.5 * Math.cos(TAU * (t + 0.38));
}

class EscapeFractalArchetype implements Archetype {
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  readonly id: string;

  private readonly W: number;
  private readonly system: EscapeSystem;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly escapeBuf: Float64Array; // smooth escape per cell (for readState)

  constructor(system: EscapeSystem, config: ArchetypeConfig) {
    this.system = system;
    this.id = system.id;
    const w = Math.max(64, Math.round(Math.sqrt(config.particleCount)));
    this.W = w;
    this.particleCount = w * w;
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.escapeBuf = new Float64Array(this.particleCount);

    const p = config.params;
    const centerRe = p.centerRe ?? system.defaults.centerRe;
    const centerIm = p.centerIm ?? system.defaults.centerIm;
    const scale = p.scale ?? system.defaults.scale;
    const maxIter = Math.round(p.maxIter ?? system.defaults.maxIter);
    const cR = p.cRe ?? system.defaults.cRe ?? 0;
    const cI = p.cIm ?? system.defaults.cIm ?? 0;
    const relief = p.relief ?? system.defaults.relief ?? 0.6;
    const half = EXTENT / 2;

    for (let gy = 0; gy < w; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const i = gy * w + gx;
        const nx = (gx / (w - 1)) * 2 - 1;
        const ny = (gy / (w - 1)) * 2 - 1;
        const s = escape(system.kind, nx * scale + centerRe, ny * scale + centerIm, cR, cI, maxIter);
        this.escapeBuf[i] = s;
        // 3D relief: lift each exterior cell by its (sqrt-compressed) escape value.
        const h = Math.sqrt(Math.max(s, 0)) * relief * RELIEF_K;
        this.positions[i * 3] = nx * half;
        this.positions[i * 3 + 1] = ny * half;
        this.positions[i * 3 + 2] = h;
        palette(s, this.colors, i * 3);
        if (s > 0) {
          const lift = Math.min(1.4, 0.7 + h * 0.5); // peaks read brighter → depth cue
          this.colors[i * 3] *= lift;
          this.colors[i * 3 + 1] *= lift;
          this.colors[i * 3 + 2] *= lift;
        }
      }
    }
  }

  step(): void {
    // Static on the CPU path (colours upload once); live pan/zoom is the GPU-compute path.
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return this.escapeBuf;
  }
  loadState(s: Float64Array): void {
    this.escapeBuf.set(s.subarray(0, this.escapeBuf.length));
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `${this.system.label} (${this.W}²)`, stateOffset: 0, stateLength: this.particleCount }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: this.system.pointSize };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export function makeEscapeFactory(system: EscapeSystem): ArchetypeFactory {
  return {
    id: system.id,
    label: system.label,
    category: 'Fractal',
    kind: 'flow',
    params: system.paramSpec,
    defaultParticleCount: 250_000,
    particleCountOptions: [160_000, 250_000, 360_000],
    defaultDt: 0.016,
    create: (config) => new EscapeFractalArchetype(system, config),
  };
}

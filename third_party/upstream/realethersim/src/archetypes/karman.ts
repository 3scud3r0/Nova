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

// Kármán vortex street via the Lattice-Boltzmann method (D2Q9, BGK). Uniform flow past a cylinder
// sheds alternating, counter-rotating vortices — the classic CFD wake. We solve the lattice
// Boltzmann equation on a wide channel grid (collision → streaming with halfway bounce-back on the
// cylinder + walls, equilibrium inflow, zero-gradient outflow), then render each cell coloured /
// lifted by its VORTICITY (curl of velocity), the red/blue field everyone recognises.
//
// Stability: BGK at the low viscosities of moderate Reynolds numbers is delicate, so τ is floored
// and |u| is capped — a high Reynolds slider then saturates rather than blowing up.
const EX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
const EY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
const W9 = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];
const UMAX2 = 0.16 * 0.16; // velocity cap (≈ Mach 0.28) for stability
const TAU_MIN = 0.515; // viscosity floor → effective max Reynolds, prevents BGK blow-up
const Z_SCALE = 7; // vorticity → render height (CPU relief)
const CHANNEL_W = 3.2; // world width of the channel

const PARAM_SPEC: ParamSpec[] = [
  { key: 'reynolds', label: 'Reynolds', min: 40, max: 300, step: 1, default: 180 },
  { key: 'speed', label: 'inflow U', min: 0.03, max: 0.12, step: 0.005, default: 0.08 },
];

export class KarmanArchetype implements Archetype {
  readonly id = 'karman';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly W: number;
  private readonly H: number;
  private readonly cells: number;
  private readonly D: number; // cylinder diameter (cells)
  private readonly solid: Uint8Array;
  private f: Float64Array;
  private f2: Float64Array;
  private readonly ux: Float64Array;
  private readonly uy: Float64Array;
  private readonly vort: Float64Array; // exposed as render state
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  constructor(config: ArchetypeConfig) {
    // wide channel, ~4:1 aspect, W·H == particleCount
    const W = Math.max(32, Math.round(2 * Math.sqrt(config.particleCount)));
    const H = Math.max(8, Math.round(config.particleCount / W));
    this.W = W;
    this.H = H;
    this.cells = W * H;
    this.particleCount = this.cells;
    this.D = Math.max(2, Math.round(H / 5));

    this.solid = new Uint8Array(this.cells);
    this.f = new Float64Array(this.cells * 9);
    this.f2 = new Float64Array(this.cells * 9);
    this.ux = new Float64Array(this.cells);
    this.uy = new Float64Array(this.cells);
    this.vort = new Float64Array(this.cells);
    this.positions = new Float32Array(this.cells * 3);
    this.colors = new Float32Array(this.cells * 3);

    // cylinder, offset ~4% off-axis to break symmetry and trigger shedding quickly
    const cxC = Math.floor(W * 0.24);
    const cyC = Math.floor(H / 2) - Math.max(1, Math.round(H * 0.04));
    const r2 = (this.D / 2) * (this.D / 2);
    const scaleX = CHANNEL_W / (W - 1);
    const halfW = CHANNEL_W / 2;
    const worldH = (CHANNEL_W * H) / W; // preserve aspect
    const halfH = worldH / 2;
    const U0 = PARAM_SPEC[1].default;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        const wall = y === 0 || y === H - 1;
        const dx = x - cxC;
        const dy = y - cyC;
        const inCyl = dx * dx + dy * dy <= r2;
        this.solid[c] = wall || inCyl ? 1 : 0;
        // equilibrium init: uniform rightward flow, ρ = 1
        const base = c * 9;
        for (let i = 0; i < 9; i++) this.f[base + i] = this.feq(i, 1, U0, 0);
        // static base position (horizontal XZ plane; vorticity becomes height); downstream rainbow
        this.positions[c * 3] = x * scaleX - halfW;
        this.positions[c * 3 + 1] = 0;
        this.positions[c * 3 + 2] = y * scaleX - halfH;
        hslToRgb(0.58 - (x / W) * 0.5, 0.7, inCyl ? 0.15 : 0.55, this.colors, c * 3);
      }
    }
  }

  private feq(i: number, rho: number, ux: number, uy: number): number {
    const cu = EX[i] * ux + EY[i] * uy;
    return W9[i] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * (ux * ux + uy * uy));
  }

  step(_dt: number, p: ResolvedParams): void {
    const { W, H, cells, D, solid } = this;
    const U = p.speed;
    const nu = (U * D) / Math.max(1, p.reynolds);
    const tau = Math.max(TAU_MIN, 3 * nu + 0.5);
    const invTau = 1 / tau;
    const f = this.f;

    // --- boundary conditions: equilibrium inflow (x=0), zero-gradient outflow (x=W-1) ---
    for (let y = 1; y < H - 1; y++) {
      const cIn = y * W;
      const baseIn = cIn * 9;
      for (let i = 0; i < 9; i++) f[baseIn + i] = this.feq(i, 1, U, 0);
      const cOut = y * W + (W - 1);
      const src = (y * W + (W - 2)) * 9;
      const dst = cOut * 9;
      for (let i = 0; i < 9; i++) f[dst + i] = f[src + i];
    }

    // --- collision (BGK) on interior fluid cells ---
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const c = y * W + x;
        if (solid[c]) continue;
        const base = c * 9;
        let rho = 0;
        let mx = 0;
        let my = 0;
        for (let i = 0; i < 9; i++) {
          const fi = f[base + i];
          rho += fi;
          mx += EX[i] * fi;
          my += EY[i] * fi;
        }
        if (rho < 1e-6) rho = 1e-6;
        let ux = mx / rho;
        let uy = my / rho;
        const u2 = ux * ux + uy * uy;
        if (u2 > UMAX2) {
          const s = Math.sqrt(UMAX2 / u2);
          ux *= s;
          uy *= s;
        }
        for (let i = 0; i < 9; i++) f[base + i] += (this.feq(i, rho, ux, uy) - f[base + i]) * invTau;
      }
    }

    // --- streaming (pull) with halfway bounce-back from solids ---
    const f2 = this.f2;
    for (let c = 0; c < cells; c++) {
      const x = c % W;
      const y = (c / W) | 0;
      const base = c * 9;
      if (solid[c] || x === 0 || x === W - 1 || y === 0 || y === H - 1) {
        for (let i = 0; i < 9; i++) f2[base + i] = f[base + i];
        continue;
      }
      for (let i = 0; i < 9; i++) {
        const sx = x - EX[i];
        const sy = y - EY[i];
        const sc = sy * W + sx;
        f2[base + i] = solid[sc] ? f[base + OPP[i]] : f[sc * 9 + i];
      }
    }
    this.f = f2;
    this.f2 = f;

    this.computeFields();
  }

  // macroscopic velocity + vorticity (curl), written into the render height (z).
  private computeFields(): void {
    const { W, H, solid, ux, uy, vort } = this;
    const f = this.f;
    for (let c = 0; c < this.cells; c++) {
      if (solid[c]) {
        ux[c] = 0;
        uy[c] = 0;
        continue;
      }
      const base = c * 9;
      let rho = 0;
      let mx = 0;
      let my = 0;
      for (let i = 0; i < 9; i++) {
        const fi = f[base + i];
        rho += fi;
        mx += EX[i] * fi;
        my += EY[i] * fi;
      }
      if (rho < 1e-6) rho = 1e-6;
      ux[c] = mx / rho;
      uy[c] = my / rho;
    }
    const pos = this.positions;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const c = y * W + x;
        // ω = ∂uy/∂x − ∂ux/∂y (central difference)
        const w = (uy[c + 1] - uy[c - 1]) * 0.5 - (ux[c + W] - ux[c - W]) * 0.5;
        vort[c] = w;
        pos[c * 3 + 1] = w * Z_SCALE; // relief height (Y); field lies in the XZ plane
      }
    }
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return this.vort;
  }
  loadState(s: Float64Array): void {
    this.vort.set(s.subarray(0, this.vort.length));
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Kármán (${this.W}×${this.H})`, stateOffset: 0, stateLength: this.cells }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.012 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const karmanFactory: ArchetypeFactory = {
  id: 'karman',
  label: 'Kármán Vortex Street',
  category: 'Fluid',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 36_864, // 384×96
  particleCountOptions: [16_384, 36_864, 65_536],
  // The LBM update itself is dt-independent; dt only sets the accumulator's lattice-steps-per-frame
  // (~4 at 60fps), i.e. how fast the wake evolves.
  defaultDt: 0.004,
  create: (config) => new KarmanArchetype(config),
};

import type { Archetype, ArchetypeConfig, ArchetypeFactory, NodeSpec, RenderHint, ResolvedParams } from '../core/archetype';
import { mulberry32 } from '../state/rng';
import { Boussinesq2D } from './spectral2d';

// Rayleigh–Bénard Convection — heat a layer of fluid from below and cool it from above. Warm fluid is lighter
// and wants to rise, cold fluid wants to sink, but viscosity and heat diffusion resist. Below a critical value
// of the Rayleigh number Ra (how strongly buoyancy beats those two) nothing moves and heat simply conducts
// across; above it the layer organises itself into rolls — warm plumes rising (orange), cold ones sinking
// (blue) — and carries heat far faster, measured by the Nusselt number Nu. Push Ra higher and the rolls
// start to wobble, merge and shed plumes: the road to turbulence that drives the Earth's mantle, the Sun's
// surface granulation, and the weather. This is a slice through the layer, hot floor at the bottom.

const LX = 4; // box width (layer depth = 1)
const NX = 128, NZ = 64; // grid (the solver works on the layer and its mirror image: z from −1 to 1)

/** The first unstable roll in this box (free-slip walls): Ra = (kx² + π²)³ / kx², minimised over kx = 2πm/LX. */
export function criticalRa(): { ra: number; m: number } {
  let best = { ra: Infinity, m: 0 };
  for (let m = 1; m < 20; m++) { const kx = (2 * Math.PI * m) / LX, ra = (kx * kx + Math.PI * Math.PI) ** 3 / (kx * kx); if (ra < best.ra) best = { ra, m }; }
  return best;
}

class RayleighBenardArchetype implements Archetype {
  readonly id = 'rayleighBenard';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  readonly sim: Boussinesq2D;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly show: Float64Array; // the layer's temperature T − ½ (rows 0…NZ/2 − 1)
  readonly ra: number; readonly pr: number;
  private speed = 1;
  private debt = 0; // simulated time still owed to the clock

  constructor(config: ArchetypeConfig) {
    this.ra = Math.max(100, config.params.ra ?? 10000);
    this.pr = config.params.pr ?? 1;
    this.readParams(config.params);
    // diffusive units: time in d²/κ; ω gains Pr·Ra ∂θ/∂x; θ gains w (the background T = 1 − z)
    this.sim = new Boussinesq2D(NX, NZ, LX, 2, { nu: this.pr, kappa: 1, G: this.pr * this.ra, S: 1, oddZ: true });
    const N = NX * NZ, H = NZ / 2;
    this.particleCount = NX * H;
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3).fill(0.3);
    this.show = new Float64Array(this.particleCount);
    // start: conduction plus a little random warmth (the walls' symmetry is imposed by the solver)
    const rng = mulberry32(config.seed), th = new Float64Array(N);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const z = (j * 2) / NZ; // 0…2 (the mirror half is z > 1)
      th[j * NX + i] = 0.02 * (rng() - 0.5) * Math.sin(Math.PI * z) + 0.01 * Math.sin(Math.PI * z) * Math.cos((2 * Math.PI * 3 * i) / NX);
    }
    this.sim.setFields(new Float64Array(N), th);
    // let the rolls form before the first frame
    for (let k = 0; k < 600 && this.sim.t < 0.15; k++) this.advance();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void { this.speed = p.speed ?? 1; }

  /** One CFL-limited step; returns the time advanced. */
  private advance(): number {
    const s = this.sim;
    if (s.t === 0) s.toGrid(); // afterwards each step leaves the velocities of the state it started from
    const dx = Math.min(LX / NX, 2 / NZ), um = s.maxSpeed();
    // a fixed step while it allows (Adams–Bashforth likes a constant step); halve it when the flow speeds up
    let dt = Math.min(2e-3, (0.35 * dx) / (um + 1e-9));
    dt = Math.pow(2, Math.floor(Math.log2(dt / 1e-6))) * 1e-6; // quantised, so it rarely changes
    s.step(dt);
    return dt;
  }

  private syncPositions(): void {
    const s = this.sim, H = NZ / 2, out = this.show, pos = this.positions;
    s.scalarsToGrid();
    for (let j = 0; j < H; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, z = (j * 2) / NZ;
      out[k] = 1 - z + s.b[k] - 0.5; // T − ½
      pos[k * 3] = (i / NX - 0.5) * 3.4; pos[k * 3 + 1] = (z - 0.5) * 3.4 / LX; pos[k * 3 + 2] = 0;
    }
  }

  /** Nusselt number: total heat flux / conducted flux = 1 + ⟨wθ⟩ over the layer (diffusive units). */
  nusselt(): number {
    const s = this.sim, H = NZ / 2;
    let acc = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < NX; i++) acc += s.w[j * NX + i] * s.b[j * NX + i];
    return 1 + acc / (NX * H);
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    // diffusive time per second: slow flows (low Ra) get more of it, fast ones less, so each looks lively
    this.debt += dt * this.speed * Math.min(0.12, 0.028 * Math.sqrt(10000 / this.ra));
    let guard = 0;
    while (this.debt > 0 && guard++ < 8) this.debt -= this.advance();
    if (this.debt > 0) this.debt = 0; // too slow to keep up: run slower rather than pile up work
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.sim.t]); }
  loadState(): void { /* the spectral state is rebuilt, not restored */ }
  getHierarchy(): NodeSpec[] {
    const c = criticalRa();
    return [{
      id: 'root', parentId: null,
      label: `Ra = ${Math.round(this.ra)}, Pr = ${this.pr} · the first roll in this box needs Ra > ${c.ra.toFixed(0)} (657.5 in an endless layer) · Nusselt number ${this.nusselt().toFixed(2)} (1 = conduction only)`,
      stateOffset: 0, stateLength: 1,
    }];
  }
  renderHint(): RenderHint { return { geometry: 'points', exposesField: true, pointSize: 0.02 }; }
  readField(): { texture: unknown; width: number; height: number; scale: number; aspect: number; upright: boolean } {
    return { texture: this.show, width: NX, height: NZ / 2, scale: 0.5, aspect: 1 / LX, upright: true };
  }
  dispose(): void { /* buffers GC with the instance */ }
}

export const rayleighBenardFactory: ArchetypeFactory = {
  id: 'rayleighBenard',
  label: 'Rayleigh–Bénard Convection',
  category: 'Fluid',
  kind: 'flow',
  mainThread: true,
  fieldRender: true,
  params: [
    { key: 'ra', label: 'Rayleigh number Ra', min: 300, max: 60000, step: 100, default: 10000, rebuild: true },
    { key: 'pr', label: 'Prandtl number Pr', min: 0.5, max: 7, step: 0.1, default: 1, rebuild: true },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 4096,
  particleCountOptions: [4096],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.3,
  create: (config) => new RayleighBenardArchetype(config),
};

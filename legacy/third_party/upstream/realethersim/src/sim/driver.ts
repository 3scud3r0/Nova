import type { NodeSpec } from '../core/archetype';
import { SimulationManager } from '../core/manager';
import { Accumulator } from './accumulator';
import { TrailRing } from './trail';

// A SimDriver abstracts WHERE the simulation runs. The render loop treats both the same:
// pump() advances time (a no-op for the autonomous Worker), source() returns the positions to
// draw this frame. This lets bootstrap swap a Worker+SAB driver for a main-thread one based on
// capability (cross-origin isolation) without the renderer knowing the difference.
export interface SimDriver {
  readonly archetypeId: string;
  readonly particleCount: number;
  readonly colors: Float32Array | null;
  readonly pointSize: number;
  readonly hierarchy: NodeSpec[];

  pump(dtSeconds: number): number; // advance the sim (main-thread); returns substeps. 0 for Worker.
  source(): Float32Array; // positions to render this frame
  readField?(): { texture: unknown; width: number; height: number; mask?: ArrayLike<number>; scale?: number; aspect?: number; upright?: boolean } | null; // 2-D scalar field for the field-texture render (main-thread systems only)
  frameIndex(): number;
  substeps(): number;
  // Trail ring buffer (FR-2.2): K-slot history the renderer draws as age-faded clouds.
  trailRing(): Float32Array;
  trailSlots(): number;
  trailHead(): number;
  setTrailLength(steps: number): void;
  setParams(params: Record<string, number>, dt: number): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}

// Main-thread driver: the integrator runs in the render loop's pump(), gated by a fixed-timestep
// accumulator. Used as the fallback when SharedArrayBuffer is unavailable (no COOP/COEP headers).
export class MainThreadDriver implements SimDriver {
  readonly archetypeId: string;
  readonly particleCount: number;
  readonly colors: Float32Array | null;
  readonly pointSize: number;
  readonly hierarchy: NodeSpec[];

  private manager: SimulationManager;
  private accumulator: Accumulator;
  private trail: TrailRing;
  private paused = false;
  private lastSub = 0;

  constructor(
    archetypeId: string,
    params: Record<string, number>,
    dt: number,
    particleCount: number,
    seed = 1,
  ) {
    this.manager = new SimulationManager(archetypeId, params, dt, particleCount, seed);
    this.accumulator = new Accumulator(dt);
    this.archetypeId = archetypeId;
    this.particleCount = this.manager.active.particleCount;
    this.colors = this.manager.colors();
    this.pointSize = this.manager.pointSize();
    this.hierarchy = this.manager.hierarchy();
    this.trail = new TrailRing(this.particleCount);
    this.trail.seed(this.manager.positions());
  }

  pump(dtSeconds: number): number {
    if (this.paused) return 0;
    this.lastSub = this.accumulator.run(dtSeconds, () => {
      this.manager.step();
      this.trail.capture(this.manager.positions());
    });
    return this.lastSub;
  }

  trailRing(): Float32Array {
    return this.trail.ring;
  }

  trailSlots(): number {
    return this.trail.slots;
  }

  trailHead(): number {
    return this.trail.getHead();
  }

  setTrailLength(steps: number): void {
    this.trail.setLength(steps);
  }

  source(): Float32Array {
    return this.manager.positions();
  }

  readField(): { texture: unknown; width: number; height: number; mask?: ArrayLike<number>; scale?: number; aspect?: number; upright?: boolean } | null {
    return this.manager.active.readField?.() ?? null;
  }

  frameIndex(): number {
    return this.manager.frameIndex;
  }

  substeps(): number {
    return this.lastSub;
  }

  setParams(params: Record<string, number>, dt: number): void {
    this.manager.setParams(params, dt);
    this.accumulator.dt = dt;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  dispose(): void {
    this.manager.dispose();
  }
}

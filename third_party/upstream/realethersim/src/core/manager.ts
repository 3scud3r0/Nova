import type { Archetype, NodeSpec, ResolvedParams } from './archetype';
import { getFactory } from './registry';
import { resolveParams } from './params';

// State Orchestrator: owns the active archetype + resolved params and drives stepping.
// It calls only the Archetype contract — never physics internals. Used by the main-thread
// driver and (the same class) inside the sim Worker.
export class SimulationManager {
  readonly archetypeId: string;
  readonly seed: number;
  frameIndex = 0;

  private archetype: Archetype;
  private archetypeParams: Record<string, number>;
  private dt: number;
  private resolved: ResolvedParams; // cached so step() never allocates

  constructor(
    archetypeId: string,
    archetypeParams: Record<string, number>,
    dt: number,
    particleCount: number,
    seed = 1,
  ) {
    this.archetypeId = archetypeId;
    this.archetypeParams = { ...archetypeParams };
    this.dt = dt;
    this.seed = seed;
    this.resolved = resolveParams(this.archetypeParams, dt);
    this.archetype = getFactory(archetypeId).create({ particleCount, seed, params: this.resolved });
  }

  get active(): Archetype {
    return this.archetype;
  }

  setParams(archetypeParams: Record<string, number>, dt: number): void {
    this.archetypeParams = { ...archetypeParams };
    this.dt = dt;
    this.resolved = resolveParams(this.archetypeParams, dt);
  }

  step(): void {
    this.archetype.step(this.dt, this.resolved);
    this.frameIndex++;
  }

  positions(): Float32Array {
    return this.archetype.readPositions();
  }

  colors(): Float32Array | null {
    return this.archetype.readColors();
  }

  pointSize(): number {
    return this.archetype.renderHint().pointSize ?? 0.02;
  }

  hierarchy(): NodeSpec[] {
    return this.archetype.getHierarchy();
  }

  dispose(): void {
    this.archetype.dispose();
  }
}

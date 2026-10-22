import type { NodeSpec } from '../core/archetype';
import type { SimDriver } from './driver';

// Inert SimDriver used while a raymarch (sphere-traced fractal) archetype is active. It spawns NO
// worker and runs NO SimulationManager — so the CPU/worker point pipeline never instantiates a
// raymarch factory — yet keeps `driver` a valid non-null object so doRebuild()/exportSnapshot()/
// togglePause() in bootstrap stay branch-free. All motion happens in the raymarch shader instead.
export class NullDriver implements SimDriver {
  readonly archetypeId: string;
  readonly particleCount = 1;
  readonly colors: Float32Array | null = null;
  readonly pointSize = 0.02;
  readonly hierarchy: NodeSpec[];
  private readonly pos = new Float32Array(3);

  constructor(archetypeId: string, label: string) {
    this.archetypeId = archetypeId;
    this.hierarchy = [{ id: 'root', parentId: null, label, stateOffset: 0, stateLength: 0 }];
  }

  pump(): number {
    return 0;
  }
  source(): Float32Array {
    return this.pos;
  }
  frameIndex(): number {
    return 0;
  }
  substeps(): number {
    return 0;
  }
  trailRing(): Float32Array {
    return this.pos;
  }
  trailSlots(): number {
    return 0;
  }
  trailHead(): number {
    return 0;
  }
  setTrailLength(): void {}
  setParams(): void {}
  setPaused(): void {}
  dispose(): void {}
}

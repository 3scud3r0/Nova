import type { NodeSpec } from '../core/archetype';
import { CURRENT_SCHEMA_VERSION, type Snapshot, type SnapshotCamera } from './schema';

export interface SnapshotInput {
  archetypeId: string;
  particleCount: number;
  dt: number;
  trailLength: number;
  archetypeParams: Record<string, number>;
  hierarchy: NodeSpec[];
  camera: SnapshotCamera;
  frameIndex: number;
  seed: number;
}

// Driver-agnostic snapshot builder (FR-3.3). Both sim drivers feed it the same fields.
export function buildSnapshot(i: SnapshotInput): Snapshot {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    archetypeId: i.archetypeId,
    particleCount: i.particleCount,
    global: { dt: i.dt, trailLength: i.trailLength },
    archetypeParams: { ...i.archetypeParams },
    hierarchy: i.hierarchy,
    matrices: {},
    initVectors: {},
    camera: i.camera,
    rng: { seed: i.seed },
    frameIndex: i.frameIndex,
  };
}

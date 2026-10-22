import type * as THREE from 'three';

// TSL nodes are dynamically typed; we use `GpuNode` (any) for kernel-graph locals and a few
// fluent calls the bundled d.ts under-declares. Correctness is verified at runtime in the browser.
export type GpuNode = any;

export interface GpuSim {
  points: THREE.Points;
  init: GpuNode | null; // optional one-shot init compute (seeds buffers)
  steps: GpuNode[]; // compute passes run in order, `substeps` times per frame
  substeps: number;
  particleCount: number;
  pointSize: number;
  setParams(p: Record<string, number>): void;
  dispose(): void;
}

export type GpuFactory = (count: number, dt: number, params: Record<string, number>) => GpuSim;

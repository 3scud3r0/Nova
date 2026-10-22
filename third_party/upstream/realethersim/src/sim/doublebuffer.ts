// Double-buffered position publishing across the Worker/main boundary via SharedArrayBuffer.
// The Worker writes the inactive slab, then flips a control word (Atomics); the main thread
// reads whichever slab is latest. With two slabs the reader's copy can at worst blend a few
// particles from the next frame — imperceptible for a 100k point cloud. (A triple buffer would
// remove even that; deferred until profiling shows it matters.)

import { trailRingBytes } from './trail';

export const CONTROL_READY = 0; // index of the latest fully-written slab (0 or 1)
export const CONTROL_FRAME = 1; // frameIndex
export const CONTROL_SUBSTEPS = 2; // substeps in the last tick
export const CONTROL_TRAIL_HEAD = 3; // current trail ring head slot
export const CONTROL_WORDS = 4;
export const SLAB_COUNT = 2;

export interface SharedBuffers {
  control: SharedArrayBuffer; // Int32Array(CONTROL_WORDS)
  data: SharedArrayBuffer; // Float32Array(SLAB_COUNT * particleCount * 3)
  trail: SharedArrayBuffer; // Float32Array(TRAIL_SLOTS * particleCount * 3)
  particleCount: number;
}

export function allocSharedBuffers(particleCount: number): SharedBuffers {
  const stride = particleCount * 3;
  return {
    control: new SharedArrayBuffer(CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT),
    data: new SharedArrayBuffer(SLAB_COUNT * stride * Float32Array.BYTES_PER_ELEMENT),
    trail: new SharedArrayBuffer(trailRingBytes(particleCount)),
    particleCount,
  };
}

export class SlabWriter {
  private control: Int32Array;
  private data: Float32Array;
  private stride: number;
  private writeIdx = 0;

  constructor(b: SharedBuffers) {
    this.control = new Int32Array(b.control);
    this.data = new Float32Array(b.data);
    this.stride = b.particleCount * 3;
  }

  publish(positions: Float32Array, frameIndex: number, substeps: number): void {
    const slab = this.writeIdx;
    this.data.set(positions, slab * this.stride);
    Atomics.store(this.control, CONTROL_FRAME, frameIndex | 0);
    Atomics.store(this.control, CONTROL_SUBSTEPS, substeps | 0);
    Atomics.store(this.control, CONTROL_READY, slab); // flip last: readers now see the new slab
    this.writeIdx = 1 - slab;
  }
}

export class SlabReader {
  private control: Int32Array;
  private data: Float32Array;
  private stride: number;

  constructor(b: SharedBuffers) {
    this.control = new Int32Array(b.control);
    this.data = new Float32Array(b.data);
    this.stride = b.particleCount * 3;
  }

  read(): Float32Array {
    const slab = Atomics.load(this.control, CONTROL_READY);
    const start = slab * this.stride;
    return this.data.subarray(start, start + this.stride);
  }

  frameIndex(): number {
    return Atomics.load(this.control, CONTROL_FRAME);
  }

  substeps(): number {
    return Atomics.load(this.control, CONTROL_SUBSTEPS);
  }
}

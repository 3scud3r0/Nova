import type { NodeSpec } from '../core/archetype';
import type { SimDriver } from './driver';
import { allocSharedBuffers, CONTROL_TRAIL_HEAD, SlabReader, type SharedBuffers } from './doublebuffer';
import { TRAIL_SLOTS } from './trail';

interface ReadyMsg {
  type: 'ready';
  particleCount: number;
  pointSize: number;
  hierarchy: NodeSpec[];
  colors: ArrayBuffer | null;
}
interface TelemetryMsg { type: 'telemetry'; frameIndex: number; substeps: number }
type OutMsg = ReadyMsg | TelemetryMsg;

// Worker driver: the integrator runs in sim.worker.ts; this side allocates the shared buffers,
// spawns the worker, and reads the latest published slab each frame. create() resolves once the
// worker reports `ready` (with the per-particle colors + render metadata).
export class WorkerDriver implements SimDriver {
  readonly archetypeId: string;
  readonly particleCount: number;
  colors: Float32Array | null = null;
  pointSize = 0.02;
  hierarchy: NodeSpec[] = [];

  private worker: Worker;
  private reader: SlabReader;
  private control: Int32Array;
  private trail: Float32Array;
  private _frame = 0;

  private constructor(archetypeId: string, particleCount: number, worker: Worker, buffers: SharedBuffers) {
    this.archetypeId = archetypeId;
    this.particleCount = particleCount;
    this.worker = worker;
    this.reader = new SlabReader(buffers);
    this.control = new Int32Array(buffers.control);
    this.trail = new Float32Array(buffers.trail);
  }

  static create(
    archetypeId: string,
    params: Record<string, number>,
    dt: number,
    particleCount: number,
    seed = 1,
    trailLength = 0,
  ): Promise<WorkerDriver> {
    return new Promise((resolve) => {
      const buffers = allocSharedBuffers(particleCount);
      const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
      const driver = new WorkerDriver(archetypeId, particleCount, worker, buffers);

      worker.onmessage = (ev: MessageEvent<OutMsg>): void => {
        const msg = ev.data;
        if (msg.type === 'ready') {
          driver.colors = msg.colors ? new Float32Array(msg.colors) : null;
          driver.pointSize = msg.pointSize;
          driver.hierarchy = msg.hierarchy;
          resolve(driver);
        } else if (msg.type === 'telemetry') {
          driver._frame = msg.frameIndex;
        }
      };

      worker.postMessage({ type: 'init', archetypeId, params, dt, particleCount, seed, trailLength, buffers });
    });
  }

  pump(): number {
    return 0; // the worker advances autonomously
  }

  source(): Float32Array {
    return this.reader.read();
  }

  frameIndex(): number {
    return this._frame;
  }

  substeps(): number {
    return this.reader.substeps();
  }

  trailRing(): Float32Array {
    return this.trail;
  }

  trailSlots(): number {
    return TRAIL_SLOTS;
  }

  trailHead(): number {
    return Atomics.load(this.control, CONTROL_TRAIL_HEAD);
  }

  setTrailLength(steps: number): void {
    this.worker.postMessage({ type: 'trail', steps });
  }

  setParams(params: Record<string, number>, dt: number): void {
    this.worker.postMessage({ type: 'params', params, dt });
  }

  setPaused(paused: boolean): void {
    this.worker.postMessage({ type: 'pause', paused });
  }

  dispose(): void {
    this.worker.terminate();
  }
}

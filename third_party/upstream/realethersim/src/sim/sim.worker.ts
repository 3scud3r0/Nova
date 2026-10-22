import { registerArchetypes } from '../archetypes';
import { SimulationManager } from '../core/manager';
import { Accumulator } from './accumulator';
import { CONTROL_TRAIL_HEAD, SlabWriter, type SharedBuffers } from './doublebuffer';
import { TrailRing } from './trail';

// Autonomous simulation worker (FR-1.3): owns the authoritative f64 state, runs the
// fixed-timestep integrator on its own clock, and publishes f32 positions to the shared
// double-buffer. Decoupled from the render frame rate entirely.
registerArchetypes();

interface InitMsg {
  type: 'init';
  archetypeId: string;
  params: Record<string, number>;
  dt: number;
  particleCount: number;
  seed: number;
  trailLength: number;
  buffers: SharedBuffers;
}
interface ParamsMsg { type: 'params'; params: Record<string, number>; dt: number }
interface PauseMsg { type: 'pause'; paused: boolean }
interface TrailMsg { type: 'trail'; steps: number }
type InMsg = InitMsg | ParamsMsg | PauseMsg | TrailMsg;

// `self` is typed as Window under the DOM lib; cast to sidestep the Worker/DOM postMessage
// signature clash. (App code; not a place where the extra safety would buy much.)
const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<InMsg>) => void) | null;
};

let manager: SimulationManager | null = null;
let accumulator: Accumulator | null = null;
let writer: SlabWriter | null = null;
let trail: TrailRing | null = null;
let control: Int32Array | null = null;
let paused = false;
let last = 0;
let telemetryAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  if (!manager || !accumulator || !writer) return;
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  let sub = 0;
  if (!paused) {
    sub = accumulator.run(dt, () => {
      manager!.step();
      trail?.capture(manager!.positions());
    });
  }
  writer.publish(manager.positions(), manager.frameIndex, sub);
  if (trail && control) Atomics.store(control, CONTROL_TRAIL_HEAD, trail.getHead());
  if (now - telemetryAt > 250) {
    telemetryAt = now;
    ctx.postMessage({ type: 'telemetry', frameIndex: manager.frameIndex, substeps: sub });
  }
}

ctx.onmessage = (ev: MessageEvent<InMsg>): void => {
  const msg = ev.data;
  if (msg.type === 'init') {
    if (timer !== null) clearInterval(timer);
    manager = new SimulationManager(msg.archetypeId, msg.params, msg.dt, msg.particleCount, msg.seed);
    accumulator = new Accumulator(msg.dt);
    writer = new SlabWriter(msg.buffers);
    control = new Int32Array(msg.buffers.control);
    trail = new TrailRing(manager.active.particleCount, msg.buffers.trail);
    trail.setLength(msg.trailLength);
    trail.seed(manager.positions());
    paused = false;
    last = performance.now();
    telemetryAt = 0;

    const colors = manager.colors();
    const colorsBuf = colors ? colors.slice().buffer : null;
    const ready = {
      type: 'ready',
      particleCount: manager.active.particleCount,
      pointSize: manager.pointSize(),
      hierarchy: manager.hierarchy(),
      colors: colorsBuf,
    };
    if (colorsBuf) ctx.postMessage(ready, [colorsBuf]);
    else ctx.postMessage(ready);

    timer = setInterval(tick, 4);
  } else if (msg.type === 'params') {
    manager?.setParams(msg.params, msg.dt);
    if (accumulator) accumulator.dt = msg.dt;
  } else if (msg.type === 'pause') {
    paused = msg.paused;
  } else if (msg.type === 'trail') {
    trail?.setLength(msg.steps);
  }
};

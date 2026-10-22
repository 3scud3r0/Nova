// Subsampled trail ring buffer (FR-2.2). K fixed slots per particle; the current position is
// captured into the rotating head slot every `stride` sim steps, where stride = trailLength / K.
// So the UI's 0–1000 "trail length" maps onto a constant-memory K-slot ring (the slider changes
// temporal spacing, not memory). Lives in shared memory in the Worker path; a plain ArrayBuffer
// on the main-thread fallback. The same class is the writer (sim side) — the renderer reads the
// ring + head and draws K age-faded point clouds.
export const TRAIL_SLOTS = 24;

export function trailRingBytes(particleCount: number): number {
  return TRAIL_SLOTS * particleCount * 3 * Float32Array.BYTES_PER_ELEMENT;
}

export class TrailRing {
  readonly ring: Float32Array;
  readonly slots = TRAIL_SLOTS;
  private readonly n: number;
  private head = 0;
  private counter = 0;
  private stride = 5;
  private enabled = true;

  constructor(particleCount: number, buffer?: ArrayBufferLike) {
    this.n = particleCount;
    this.ring = buffer ? new Float32Array(buffer) : new Float32Array(TRAIL_SLOTS * particleCount * 3);
  }

  // trailLength in sim steps (0 disables capture). stride spreads it across the K slots.
  setLength(steps: number): void {
    this.enabled = steps > 0;
    this.stride = Math.max(1, Math.round(steps / TRAIL_SLOTS));
  }

  // Prime every slot with the current positions so a fresh trail starts as a point, not at origin.
  seed(positions: Float32Array): void {
    const span = this.n * 3;
    for (let s = 0; s < TRAIL_SLOTS; s++) this.ring.set(positions, s * span);
  }

  // Call once per sim step. Captures into the next slot only every `stride` steps.
  capture(positions: Float32Array): void {
    if (!this.enabled) return;
    if (++this.counter < this.stride) return;
    this.counter = 0;
    this.head = (this.head + 1) % TRAIL_SLOTS;
    this.ring.set(positions, this.head * this.n * 3);
  }

  getHead(): number {
    return this.head;
  }
}

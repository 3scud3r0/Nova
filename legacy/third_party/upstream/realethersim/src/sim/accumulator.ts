// Fixed-timestep accumulator (FR-1.3): the simulation advances in fixed DT increments
// independent of the render frame rate, so frame-rate jitter never skews integration accuracy.
export class Accumulator {
  private acc = 0;
  dt: number;
  readonly maxSubsteps: number;

  constructor(dt: number, maxSubsteps = 8) {
    this.dt = dt;
    this.maxSubsteps = maxSubsteps;
  }

  // Advance by `realDelta` seconds, invoking `step` once per fixed DT. Returns substeps run.
  run(realDelta: number, step: () => void): number {
    this.acc += realDelta;
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSubsteps) {
      step();
      this.acc -= this.dt;
      n++;
    }
    // Anti spiral-of-death: if we hit the cap, drop the backlog rather than fall further behind.
    if (n >= this.maxSubsteps) this.acc = 0;
    return n;
  }
}

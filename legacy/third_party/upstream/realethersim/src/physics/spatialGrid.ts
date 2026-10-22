// Uniform spatial-hash neighbour grid (cell list) over a toroidal cube [-half, half]³, built each
// step by counting sort (zero per-step allocation). Cell size is set to the interaction radius, so
// every neighbour within rMax lies in the particle's cell + the 26 adjacent cells. Reused by any
// system with short-range interactions (Particle Life, Boids, SPH, …) to avoid O(n²).
//
// NOTE: callers must keep rMax ≤ 2·half / 3 so gx ≥ 3 and the wrapped 27-cell stencil never
// revisits a cell (no double counting). Cells are addressed (cz*gx+cy)*gx+cx.
export class SpatialGrid {
  gx = 1;
  private cell = 1;
  private readonly half: number;
  private readonly maxGx: number;
  private readonly counts: Int32Array; // reused as the scatter cursor
  readonly cellStart: Int32Array; // length maxGx³+1; cellStart[c]..cellStart[c+1] index `order`
  readonly order: Int32Array; // particle indices sorted by cell

  constructor(n: number, half: number, maxGx = 20) {
    this.half = half;
    this.maxGx = maxGx;
    const maxCells = maxGx * maxGx * maxGx;
    this.counts = new Int32Array(maxCells);
    this.cellStart = new Int32Array(maxCells + 1);
    this.order = new Int32Array(n);
  }

  // Cell coordinate (per axis) for a world value — used by callers to find a particle's cell.
  coord(w: number): number {
    const g = this.gx;
    const c = ((w + this.half) / this.cell) | 0;
    return c < 0 ? 0 : c >= g ? g - 1 : c;
  }

  // Bucket the first `n` particles (positions at state[i*dim + posOff .. +2]) for radius rMax.
  build(state: Float64Array, dim: number, posOff: number, n: number, rMax: number): void {
    const g = Math.max(1, Math.min(this.maxGx, Math.floor((2 * this.half) / rMax)));
    this.gx = g;
    this.cell = (2 * this.half) / g;
    const cells = g * g * g;
    const counts = this.counts;
    const start = this.cellStart;
    const order = this.order;
    const h = this.half;
    const cs = this.cell;

    for (let c = 0; c < cells; c++) counts[c] = 0;
    for (let i = 0; i < n; i++) {
      const o = i * dim + posOff;
      let cx = ((state[o] + h) / cs) | 0; if (cx < 0) cx = 0; else if (cx >= g) cx = g - 1;
      let cy = ((state[o + 1] + h) / cs) | 0; if (cy < 0) cy = 0; else if (cy >= g) cy = g - 1;
      let cz = ((state[o + 2] + h) / cs) | 0; if (cz < 0) cz = 0; else if (cz >= g) cz = g - 1;
      counts[(cz * g + cy) * g + cx]++;
    }
    let acc = 0;
    for (let c = 0; c < cells; c++) {
      start[c] = acc;
      acc += counts[c];
      counts[c] = start[c]; // reuse counts as the running write cursor
    }
    start[cells] = acc;
    for (let i = 0; i < n; i++) {
      const o = i * dim + posOff;
      let cx = ((state[o] + h) / cs) | 0; if (cx < 0) cx = 0; else if (cx >= g) cx = g - 1;
      let cy = ((state[o + 1] + h) / cs) | 0; if (cy < 0) cy = 0; else if (cy >= g) cy = g - 1;
      let cz = ((state[o + 2] + h) / cs) | 0; if (cz < 0) cz = 0; else if (cz >= g) cz = g - 1;
      order[counts[(cz * g + cy) * g + cx]++] = i;
    }
  }
}

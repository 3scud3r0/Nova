import { describe, expect, it } from 'vitest';
import { SpatialGrid } from '../src/physics/spatialGrid';

const HALF = 1.5;
const L = HALF * 2;
const mi = (d: number): number => (d > HALF ? d - L : d < -HALF ? d + L : d); // toroidal min-image

describe('SpatialGrid', () => {
  it('its 27-cell stencil finds exactly the rMax neighbours brute force finds (toroidal)', () => {
    const n = 400;
    const rMax = 0.4; // gx = floor(3/0.4) = 7 ≥ 3
    const DIM = 6;
    let seed = 7;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const st = new Float64Array(n * DIM);
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      st[o] = (rnd() * 2 - 1) * HALF;
      st[o + 1] = (rnd() * 2 - 1) * HALF;
      st[o + 2] = (rnd() * 2 - 1) * HALF;
    }

    const grid = new SpatialGrid(n, HALF);
    grid.build(st, DIM, 0, n, rMax);
    const gx = grid.gx;
    const start = grid.cellStart;
    const order = grid.order;
    const r2max = rMax * rMax;

    for (const i of [0, 97, 199, 300, 399]) {
      const oi = i * DIM;
      const xi = st[oi];
      const yi = st[oi + 1];
      const zi = st[oi + 2];

      const brute: number[] = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const oj = j * DIM;
        const dx = mi(st[oj] - xi);
        const dy = mi(st[oj + 1] - yi);
        const dz = mi(st[oj + 2] - zi);
        if (dx * dx + dy * dy + dz * dz < r2max) brute.push(j);
      }

      const found: number[] = [];
      const cx = grid.coord(xi);
      const cy = grid.coord(yi);
      const cz = grid.coord(zi);
      for (let dz = -1; dz <= 1; dz++) {
        const ncz = (cz + dz + gx) % gx;
        for (let dy = -1; dy <= 1; dy++) {
          const ncy = (cy + dy + gx) % gx;
          for (let dx = -1; dx <= 1; dx++) {
            const ncx = (cx + dx + gx) % gx;
            const c = (ncz * gx + ncy) * gx + ncx;
            for (let k = start[c]; k < start[c + 1]; k++) {
              const j = order[k];
              if (j === i) continue;
              const oj = j * DIM;
              const ax = mi(st[oj] - xi);
              const ay = mi(st[oj + 1] - yi);
              const az = mi(st[oj + 2] - zi);
              if (ax * ax + ay * ay + az * az < r2max) found.push(j);
            }
          }
        }
      }

      expect(found.sort((a, b) => a - b)).toEqual(brute.sort((a, b) => a - b));
    }
  });

  it('buckets every particle exactly once', () => {
    const n = 250;
    const DIM = 3;
    let seed = 3;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const st = new Float64Array(n * DIM);
    for (let i = 0; i < n * DIM; i++) st[i] = (rnd() * 2 - 1) * HALF;
    const grid = new SpatialGrid(n, HALF);
    grid.build(st, DIM, 0, n, 0.5);
    expect(new Set(grid.order).size).toBe(n);
  });
});

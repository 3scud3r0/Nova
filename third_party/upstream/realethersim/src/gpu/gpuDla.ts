import * as THREE from 'three';
import { attributeArray, float, Fn, hash, If, instanceIndex, int, mix, step, uniform, vec2, vec3, vertexIndex } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';
import type { GpuFactory, GpuNode } from './types';

// GPU diffusion-limited aggregation. Walkers (an agent buffer, each carrying an RNG seed) random-walk
// a toroidal grid; when adjacent to the cluster they freeze, writing 1 into the grid (idempotent, so
// no atomics needed). The grid renders as a lattice with stuck cells lifted into view (empty cells
// parked below), coloured by radius (core → tips). From one seed it grows a branching dendrite.
const EXTENT = 3;
const TAU = Math.PI * 2;
const LAUNCH = 0.46; // walkers respawn within this fraction of W around centre (near the frontier)
const HIDDEN_Y = -30;

export const gpuDla: GpuFactory = (count, _dt, params) => {
  const w = Math.max(64, Math.round(Math.sqrt(count)));
  const n = w * w;
  const M = Math.max(1000, Math.round(params?.walkers ?? 8000));
  const center = (w >> 1) * w + (w >> 1);
  const cell = EXTENT / (w - 1);
  const half = EXTENT / 2;

  const grid: GpuNode = attributeArray(n, 'float'); // 0 empty, 1 stuck
  const walk: GpuNode = attributeArray(M, 'vec3'); // x, y (grid coords), rng seed
  const uStick: GpuNode = uniform(params?.stickiness ?? 1);

  // Single init over max(n, M): seed the grid (centre cell stuck) and the walkers (random cells),
  // each guarded to its buffer size.
  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    If(int(i).lessThan(n), () => {
      grid.element(i).assign(int(i).equal(int(center)).select(float(1), float(0)));
    });
    If(int(i).lessThan(M), () => {
      walk.element(i).assign(vec3(hash(i.mul(3)).mul(w), hash(i.mul(3).add(1)).mul(w), hash(i.mul(3).add(2))));
    });
  })() as GpuNode).compute(Math.max(n, M));

  const stepWalk: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const p = walk.element(i).toVar();
    const wx = int(p.x);
    const wy = int(p.y);
    const ci = wy.mul(w).add(wx);

    // Per-step RNG from the stored seed (+ id), so it evolves even when the walker doesn't move.
    const s0 = int(p.z.mul(2147483)).add(int(i).mul(2654435));
    const r1: GpuNode = hash(s0); // stick roll
    const r2: GpuNode = hash(s0.add(1)); // direction
    const rx: GpuNode = hash(s0.add(2)); // respawn x
    const ry: GpuNode = hash(s0.add(3)); // respawn y

    // 8-neighbour adjacency to the cluster (toroidal).
    const xl = wx.add(w - 1).mod(w);
    const xr = wx.add(1).mod(w);
    const yu = wy.add(w - 1).mod(w).mul(w);
    const yd = wy.add(1).mod(w).mul(w);
    const yc = wy.mul(w);
    const adj: GpuNode = grid
      .element(yc.add(xl)).add(grid.element(yc.add(xr)))
      .add(grid.element(yu.add(wx))).add(grid.element(yd.add(wx)))
      .add(grid.element(yu.add(xl))).add(grid.element(yu.add(xr)))
      .add(grid.element(yd.add(xl))).add(grid.element(yd.add(xr)));

    const onCluster: GpuNode = step(0.5, grid.element(ci)); // own cell already stuck?
    const canStick: GpuNode = step(0.5, adj).mul(step(r1, uStick)).mul(onCluster.oneMinus());

    // Freeze: mark this cell stuck (idempotent write).
    If(canStick.greaterThan(0.5), () => {
      grid.element(ci).assign(1);
    });

    // 4-neighbour random walk.
    const d = int(r2.mul(4));
    const dx: GpuNode = float(d.equal(0)).sub(float(d.equal(1)));
    const dy: GpuNode = float(d.equal(2)).sub(float(d.equal(3)));
    const movedX: GpuNode = p.x.add(dx).add(w).mod(w);
    const movedY: GpuNode = p.y.add(dy).add(w).mod(w);

    // Respawn within a disk around centre (near the frontier) when stuck this step or already on
    // the cluster — fast, sparse arrival → branching dendrites rather than a solid blob.
    const respawn: GpuNode = canStick.max(onCluster);
    const ang: GpuNode = rx.mul(TAU);
    const rrad: GpuNode = ry.sqrt().mul(LAUNCH * w);
    const rspX: GpuNode = float(w / 2).add(ang.cos().mul(rrad)).add(w).mod(w);
    const rspY: GpuNode = float(w / 2).add(ang.sin().mul(rrad)).add(w).mod(w);
    const nxp: GpuNode = mix(movedX, rspX, respawn);
    const nyp: GpuNode = mix(movedY, rspY, respawn);
    walk.element(i).assign(vec3(nxp, nyp, r1));
  })() as GpuNode).compute(M);

  // Render the grid lattice: stuck cells lifted to y=0, empty cells hidden below; colour by radius.
  const vi = int(vertexIndex);
  const gx: GpuNode = float(vi.mod(w));
  const gy: GpuNode = float(vi.div(w));
  const fx: GpuNode = gx.mul(cell).sub(half);
  const fz: GpuNode = gy.mul(cell).sub(half);
  const stuck: GpuNode = step(0.5, grid.toAttribute());
  const rad: GpuNode = vec2(gx.sub(w / 2), gy.sub(w / 2)).length().div(w * 0.5).clamp(0, 1);

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.95;
  material.positionNode = vec3(fx, mix(float(HIDDEN_Y), float(0), stuck), fz);
  material.colorNode = mix(vec3(1.0, 0.6, 0.2), vec3(0.3, 0.7, 1.0), rad).mul(stuck);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [stepWalk],
    substeps: 4, // more walk steps/frame → faster visible growth
    particleCount: n,
    pointSize: 0.02,
    setParams(p: Record<string, number>): void {
      if ('stickiness' in p) uStick.value = p.stickiness;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
};

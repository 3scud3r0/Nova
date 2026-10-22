import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  atomicAdd,
  atomicLoad,
  atomicStore,
  attributeArray,
  float,
  Fn,
  hash,
  instanceIndex,
  int,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { GpuFactory, GpuNode, GpuSim } from './types';

// GPU twin of the CPU Kuramoto model. The only non-local term is the global mean field, computed
// with a fixed-point atomic reduction (WGSL atomics are int-only): every oscillator atomicAdds its
// cos/sin (×SCALE) into a 2-int accumulator, then each integrates against the shared mean. No
// all-pairs loop. State = (theta, g) per oscillator; position/colour derive from it in the material.
const TWO_PI = Math.PI * 2;
const R = 1.3; // cylinder radius
const HV = 0.45; // natural-frequency → height scale
// Fixed-point scale for the atomic sum. N·SCALE must stay within i32 (±2.1e9): 120k·8192 ≈ 9.8e8. ✓
const SCALE = 8192;
const KEYS = ['coupling', 'omega0', 'spread'];
const DEFAULTS: Record<string, number> = { coupling: 1.8, omega0: 1.0, spread: 0.6 };

export const gpuKuramoto: GpuFactory = (count, dt0, params): GpuSim => {
  const state: GpuNode = attributeArray(count, 'vec2'); // (theta, g) per oscillator
  const accum: GpuNode = attributeArray(2, 'int').toAtomic(); // [Σcosθ·SCALE, Σsinθ·SCALE]

  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(params[k] ?? DEFAULTS[k]);
  const dt = uniform(dt0);

  // --- init: random phase + a fixed standard-gaussian frequency seed (Box–Muller). ---
  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const r0 = hash(i.mul(3));
    const u1 = hash(i.mul(3).add(1)).max(1e-6);
    const u2 = hash(i.mul(3).add(2));
    const g = u1.log().mul(-2).sqrt().mul(u2.mul(TWO_PI).cos());
    state.element(i).assign(vec2(r0.mul(TWO_PI), g));
  })() as GpuNode).compute(count);

  // --- pass 1: clear the 2-int mean-field accumulator (must precede each reduction). ---
  const clearAccum: GpuNode = (Fn(() => {
    atomicStore(accum.element(instanceIndex), int(0));
  })() as GpuNode).compute(2);

  // --- pass 2: scatter each oscillator's (cosθ, sinθ) into the accumulator (fixed-point). ---
  const reduce: GpuNode = (Fn(() => {
    const th = state.element(instanceIndex).x;
    atomicAdd(accum.element(int(0)), int(th.cos().mul(SCALE).round()));
    atomicAdd(accum.element(int(1)), int(th.sin().mul(SCALE).round()));
  })() as GpuNode).compute(count);

  // --- pass 3: each oscillator integrates against the shared mean field. ---
  const integrate: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const s = state.element(i).toVar();
    const th = s.x.toVar();
    const g = s.y;
    const cAcc: GpuNode = atomicLoad(accum.element(int(0)));
    const sAcc: GpuNode = atomicLoad(accum.element(int(1)));
    const mc = float(cAcc).div(SCALE).div(count);
    const ms = float(sAcc).div(SCALE).div(count);
    const omega = u.omega0.add(u.spread.mul(g));
    const dtheta = omega.add(u.coupling.mul(ms.mul(th.cos()).sub(mc.mul(th.sin()))));
    const nt = th.add(dtheta.mul(dt)).toVar();
    nt.assign(nt.mod(TWO_PI).add(TWO_PI).mod(TWO_PI)); // wrap into [0, 2π)
    state.element(i).assign(vec2(nt, g));
  })() as GpuNode).compute(count);

  // --- render: cylinder position + cosine palette by natural frequency, derived from state. ---
  const st: GpuNode = state.toAttribute();
  const th: GpuNode = st.x;
  const g: GpuNode = st.y;

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.9;
  material.positionNode = vec3(th.cos().mul(R), g.mul(HV), th.sin().mul(R));
  const t = g.mul(0.16).add(0.5);
  material.colorNode = vec3(
    t.mul(TWO_PI).cos().mul(0.5).add(0.5),
    t.add(0.18).mul(TWO_PI).cos().mul(0.5).add(0.5),
    t.add(0.38).mul(TWO_PI).cos().mul(0.5).add(0.5),
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [clearAccum, reduce, integrate],
    substeps: 2,
    particleCount: count,
    pointSize: 0.012,
    setParams(p: Record<string, number>): void {
      for (const k of KEYS) if (k in p) u[k].value = p[k];
      if ('dt' in p) dt.value = p.dt;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
};

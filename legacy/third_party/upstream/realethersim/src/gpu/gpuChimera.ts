import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  atomicAdd,
  atomicLoad,
  atomicStore,
  attributeArray,
  exp,
  float,
  Fn,
  hash,
  instanceIndex,
  int,
  uniform,
  vec3,
  vertexIndex,
} from 'three/tsl';
import type { GpuFactory, GpuNode, GpuSim } from './types';

// GPU twin of the CPU chimera model. The nonlocal cosine-kernel coupling decomposes into SIX global
// sums, so the per-step cost is O(N) with a fixed-point atomic reduction (no all-pairs loop):
//   Σcosθ, Σsinθ, Σcos·x cosθ, Σcos·x sinθ, Σsin·x cosθ, Σsin·x sinθ.
// Ring position x_i = 2π·i/N is implicit in the index; state stores only the phase θ_i.
const TWO_PI = Math.PI * 2;
const R = 1.3; // crown radius
const HV = 0.42; // phase → height scale
// Fixed-point scale; each summand ∈ [−1,1] so |sum| ≤ N. 120k·8192 ≈ 9.8e8 stays within i32. ✓
const SCALE = 8192;
const KEYS = ['alpha', 'kernelA', 'coupling'];
const DEFAULTS: Record<string, number> = { alpha: 1.46, kernelA: 0.9, coupling: 1.0 };

export const gpuChimera: GpuFactory = (count, dt0, params): GpuSim => {
  const state: GpuNode = attributeArray(count, 'float'); // phase θ_i
  const accum: GpuNode = attributeArray(6, 'int').toAtomic(); // the six decomposed sums (×SCALE)

  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(params[k] ?? DEFAULTS[k]);
  const dt = uniform(dt0);

  const ringX = (idx: GpuNode): GpuNode => float(idx).div(count).mul(TWO_PI); // ring position

  // --- init: coherent everywhere except a Gaussian-localized random perturbation (nucleates the
  //     incoherent arc), matching the CPU. ---
  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const x = ringX(i);
    const d = x.sub(Math.PI);
    const th = float(6).mul(hash(i).sub(0.5)).mul(exp(d.mul(d).mul(-0.76)));
    state.element(i).assign(th);
  })() as GpuNode).compute(count);

  // --- pass 1: clear the 6-int accumulator. ---
  const clearAccum: GpuNode = (Fn(() => {
    atomicStore(accum.element(instanceIndex), int(0));
  })() as GpuNode).compute(6);

  // --- pass 2: scatter each oscillator's six contributions (fixed-point). ---
  const reduce: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const x = ringX(i);
    const cx = x.cos();
    const sx = x.sin();
    const th = state.element(i);
    const cj = th.cos();
    const sj = th.sin();
    atomicAdd(accum.element(int(0)), int(cj.mul(SCALE).round()));
    atomicAdd(accum.element(int(1)), int(sj.mul(SCALE).round()));
    atomicAdd(accum.element(int(2)), int(cx.mul(cj).mul(SCALE).round()));
    atomicAdd(accum.element(int(3)), int(cx.mul(sj).mul(SCALE).round()));
    atomicAdd(accum.element(int(4)), int(sx.mul(cj).mul(SCALE).round()));
    atomicAdd(accum.element(int(5)), int(sx.mul(sj).mul(SCALE).round()));
  })() as GpuNode).compute(count);

  // --- pass 3: each oscillator integrates against the six shared sums. ---
  const mean = (k: number): GpuNode => {
    const a: GpuNode = atomicLoad(accum.element(int(k)));
    return float(a).div(SCALE).div(count);
  };
  const integrate: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const x = ringX(i);
    const cxi = x.cos();
    const sxi = x.sin();
    const th = state.element(i).toVar();
    const A = u.kernelA;
    const termC = mean(0).add(A.mul(cxi).mul(mean(2))).add(A.mul(sxi).mul(mean(4)));
    const termS = mean(1).add(A.mul(cxi).mul(mean(3))).add(A.mul(sxi).mul(mean(5)));
    const ci = th.add(u.alpha).sin().mul(termC).sub(th.add(u.alpha).cos().mul(termS));
    const nt = th.sub(u.coupling.mul(ci).mul(dt)).toVar(); // ω = 0
    nt.assign(nt.mod(TWO_PI).add(TWO_PI).mod(TWO_PI));
    state.element(i).assign(nt);
  })() as GpuNode).compute(count);

  // --- render: ring crown (angle = position, height = sinθ), coloured by phase. ---
  const th: GpuNode = state.toAttribute();
  const xi = ringX(vertexIndex);

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.9;
  material.positionNode = vec3(xi.cos().mul(R), th.sin().mul(HV), xi.sin().mul(R));
  const t = th.mul(0.159).add(0.5); // phase → cosine palette
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

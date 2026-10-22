import * as THREE from 'three';
import { attributeArray, float, Fn, instanceIndex, int, Loop, step, uniform, vec3, vertexIndex } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';
import type { GpuFactory, GpuNode } from './types';
import { mulberry32 } from '../state/rng';

// GPU Lenia: continuous "smooth life" CA. A compute pass convolves the field with a ring kernel
// (weight computed inline per tap), applies the Gaussian growth G(U) = 2·exp(-((U-μ)/σ)²/2) - 1,
// clamps to [0,1], and ping-pongs A↔B. Seeded with smooth blobs (Lenia needs structure larger than
// the kernel). Rendered as a displaced point grid coloured by concentration, like the Field systems.
const EXTENT = 3;
const KERNEL_PEAK = 0.5;
const KERNEL_WIDTH = 0.15;
const KEYS = ['mu', 'sigma', 'rate'];
const DEFAULTS: Record<string, number> = { mu: 0.15, sigma: 0.017, rate: 0.12, radius: 13 };

export const gpuLenia: GpuFactory = (count, _dt, params) => {
  const w = Math.max(64, Math.round(Math.sqrt(count)));
  const n = w * w;
  const R = Math.max(3, Math.min(Math.round(params?.radius ?? DEFAULTS.radius), Math.floor((w - 1) / 2)));
  const D = 2 * R + 1;
  const invKw = 1 / (2 * KERNEL_WIDTH * KERNEL_WIDTH);

  const A: GpuNode = attributeArray(n, 'float');
  const B: GpuNode = attributeArray(n, 'float');
  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(DEFAULTS[k]);

  // Bake ~14 blob centres (seeded) for the smooth initial seed.
  const rng = mulberry32(1);
  const blobs: { x: number; y: number; inv2r2: number; amp: number }[] = [];
  for (let b = 0; b < 14; b++) {
    const r = R * (0.8 + 0.8 * rng());
    blobs.push({ x: (0.2 + 0.6 * rng()) * w, y: (0.2 + 0.6 * rng()) * w, inv2r2: 1 / (0.5 * r * r), amp: 0.5 + 0.5 * rng() });
  }

  const init: GpuNode = (Fn(() => {
    const i = int(instanceIndex);
    const x: GpuNode = float(i.mod(w));
    const y: GpuNode = float(i.div(w));
    const v = float(0).toVar();
    for (const bl of blobs) {
      const dx = x.sub(bl.x);
      const dy = y.sub(bl.y);
      const d2 = dx.mul(dx).add(dy.mul(dy));
      v.assign(v.max(float(bl.amp).mul(d2.mul(-bl.inv2r2).exp())));
    }
    A.element(instanceIndex).assign(v.min(1));
    B.element(instanceIndex).assign(0);
  })() as GpuNode).compute(n);

  const react: GpuNode = (Fn(() => {
    const i = int(instanceIndex);
    const x = i.mod(w);
    const y = i.div(w);
    const acc = float(0).toVar();
    const wsum = float(0).toVar();
    Loop(D * D, ({ i: t }: { i: GpuNode }) => {
      const tt = int(t);
      const dx = tt.mod(D).sub(R);
      const dy = tt.div(D).sub(R);
      const rr: GpuNode = float(dx.mul(dx).add(dy.mul(dy))).sqrt().div(R);
      const mask: GpuNode = step(1e-4, rr).mul(step(rr, 1)); // 0 < rr ≤ 1 (ring; excludes centre & corners)
      const kwt: GpuNode = mask.mul(rr.sub(KERNEL_PEAK).mul(rr.sub(KERNEL_PEAK)).mul(-invKw).exp());
      const xx = x.add(dx).add(w).mod(w);
      const yy = y.add(dy).add(w).mod(w);
      acc.addAssign(kwt.mul(A.element(yy.mul(w).add(xx))));
      wsum.addAssign(kwt);
    });
    const U: GpuNode = acc.div(wsum.max(1e-6));
    const d: GpuNode = U.sub(u.mu).div(u.sigma);
    const G: GpuNode = float(2).mul(d.mul(d).mul(-0.5).exp()).sub(1);
    B.element(instanceIndex).assign(A.element(instanceIndex).add(u.rate.mul(G)).clamp(0, 1));
  })() as GpuNode).compute(n);

  const copy: GpuNode = (Fn(() => {
    A.element(instanceIndex).assign(B.element(instanceIndex));
  })() as GpuNode).compute(n);

  const vi = int(vertexIndex);
  const cell = EXTENT / (w - 1);
  const half = EXTENT / 2;
  const fx: GpuNode = float(vi.mod(w)).mul(cell).sub(half);
  const fz: GpuNode = float(vi.div(w)).mul(cell).sub(half);
  const v: GpuNode = A.toAttribute();

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.92;
  material.positionNode = vec3(fx, v.mul(0.5).sub(0.15), fz);
  material.colorNode = vec3(v.mul(0.5).add(0.1), v.mul(0.75).add(0.2), v.mul(0.35).add(0.25));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [react, copy],
    substeps: 1,
    particleCount: n,
    pointSize: 0.02,
    setParams(p: Record<string, number>): void {
      for (const k of KEYS) if (k in p) u[k].value = p[k];
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
};

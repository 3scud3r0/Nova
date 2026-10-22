import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attributeArray, color, float, Fn, hash, instanceIndex, int, mix, step, uniform, vec3, vertexIndex } from 'three/tsl';
import type { GpuFactory, GpuNode } from './types';

// GPU quantum-foam: Gray-Scott reaction-diffusion on a toroidal W×W grid. Two passes per step —
// react reads buffer A and writes B (9-point Laplacian, integer-wrapped neighbours), then a copy
// pass moves B→A so the render attribute always reads the canonical A. The point grid is displaced
// in Y by the V concentration. Particle count selects the grid resolution (W = round(√count)).
const EXTENT = 3;
const KEYS = ['feed', 'kill', 'diffU', 'diffV', 'relief'];
const DEFAULTS: Record<string, number> = { feed: 0.037, kill: 0.06, diffU: 0.16, diffV: 0.08, relief: 1.8 };

export const gpuFoam: GpuFactory = (count) => {
  const w = Math.max(32, Math.round(Math.sqrt(count)));
  const n = w * w;

  const uA: GpuNode = attributeArray(n, 'float');
  const vA: GpuNode = attributeArray(n, 'float');
  const uB: GpuNode = attributeArray(n, 'float');
  const vB: GpuNode = attributeArray(n, 'float');
  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(DEFAULTS[k]);

  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    uA.element(i).assign(1);
    vA.element(i).assign(step(0.92, hash(i)).mul(0.5)); // ~8% of cells seeded with V=0.5
    uB.element(i).assign(1);
    vB.element(i).assign(0);
  })() as GpuNode).compute(n);

  // Laplacian neighbour indices with toroidal wrap.
  const react: GpuNode = (Fn(() => {
    const i = int(instanceIndex);
    const x = i.mod(w);
    const y = i.div(w);
    const xl = x.add(w - 1).mod(w);
    const xr = x.add(1).mod(w);
    const yu = y.add(w - 1).mod(w).mul(w);
    const yd = y.add(1).mod(w).mul(w);
    const yc = y.mul(w);
    const lap = (B: GpuNode, c: GpuNode): GpuNode =>
      B.element(yc.add(xl))
        .add(B.element(yc.add(xr)))
        .add(B.element(yu.add(x)))
        .add(B.element(yd.add(x)))
        .mul(0.2)
        .add(
          B.element(yu.add(xl))
            .add(B.element(yu.add(xr)))
            .add(B.element(yd.add(xl)))
            .add(B.element(yd.add(xr)))
            .mul(0.05),
        )
        .sub(c);
    const uc = uA.element(i).toVar();
    const vc = vA.element(i).toVar();
    const uvv = uc.mul(vc).mul(vc);
    uB.element(i).assign(uc.add(u.diffU.mul(lap(uA, uc)).sub(uvv).add(u.feed.mul(float(1).sub(uc)))));
    vB.element(i).assign(vc.add(u.diffV.mul(lap(vA, vc)).add(uvv).sub(u.feed.add(u.kill).mul(vc))));
  })() as GpuNode).compute(n);

  const copy: GpuNode = (Fn(() => {
    const i = instanceIndex;
    uA.element(i).assign(uB.element(i));
    vA.element(i).assign(vB.element(i));
  })() as GpuNode).compute(n);

  const vi = int(vertexIndex);
  const cell = EXTENT / (w - 1);
  const half = EXTENT / 2;
  const fx = float(vi.mod(w)).mul(cell).sub(half);
  const fz = float(vi.div(w)).mul(cell).sub(half);
  const vv: GpuNode = vA.toAttribute();

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.9;
  material.positionNode = vec3(fx, vv.mul(u.relief).sub(0.3), fz);
  material.colorNode = mix(color(0x0a2a3a), color(0x5af0c8), vv.mul(3).clamp(0, 1));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [react, copy],
    substeps: 2,
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

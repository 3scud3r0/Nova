import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attributeArray, color, float, Fn, hash, instanceIndex, int, mix, step, uniform, vec3, vertexIndex } from 'three/tsl';
import type { GpuFactory, GpuNode } from './types';

// GPU Gray-Scott reaction-diffusion: a double-buffered W×W grid of (U,V) concentrations in storage
// buffers, updated by a TSL compute kernel (9-point Laplacian by index arithmetic with toroidal
// wrap), rendered straight from the buffer as a displaced point grid (V → relief + colour). TSL twin
// of the CPU grayScottField formulas.
const EXTENT = 3;
const KEYS = ['feed', 'kill', 'diffU', 'diffV', 'relief'];
const DEFAULTS: Record<string, number> = { feed: 0.0367, kill: 0.0649, diffU: 0.16, diffV: 0.08, relief: 2.2 };

export const gpuGrayScottField: GpuFactory = (count, _dt, _params) => {
  const w = Math.max(32, Math.round(Math.sqrt(count)));
  const n = w * w;

  const uA: GpuNode = attributeArray(n, 'float');
  const vA: GpuNode = attributeArray(n, 'float');
  const uB: GpuNode = attributeArray(n, 'float');
  const vB: GpuNode = attributeArray(n, 'float');

  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(DEFAULTS[k]);

  // U=1, V=0 everywhere; ~8% of cells seeded (U=0.5, V=0.5) to nucleate the pattern.
  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const seeded = step(0.92, hash(i)).mul(0.5);
    uA.element(i).assign(float(1).sub(seeded));
    vA.element(i).assign(seeded);
    uB.element(i).assign(1);
    vB.element(i).assign(0);
  })() as GpuNode).compute(n);

  // 9-point Laplacian on the toroidal grid by index arithmetic.
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
      B.element(yc.add(xl)).add(B.element(yc.add(xr))).add(B.element(yu.add(x))).add(B.element(yd.add(x))).mul(0.2)
        .add(B.element(yu.add(xl)).add(B.element(yu.add(xr))).add(B.element(yd.add(xl))).add(B.element(yd.add(xr))).mul(0.05))
        .sub(c);
    const uc = uA.element(i).toVar();
    const vc = vA.element(i).toVar();
    const uvv = uc.mul(vc).mul(vc);
    uB.element(i).assign(uc.add(u.diffU.mul(lap(uA, uc)).sub(uvv).add(u.feed.mul(float(1).sub(uc)))));
    vB.element(i).assign(vc.add(u.diffV.mul(lap(vA, vc)).add(uvv).sub(u.feed.add(u.kill).mul(vc))));
  })() as GpuNode).compute(n);

  // copy B → A for the next iteration (render samples canonical A)
  const copy: GpuNode = (Fn(() => {
    const i = instanceIndex;
    uA.element(i).assign(uB.element(i));
    vA.element(i).assign(vB.element(i));
  })() as GpuNode).compute(n);

  // render: grid position from vertexIndex, V drives height + a teal→white colour ramp
  const vi = int(vertexIndex);
  const cell = EXTENT / (w - 1);
  const half = EXTENT / 2;
  const fx: GpuNode = float(vi.mod(w)).mul(cell).sub(half);
  const fz: GpuNode = float(vi.div(w)).mul(cell).sub(half);
  const vv: GpuNode = vA.toAttribute();
  const height: GpuNode = vv.mul(u.relief).sub(0.4);
  const base = mix(color(0x0a2a3a), color(0x5af0c8), vv.mul(2.4).clamp(0, 1));
  const colorNode = mix(base, color(0xffffff), vv.mul(1.4).clamp(0, 1));

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.9;
  material.positionNode = vec3(fx, height, fz);
  material.colorNode = colorNode;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [react, copy],
    substeps: 4,
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

import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attributeArray, color, Fn, hash, instanceIndex, Loop, mix, uniform, vec3 } from 'three/tsl';
import type { GpuFactory, GpuNode } from './types';

// GPU N-body: direct O(n²) Plummer-softened gravity. Two compute passes per step so reads and
// writes never race — pass 1 computes acceleration (looping all particles, reading positions),
// pass 2 integrates with semi-implicit Euler. The CPU path uses velocity-Verlet + clusters; the
// GPU path uses a single seeded cloud and a central "cross-scale" pull toward the origin (avoids a
// COM reduction). Counts stay modest (all-pairs), but the GPU absorbs them comfortably.
const TWO_PI = Math.PI * 2;
const KEYS = ['G', 'softening', 'spin', 'coupling'];
const DEFAULTS: Record<string, number> = { G: 0.6, softening: 0.1, spin: 0.5, coupling: 0.3 };

export const gpuNbody: GpuFactory = (count, dt0) => {
  const pos: GpuNode = attributeArray(count, 'vec3');
  const vel: GpuNode = attributeArray(count, 'vec3');
  const acc: GpuNode = attributeArray(count, 'vec3');
  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(DEFAULTS[k]);
  const uDt: GpuNode = uniform(dt0);

  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const r1 = hash(i.mul(6));
    const r2 = hash(i.mul(6).add(1));
    const r3 = hash(i.mul(6).add(2));
    const radius = r1.pow(1 / 3); // uniform in a unit ball
    const theta = r2.mul(TWO_PI);
    const ct = r3.mul(2).sub(1); // cos(phi)
    const st = ct.mul(ct).oneMinus().sqrt(); // sin(phi)
    const p = vec3(st.mul(theta.cos()), st.mul(theta.sin()), ct).mul(radius);
    pos.element(i).assign(p);
    vel.element(i).assign(vec3(0, 1, 0).cross(p).mul(u.spin)); // tangential spin about +y
    acc.element(i).assign(vec3(0));
  })() as GpuNode).compute(count);

  const invN = 1 / count; // normalize mass by 1/N so total self-gravity is O(G), not O(G·N)
  const accelPass: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const pi = pos.element(i).toVar();
    const eps2 = u.softening.mul(u.softening);
    const gm = u.G.mul(invN);
    const a = vec3(0).toVar();
    Loop(count, ({ i: j }: { i: GpuNode }) => {
      const d = pos.element(j).sub(pi);
      const r2 = d.dot(d).add(eps2);
      const inv = r2.mul(r2.sqrt()).reciprocal(); // (r²+ε²)^(-3/2); self term is 0 (d=0)
      a.addAssign(d.mul(gm.mul(inv)));
    });
    a.addAssign(pi.negate().mul(u.coupling)); // cross-scale pull toward origin keeps it bound
    acc.element(i).assign(a);
  })() as GpuNode).compute(count);

  const integratePass: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const v = vel.element(i);
    v.addAssign(acc.element(i).mul(uDt)); // semi-implicit Euler
    pos.element(i).addAssign(v.mul(uDt));
  })() as GpuNode).compute(count);

  const attr: GpuNode = pos.toAttribute();
  const speed: GpuNode = vel.toAttribute().length();
  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.85;
  material.positionNode = attr;
  material.colorNode = mix(color(0x2a6cff), color(0xffffff), speed.mul(0.6).clamp(0, 1));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [accelPass, integratePass],
    substeps: 1,
    particleCount: count,
    pointSize: 0.02,
    setParams(p: Record<string, number>): void {
      for (const k of KEYS) if (k in p) u[k].value = p[k];
      if ('dt' in p) uDt.value = p.dt;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
};

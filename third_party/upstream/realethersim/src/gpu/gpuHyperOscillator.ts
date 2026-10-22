import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attributeArray, color, float, Fn, hash, instanceIndex, mix, uniform, vec3, vec4 } from 'three/tsl';
import { E, FEIGENBAUM_DELTA, PHI, PI } from '../physics/constants';
import type { GpuFactory, GpuNode } from './types';

// GPU hyper-oscillator: 4 nested phase angles per particle in a vec4 storage buffer. The angle
// dynamics (parent-coupled, irrational-frequency) integrate with RK4 in a compute kernel; the 3D
// position is the nested epicycle sum, computed per-vertex in positionNode. GPU mode is fixed at
// 4 levels (the vec4); the CPU path supports the variable `levels` param.
const TWO_PI = Math.PI * 2;
const RENDER_SCALE = 0.8;
const KEYS = ['omega0', 'freqScale', 'ampScale', 'eps'];
const DEFAULTS: Record<string, number> = { omega0: 1, freqScale: 1.2, ampScale: 0.6, eps: 0.35 };

export const gpuHyperOscillator: GpuFactory = (count, dt0) => {
  const ang: GpuNode = attributeArray(count, 'vec4');
  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(DEFAULTS[k]);
  const uDt: GpuNode = uniform(dt0);

  // dθ_k/dt = ω_k (1 + ε·sin(parent)); ω_k = ω₀·freqScale^k·driver_k; parent of level 0 is 0.
  const deriv = (a: GpuNode): GpuNode => {
    const fs = u.freqScale;
    const fs2 = fs.mul(fs);
    const fs3 = fs2.mul(fs);
    const w0 = u.omega0;
    const eps = u.eps;
    return vec4(
      w0.mul(PHI),
      w0.mul(fs).mul(PI).mul(float(1).add(eps.mul(a.x.sin()))),
      w0.mul(fs2).mul(E).mul(float(1).add(eps.mul(a.y.sin()))),
      w0.mul(fs3).mul(FEIGENBAUM_DELTA).mul(float(1).add(eps.mul(a.z.sin()))),
    );
  };

  const init: GpuNode = (Fn(() => {
    const a = ang.element(instanceIndex);
    a.assign(
      vec4(
        hash(instanceIndex.mul(4)).mul(TWO_PI),
        hash(instanceIndex.mul(4).add(1)).mul(TWO_PI),
        hash(instanceIndex.mul(4).add(2)).mul(TWO_PI),
        hash(instanceIndex.mul(4).add(3)).mul(TWO_PI),
      ),
    );
  })() as GpuNode).compute(count);

  const step: GpuNode = (Fn(() => {
    const a = ang.element(instanceIndex);
    const a0 = a.toVar();
    const k1 = deriv(a0).toVar();
    const k2 = deriv(a0.add(k1.mul(uDt.mul(0.5)))).toVar();
    const k3 = deriv(a0.add(k2.mul(uDt.mul(0.5)))).toVar();
    const k4 = deriv(a0.add(k3.mul(uDt))).toVar();
    a.assign(a0.add(k1.add(k2.mul(2)).add(k3.mul(2)).add(k4).mul(uDt.div(6))));
  })() as GpuNode).compute(count);

  const a: GpuNode = ang.toAttribute();
  const A1 = u.ampScale;
  const A2 = u.ampScale.mul(u.ampScale);
  const A3 = A2.mul(u.ampScale);
  const x = a.x.cos().add(a.y.cos().mul(A1)).add(a.z.cos().mul(A2)).add(a.w.cos().mul(A3));
  const y = a.x.sin().add(a.y.sin().mul(A1)).add(a.z.sin().mul(A2)).add(a.w.sin().mul(A3));
  const z = a.x.sin().add(a.y.sub(a.x).sin().mul(A1)).add(a.z.sub(a.y).sin().mul(A2)).add(a.w.sub(a.z).sin().mul(A3));

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.8;
  material.positionNode = vec3(x, y, z).mul(RENDER_SCALE);
  material.colorNode = mix(color(0x4ad6c8), color(0xff8a4a), x.mul(0.3).add(0.5).clamp(0, 1));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [step],
    substeps: 3,
    particleCount: count,
    pointSize: 0.012,
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

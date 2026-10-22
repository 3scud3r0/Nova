import * as THREE from 'three';
import { attributeArray, float, Fn, hash, instanceIndex, int, mix, step, uniform, vec3 } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';
import type { GpuFactory, GpuNode, GpuSim } from './types';
import { IFS_SYSTEMS } from '../archetypes/fractalIFS';
import { hslToRgb } from '../core/color';

// GPU chaos game: each point picks one affine map per dispatch (branchless weighted selection from a
// per-step position-derived hash) and applies it, condensing onto the IFS attractor. Colour is a
// height gradient in the system's hue (computed in the colorNode from position, like gpuMap).
function buildGpuIfs(id: string, count: number): GpuSim {
  const sys = IFS_SYSTEMS[id];
  const maps = sys.maps;
  const K = maps.length;
  const [cx, cy] = sys.center;
  const yrange = sys.bounds.y[1] - sys.bounds.y[0];

  // Two endpoint colours around the system hue for a vertical gradient.
  const c0 = new Float32Array(3);
  const c1 = new Float32Array(3);
  hslToRgb(sys.hue % 1, 0.75, 0.45, c0, 0);
  hslToRgb((sys.hue + 0.1) % 1, 0.8, 0.72, c1, 0);

  const pos: GpuNode = attributeArray(count, 'vec3');
  const uWarp: GpuNode = uniform(0);

  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const x = hash(i.mul(2)).sub(0.5).mul(0.1);
    const y = hash(i.mul(2).add(1)).sub(0.5).mul(0.1).add(cy);
    pos.element(i).assign(vec3(x, y, 0));
  })() as GpuNode).compute(count);

  const iterate: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const px = pos.element(i).x.toVar();
    const py = pos.element(i).y.toVar();
    // Per-step varying seed from the (moving) position bits + id → a fresh map choice each iteration.
    const seed = int(px.mul(73856093)).bitXor(int(py.mul(19349663))).bitXor(int(i));
    const r = hash(seed);

    // Branchless weighted selection: idx = #{ cum[k] <= r } is the chosen map; pick each coefficient
    // with a 1-hot mask (idx==k). Avoids a dynamic If/ElseIf chain.
    const idx = float(0).toVar();
    for (let k = 0; k < K - 1; k++) idx.addAssign(step(sys.cum[k], r));

    const a = float(0).toVar();
    const b = float(0).toVar();
    const c = float(0).toVar();
    const d = float(0).toVar();
    const e = float(0).toVar();
    const f = float(0).toVar();
    for (let k = 0; k < K; k++) {
      const w: GpuNode = step(k - 0.5, idx).sub(step(k + 0.5, idx)); // 1 iff idx==k
      const m = maps[k];
      a.addAssign(w.mul(m.a));
      b.addAssign(w.mul(m.b));
      c.addAssign(w.mul(m.c));
      d.addAssign(w.mul(m.d));
      e.addAssign(w.mul(m.e));
      f.addAssign(w.mul(m.f));
    }
    const nx: GpuNode = a.mul(px).add(b.add(uWarp).mul(py)).add(e);
    const ny: GpuNode = c.sub(uWarp).mul(px).add(d.mul(py)).add(f);
    pos.element(i).assign(vec3(nx, ny, 0));
  })() as GpuNode).compute(count);

  const attr: GpuNode = pos.toAttribute();
  const t: GpuNode = attr.y.sub(sys.bounds.y[0]).div(yrange).clamp(0, 1); // vertical gradient param

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.85;
  material.positionNode = attr.sub(vec3(cx, cy, 0)).mul(sys.scale);
  material.colorNode = mix(vec3(c0[0], c0[1], c0[2]), vec3(c1[0], c1[1], c1[2]), t);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [iterate],
    substeps: 2,
    particleCount: count,
    pointSize: sys.pointSize ?? 0.008,
    setParams(p: Record<string, number>): void {
      if ('warp' in p) uWarp.value = p.warp;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function makeGpuIfs(id: string): GpuFactory {
  return (count) => buildGpuIfs(id, count);
}

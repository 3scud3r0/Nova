import * as THREE from 'three';
import { attributeArray, float, Fn, instanceIndex, int, Loop, mix, step, uniform, vec3, vertexIndex } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';
import type { GpuFactory, GpuNode, GpuSim } from './types';
import { ESCAPE_SYSTEMS } from '../archetypes/escapeFractal';

// GPU escape-time fractals: a W×W image grid whose escape value is recomputed every frame from the
// center/scale/iteration uniforms, giving smooth (re-evaluated) pan & zoom — limited only by f32
// precision. Compute pass writes the smooth escape per cell; the colorNode maps it through a cosine
// palette (interior = black). Positions are a static grid laid out from vertexIndex.
const EXTENT = 3;
const TAU = Math.PI * 2;
const MAX_ITER = 256; // compile-time loop bound; the live `maxIter` uniform masks below it
const INV_LN2 = 1 / Math.LN2;

function buildGpuEscape(id: string, count: number): GpuSim {
  const sys = ESCAPE_SYSTEMS[id];
  const kind = sys.kind;
  const w = Math.max(64, Math.round(Math.sqrt(count)));
  const n = w * w;
  const half = EXTENT / 2;
  const julia = kind === 'julia';
  const burning = kind === 'burning-ship';

  const esc: GpuNode = attributeArray(n, 'float');
  const u: Record<string, GpuNode> = {
    centerRe: uniform(sys.defaults.centerRe),
    centerIm: uniform(sys.defaults.centerIm),
    scale: uniform(sys.defaults.scale),
    maxIter: uniform(sys.defaults.maxIter),
    relief: uniform(sys.defaults.relief ?? 0.6),
  };
  if (julia) {
    u.cRe = uniform(sys.defaults.cRe);
    u.cIm = uniform(sys.defaults.cIm);
  }
  const KEYS = Object.keys(u);

  const iterate: GpuNode = (Fn(() => {
    const i = int(instanceIndex);
    const gx = i.mod(w);
    const gy = i.div(w);
    const cre: GpuNode = float(gx).div(w - 1).mul(2).sub(1).mul(u.scale).add(u.centerRe);
    const cim: GpuNode = float(gy).div(w - 1).mul(2).sub(1).mul(u.scale).add(u.centerIm);
    const zr = (julia ? cre : float(0)).toVar();
    const zi = (julia ? cim : float(0)).toVar();
    const cR: GpuNode = julia ? u.cRe : cre;
    const cI: GpuNode = julia ? u.cIm : cim;
    const iter = float(0).toVar();
    const done = float(0).toVar();
    Loop(MAX_ITER, () => {
      const ar: GpuNode = burning ? zr.abs() : zr;
      const ai: GpuNode = burning ? zi.abs() : zi;
      const zr2 = ar.mul(ar);
      const zi2 = ai.mul(ai);
      done.assign(done.max(step(4, zr2.add(zi2)))); // escaped once |z|² > 4
      const active: GpuNode = done.oneMinus().mul(step(iter.add(0.5), u.maxIter)); // not done & iter<maxIter
      zr.assign(mix(zr, zr2.sub(zi2).add(cR), active));
      zi.assign(mix(zi, ar.mul(ai).mul(2).add(cI), active));
      iter.addAssign(active);
    });
    // smooth escape: iter + 1 - log2(log|z|); 0 for interior (never escaped → done==0)
    const mag2 = zr.mul(zr).add(zi.mul(zi)).max(4.0001);
    const smooth: GpuNode = iter.add(1).sub(mag2.log().mul(0.5).log().mul(INV_LN2));
    esc.element(i).assign(done.mul(smooth));
  })() as GpuNode).compute(n);

  // Static grid positions from vertexIndex.
  const vi = int(vertexIndex);
  const fx: GpuNode = float(vi.mod(w)).div(w - 1).mul(2).sub(1).mul(half);
  const fy: GpuNode = float(vi.div(w)).div(w - 1).mul(2).sub(1).mul(half);

  // Cosine palette of the smooth escape value; interior (s≈0) → black.
  const s: GpuNode = esc.toAttribute();
  const t: GpuNode = s.mul(0.04).add(0.5);
  const cr: GpuNode = t.mul(TAU).cos().mul(0.5).add(0.5);
  const cg: GpuNode = t.add(0.18).mul(TAU).cos().mul(0.5).add(0.5);
  const cb: GpuNode = t.add(0.38).mul(TAU).cos().mul(0.5).add(0.5);
  const escaped: GpuNode = step(0.5, s);

  // 3D relief: extrude each cell along Z by its (sqrt-compressed) smooth escape value, turning the
  // flat image into an orbitable glowing landscape; peaks read brighter as a depth cue.
  const height: GpuNode = s.max(0).sqrt().mul(u.relief).mul(0.16);
  const lift: GpuNode = height.mul(0.5).add(0.7).clamp(0.7, 1.4);

  const material = new PointsNodeMaterial();
  material.transparent = false;
  material.depthWrite = false;
  material.size = sys.pointSize; // world-sized points so the grid reads as a solid image (no gaps)
  material.sizeAttenuation = true;
  material.positionNode = vec3(fx, fy, height);
  material.colorNode = vec3(cr, cg, cb).mul(escaped).mul(lift);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init: null,
    steps: [iterate],
    substeps: 1,
    particleCount: n,
    pointSize: sys.pointSize,
    setParams(p: Record<string, number>): void {
      for (const k of KEYS) if (k in p) u[k].value = k === 'maxIter' ? Math.min(MAX_ITER, p[k]) : p[k];
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function makeGpuEscape(id: string): GpuFactory {
  return (count) => buildGpuEscape(id, count);
}

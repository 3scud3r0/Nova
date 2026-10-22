import * as THREE from 'three';
import { attributeArray, float, Fn, hash, instanceIndex, Loop, mix, step, uniform, vec3 } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';
import type { GpuFactory, GpuNode } from './types';

// GPU point-vortex flow (2D ideal fluid in the z=0 plane). The first `nv` particles are vortices
// carrying ± circulation; the rest are massless tracers. Two passes per step (as on the CPU): pass 1
// computes each particle's induced velocity by looping over the FEW vortices (softened Biot–Savart,
// toroidal min-image, perpendicular (−dy,dx) kick); pass 2 advects everything and wraps. Vortices
// live in the same buffer and advect too, so they orbit / pair / shed. `vortices` is rebuild:true on
// the CPU, so nv is baked as a constant — a fresh factory is built whenever it (or count) changes.
//
// Toroidal min-image and wrap use the round-to-nearest form `d − L·round(d/L)`, NOT `(d+D)%L−D`:
// WGSL/TSL float `%` follows the dividend's sign, so the modulo form mis-wraps for d < −DOMAIN.
const KEYS = ['strength', 'softening']; // `vortices` is bake-time (rebuild), not a live uniform
const DEFAULTS: Record<string, number> = { strength: 0.5, softening: 0.08, vortices: 32 };

const DOMAIN = 1.5;
const L = DOMAIN * 2; // toroidal period = 3
const INV2PI = 1 / (2 * Math.PI);

export const gpuPointVortices: GpuFactory = (count, dt0, params) => {
  // Match the CPU: nv vortices = first nv particles, clamped to [2, count].
  const nv = Math.max(2, Math.min(count, Math.round(params.vortices ?? DEFAULTS.vortices)));

  const pos: GpuNode = attributeArray(count, 'vec3'); // plane x in .x, plane y in .z; .y stays 0
  const vel: GpuNode = attributeArray(count, 'vec3'); // induced velocity scratch (vx in .x, vy in .z)
  const col: GpuNode = attributeArray(count, 'vec3'); // baked per-particle color
  const sgnBuf: GpuNode = attributeArray(count, 'float'); // circulation sign (±1 for vortices, 0 tracers)

  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(DEFAULTS[k]);
  const uDt: GpuNode = uniform(dt0);

  // One-shot seed. RNG via hash() differs from the CPU mulberry32 stream, but the statistical layout
  // (uniform in [-DOMAIN,DOMAIN]², ~half ± vortices, sign-based colors) matches.
  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const rx = hash(i.mul(4));
    const ry = hash(i.mul(4).add(1));
    const rs = hash(i.mul(4).add(2)); // sign roll for vortices
    const rt = hash(i.mul(4).add(3)); // tracer brightness
    const x = rx.mul(2).sub(1).mul(DOMAIN);
    const y = ry.mul(2).sub(1).mul(DOMAIN);
    pos.element(i).assign(vec3(x, 0, y));
    vel.element(i).assign(vec3(0));

    const isVortex = step(float(i).add(0.5), float(nv)); // 1.0 when i < nv, else 0.0
    const sgn = step(0.5, rs).mul(2).sub(1); // −1 or +1
    sgnBuf.element(i).assign(sgn.mul(isVortex)); // 0 for tracers → no circulation

    // Colors: warm (+vortex), cool (−vortex), faint grey-blue tracer.
    const warm = vec3(1.0, 0.5, 0.3);
    const cool = vec3(0.3, 0.6, 1.0);
    const vortexCol = mix(cool, warm, step(0.5, rs)); // rs≥0.5 → + → warm
    const t = rt.mul(0.4).add(0.45);
    const tracerCol = vec3(t, t, t.mul(1.1));
    col.element(i).assign(mix(tracerCol, vortexCol, isVortex));
  })() as GpuNode).compute(count);

  // Pass 1: induced velocity for every particle from the unchanged vortex set (loop over nv only).
  const velocityPass: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const pi = pos.element(i).toVar();
    const xi = pi.x;
    const yi = pi.z; // plane y is stored in .z
    const soft2 = u.softening.mul(u.softening);
    const v = vec3(0).toVar(); // accumulate vx in .x, vy in .z
    Loop(nv, ({ i: j }: { i: GpuNode }) => {
      const pj = pos.element(j);
      // toroidal min-image (round-to-nearest, robust for negatives)
      const dxr = xi.sub(pj.x);
      const dyr = yi.sub(pj.z);
      const dx = dxr.sub(dxr.div(L).round().mul(L)).toVar();
      const dy = dyr.sub(dyr.div(L).round().mul(L)).toVar();
      // strength is a LIVE uniform: gamma = sign · strength (CPU bakes strength in; here it stays live)
      const gamma = sgnBuf.element(j).mul(u.strength);
      const inv = gamma.mul(INV2PI).div(dx.mul(dx).add(dy.mul(dy)).add(soft2));
      // self term (j==i for a vortex): dx=dy=0 → kick = 0, matching the CPU's `if (v===i) continue`.
      v.x.subAssign(dy.mul(inv));
      v.z.addAssign(dx.mul(inv));
    });
    vel.element(i).assign(v);
  })() as GpuNode).compute(count);

  // Pass 2: advect + toroidal wrap (round-to-nearest keeps everything in [−DOMAIN, DOMAIN]).
  const integratePass: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const p = pos.element(i).toVar();
    const v = vel.element(i);
    const x = p.x.add(v.x.mul(uDt)).toVar();
    const y = p.z.add(v.z.mul(uDt)).toVar();
    x.assign(x.sub(x.div(L).round().mul(L)));
    y.assign(y.sub(y.div(L).round().mul(L)));
    pos.element(i).assign(vec3(x, 0, y));
  })() as GpuNode).compute(count);

  const attr: GpuNode = pos.toAttribute();
  const speed: GpuNode = vel.toAttribute().length();
  const cattr: GpuNode = col.toAttribute();

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.85;
  material.positionNode = attr; // already in the z=0 plane, domain ±1.5
  // Brighten by local speed so swirls read; the baked color carries the warm/cool vortex identity.
  material.colorNode = mix(cattr, vec3(1.0), speed.mul(0.5).clamp(0, 1));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [velocityPass, integratePass],
    substeps: 1,
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

import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attributeArray, float, Fn, hash, instanceIndex, int, Loop, mix, step, uniform, vec3 } from 'three/tsl';
import type { GpuFactory, GpuNode } from './types';
import { mulberry32 } from '../state/rng';
import { hslToRgb } from '../core/color';

// GPU Particle Life: K species in a toroidal cube governed by an ASYMMETRIC KxK interaction matrix.
// Brute-force O(n^2) (like gpuNbody) replaces the CPU SpatialGrid — the grid only changes which
// pairs are visited, not the physics, so a full Loop(count) with the same toroidal min-image and
// rMax cutoff reproduces CPU behavior. Two passes per step: forcePass writes the friction-damped
// velocity update; integratePass advects + wraps. Species are contiguous blocks (floor(i*K/n)) so
// colors/hierarchy match the CPU. The KxK matrix + per-species colors are baked from JS (mulberry32
// seeded by variant, hslToRgb) into prefilled storage buffers.
const DOMAIN = 1.5; // half-extent of the cubic toroidal domain
const L = DOMAIN * 2;
const KEYS = ['radius', 'beta', 'friction', 'force'];
const DEFAULTS: Record<string, number> = { radius: 0.55, beta: 0.3, friction: 0.86, force: 4 };

export const gpuParticleLife: GpuFactory = (count, dt0, params) => {
  const K = Math.max(2, Math.min(7, Math.round(params.species ?? 5)));
  const variant = Math.round(params.variant ?? 1);

  // Bake the asymmetric KxK interaction matrix with the same seeding the CPU uses (seed defaults to
  // 1 on the GPU path; the CPU uses config.seed*1000+variant — variant gives reproducible variety).
  const rng = mulberry32(1 * 1000 + variant);
  const matData = new Float32Array(K * K);
  for (let i = 0; i < K * K; i++) matData[i] = rng() * 2 - 1;

  // Bake per-species colors (contiguous blocks, same hue formula as the CPU archetype).
  const colData = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const s = Math.floor((i * K) / count);
    hslToRgb((s / K) * 0.85, 0.85, 0.62, colData, i * 3);
  }

  const pos: GpuNode = attributeArray(count, 'vec3');
  const vel: GpuNode = attributeArray(count, 'vec3');
  const mat: GpuNode = attributeArray(matData, 'float'); // K*K coefficients in [-1,1]
  const col: GpuNode = attributeArray(colData, 'vec3'); // per-particle species color

  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(DEFAULTS[k]);
  const uDt: GpuNode = uniform(dt0);

  // Seed positions uniformly in the cube [-DOMAIN, DOMAIN]^3, velocities zero.
  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const x = hash(i.mul(3)).mul(2).sub(1).mul(DOMAIN);
    const y = hash(i.mul(3).add(1)).mul(2).sub(1).mul(DOMAIN);
    const z = hash(i.mul(3).add(2)).mul(2).sub(1).mul(DOMAIN);
    pos.element(i).assign(vec3(x, y, z));
    vel.element(i).assign(vec3(0));
  })() as GpuNode).compute(count);

  // Pass 1: accumulate forces (positions read-only) and write the damped velocity in place.
  const forcePass: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const pi = pos.element(i).toVar();
    const si = int(instanceIndex).mul(K).div(count); // species of i = floor(i*K/n)
    const rowi = si.mul(K);
    const rMax = u.radius;
    const rMax2 = rMax.mul(rMax);
    const beta = u.beta;
    const invBeta1 = float(1).div(float(1).sub(beta)); // 1/(1-beta)
    const f = vec3(0).toVar();
    Loop(count, ({ i: j }: { i: GpuNode }) => {
      const sj = int(j).mul(K).div(count); // species of j
      // toroidal minimum-image delta: d - L*round(d/L)
      const draw = pos.element(j).sub(pi);
      const d = draw.sub(draw.div(L).round().mul(L)).toVar();
      const r2 = d.dot(d);
      const r = r2.sqrt().max(1e-5); // guard divide-by-zero
      const rn = r.div(rMax);
      const coeff = mat.element(rowi.add(sj)); // A[si, sj]
      const Frep = rn.div(beta).sub(1); // rn < beta branch
      const Fatt = coeff.mul(float(1).sub(rn.mul(2).sub(1).sub(beta).abs().mul(invBeta1)));
      const near = step(rn, beta); // 1 when rn <= beta (repulsion), else 0
      const F = mix(Fatt, Frep, near);
      const g = F.div(r);
      // mask: contribute only when 1e-10 < r2 < rMax2 (skips self-pair d=0 and out-of-range)
      const mask = step(1e-10, r2).mul(step(r2, rMax2));
      f.addAssign(d.mul(g.mul(mask)));
    });
    // vel = (vel + f*force*dt) * friction
    const v = vel.element(i).add(f.mul(u.force.mul(uDt))).mul(u.friction);
    vel.element(i).assign(v);
  })() as GpuNode).compute(count);

  // Pass 2: advect + toroidal wrap into [-DOMAIN, DOMAIN]^3.
  const integratePass: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const p = pos.element(i).add(vel.element(i).mul(uDt)).toVar();
    // wrap: p - L*round(p/L) keeps p in [-DOMAIN, DOMAIN]
    const wrapped = p.sub(p.div(L).round().mul(L));
    pos.element(i).assign(wrapped);
  })() as GpuNode).compute(count);

  const attr: GpuNode = pos.toAttribute();
  const spColor: GpuNode = col.toAttribute();
  const speed: GpuNode = vel.toAttribute().length();

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.85;
  material.positionNode = attr;
  // species color, brightened slightly with speed
  material.colorNode = mix(spColor, vec3(1, 1, 1), speed.mul(0.4).clamp(0, 1));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [forcePass, integratePass],
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

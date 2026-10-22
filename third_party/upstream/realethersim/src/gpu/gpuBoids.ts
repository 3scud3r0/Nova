import * as THREE from 'three';
import { attributeArray, color, float, Fn, hash, instanceIndex, Loop, mix, step, uniform, vec3 } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';
import type { GpuFactory, GpuNode } from './types';

// GPU Boids (Reynolds flocking): separation + alignment + cohesion within a perception radius, in a
// toroidal cube. The CPU path uses a SpatialGrid for neighbour queries; the GPU path uses a
// brute-force O(n²) inner Loop (like gpuNbody) because the neighbour test is a pure radius gate —
// out-of-range particles contribute zero, so all-pairs with the same gate reproduces the grid result
// exactly. Two passes per step so reads never race writes: pass 1 accumulates steering into `acc`
// from the previous step's pos/vel; pass 2 integrates velocity with a speed clamp and wraps
// positions toroidally. Colour by speed. At the default 8000 agents this is the same workload class
// gpuNbody ships (≈64M pair evals/pass at substeps=1).
const KEYS = ['radius', 'separation', 'alignment', 'cohesion', 'maxSpeed'];
const DEFAULTS: Record<string, number> = {
  radius: 0.4,
  separation: 1.6,
  alignment: 1.0,
  cohesion: 0.9,
  maxSpeed: 0.6,
};

const DOMAIN = 1.5;
const L = DOMAIN * 2; // toroidal period = 3
const SEP_FRAC = 0.45; // separation acts within SEP_FRAC × perception radius

export const gpuBoids: GpuFactory = (count, dt0) => {
  const pos: GpuNode = attributeArray(count, 'vec3');
  const vel: GpuNode = attributeArray(count, 'vec3');
  const acc: GpuNode = attributeArray(count, 'vec3');
  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(DEFAULTS[k]);
  const uDt: GpuNode = uniform(dt0);

  // ---- one-shot seed: positions uniform in the cube, small random velocities ----
  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const px = hash(i.mul(6)).mul(2).sub(1).mul(DOMAIN);
    const py = hash(i.mul(6).add(1)).mul(2).sub(1).mul(DOMAIN);
    const pz = hash(i.mul(6).add(2)).mul(2).sub(1).mul(DOMAIN);
    const vx = hash(i.mul(6).add(3)).mul(2).sub(1).mul(0.3);
    const vy = hash(i.mul(6).add(4)).mul(2).sub(1).mul(0.3);
    const vz = hash(i.mul(6).add(5)).mul(2).sub(1).mul(0.3);
    pos.element(i).assign(vec3(px, py, pz));
    vel.element(i).assign(vec3(vx, vy, vz));
    acc.element(i).assign(vec3(0));
  })() as GpuNode).compute(count);

  // ---- pass 1: accumulate Reynolds steering into acc ----
  const accelPass: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const pi = pos.element(i).toVar();
    const vi = vel.element(i).toVar();

    const rMax = u.radius;
    const rMax2 = rMax.mul(rMax).toVar();
    const rSep = rMax.mul(SEP_FRAC);
    const rSep2 = rSep.mul(rSep).toVar();

    const cnt = float(0).toVar();
    const alignSum = vec3(0).toVar(); // neighbour velocity sum
    const cohSum = vec3(0).toVar(); // neighbour offset sum (min-image)
    const sepPush = vec3(0).toVar(); // separation push

    Loop(count, ({ i: j }: { i: GpuNode }) => {
      // toroidal min-image displacement d = pos[j] − pi wrapped into [−DOMAIN, DOMAIN]
      const raw = pos.element(j).sub(pi);
      const d = raw.sub(raw.div(L).round().mul(L)).toVar();
      const r2 = d.dot(d).toVar();
      // inRange = (r2 > 1e-12) AND (r2 < rMax2); the self term has r2=0 → excluded
      const inRange = step(1e-12, r2).mul(step(r2, rMax2)).toVar();
      cnt.addAssign(inRange);
      alignSum.addAssign(vel.element(j).mul(inRange));
      cohSum.addAssign(d.mul(inRange));
      const sepMask = inRange.mul(step(r2, rSep2));
      sepPush.addAssign(d.mul(r2.max(1e-9).reciprocal()).negate().mul(sepMask));
    });

    const invCount = cnt.max(1).reciprocal();
    const align = alignSum.mul(invCount).sub(vi).mul(u.alignment);
    const coh = cohSum.mul(invCount).mul(u.cohesion);
    const sep = sepPush.mul(u.separation);
    // zero accel when no neighbours (matches the CPU else-branch)
    const steer = align.add(coh).add(sep).mul(step(0.5, cnt));
    acc.element(i).assign(steer);
  })() as GpuNode).compute(count);

  // ---- pass 2: integrate velocity (speed clamp) + advance & wrap position ----
  const integratePass: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const v = vel.element(i).add(acc.element(i).mul(uDt)).toVar();
    const maxSpeed = u.maxSpeed;
    const minSpeed = maxSpeed.mul(0.4);
    const sp = v.length().max(1e-9).toVar();
    const clamped = sp.clamp(minSpeed, maxSpeed);
    v.mulAssign(clamped.div(sp));
    vel.element(i).assign(v);

    // advance and wrap toroidally into [−DOMAIN, DOMAIN)
    const p = pos.element(i).add(v.mul(uDt)).toVar();
    const wrapped = p.add(DOMAIN).div(L).fract().mul(L).sub(DOMAIN);
    pos.element(i).assign(wrapped);
  })() as GpuNode).compute(count);

  // ---- render ----
  const attr: GpuNode = pos.toAttribute();
  const speed: GpuNode = vel.toAttribute().length();
  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.85;
  material.positionNode = attr;
  // colour by speed: slow → teal, fast → warm white
  material.colorNode = mix(color(0x1e9e9e), color(0xfff0c0), speed.mul(1.6).clamp(0, 1));

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
    pointSize: 0.016,
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

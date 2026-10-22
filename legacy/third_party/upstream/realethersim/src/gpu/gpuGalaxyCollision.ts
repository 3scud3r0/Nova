import * as THREE from 'three';
import { attributeArray, float, Fn, hash, instanceIndex, Loop, mix, step, uniform, vec3 } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';
import type { GpuFactory, GpuNode } from './types';

// GPU twin of the galaxy collision (Toomre restricted N-body). Particle 0 and 1 are the two galactic
// cores (they carry the mass and orbit each other); the rest are massless test stars in two tilted
// disks. Two compute passes per substep: (1) accelerate — every particle sums the softened gravity of
// the two cores (a Loop over just the 2), and the cores additionally feel a dynamical-friction drag
// that grows as they close, so their orbit decays into a merger; (2) integrate — advance positions.
// Because the initial momentum is zero, the barycentre stays at the origin, so no recentring is needed.
// massRatio / pericenter / inclination are baked at build (rebuild:true on the CPU → fresh factory);
// friction and speed are live uniforms. Branching uses step()/mix() masks (the codebase's GPU idiom).
const G = 1;
const SOFT2 = 0.12 * 0.12;
const D0 = 2.6; // initial core separation
const TAU = Math.PI * 2;

export const gpuGalaxyCollision: GpuFactory = (count, dt0, params) => {
  const mRatio = params.massRatio ?? 1.1;
  const peri = params.pericenter ?? 0.8;
  const incl = params.inclination ?? 0.9;
  const mA = 1, mB = mRatio, Mtot = mA + mB, fA = mA / Mtot, fB = mB / Mtot;
  const aOrb = (D0 + peri) / 2;
  const vrel = Math.sqrt(G * Mtot * (2 / D0 - 1 / aOrb));
  const c0x = -fB * D0, c0vy = -fB * vrel; // Milky Way core
  const c1x = fA * D0, c1vy = fA * vrel; // Andromeda core
  const Rd0 = 0.7, Rd1 = 0.7 * Math.cbrt(mB / mA); // disk radii
  const trig = (a: number): [number, number] => [Math.cos(a), Math.sin(a)];
  const [c0a, s0a] = trig(0.4), [c0z, s0z] = trig(0.3); // MW disk orientation (Euler X then Z)
  const [c1a, s1a] = trig(incl), [c1z, s1z] = trig(2.1); // Andromeda inclined
  const half = Math.floor(count / 2);

  const pos: GpuNode = attributeArray(count, 'vec3');
  const vel: GpuNode = attributeArray(count, 'vec3');
  const col: GpuNode = attributeArray(count, 'vec3');
  const mass: GpuNode = attributeArray(count, 'float');

  const uFric: GpuNode = uniform(params.friction ?? 0.6);
  const uSubDt: GpuNode = uniform((dt0 * (params.speed ?? 1.8)) / 3);

  // rotate a vector about X then Z (node-valued trig, blended per galaxy)
  const rotXZ = (x: GpuNode, y: GpuNode, z: GpuNode, ca: GpuNode, sa: GpuNode, cz: GpuNode, sz: GpuNode): GpuNode => {
    const y1 = y.mul(ca).sub(z.mul(sa));
    const z1 = y.mul(sa).add(z.mul(ca));
    return vec3(x.mul(cz).sub(y1.mul(sz)), x.mul(sz).add(y1.mul(cz)), z1);
  };

  // ── one-shot seed: two cores on their encounter orbit + two disks of stars ──
  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const fi = float(i);
    const h = (k: number): GpuNode => hash(i.mul(8).add(k));
    const gal1 = step(float(half), fi); // 1 → Andromeda disk, 0 → Milky Way disk
    const Rd = mix(float(Rd0), float(Rd1), gal1);
    const Mg = mix(float(mA), float(mB), gal1);
    const coreX = mix(float(c0x), float(c1x), gal1);
    const coreVy = mix(float(c0vy), float(c1vy), gal1);
    const ca = mix(float(c0a), float(c1a), gal1);
    const sa = mix(float(s0a), float(s1a), gal1);
    const cz = mix(float(c0z), float(c1z), gal1);
    const sz = mix(float(s0z), float(s1z), gal1);
    const diskMask = step(0.16, h(0)); // 1 → thin disk, 0 → compact bulge
    const rDisk = float(0.12).add(h(1).pow(0.7).mul(0.95)).mul(Rd);
    const rBulge = h(1).sqrt().mul(0.28).mul(Rd);
    const r = mix(rBulge, rDisk, diskMask).toVar();
    const ang = h(2).mul(TAU);
    const cAng = ang.cos(), sAng = ang.sin();
    const lzDisk = h(3).add(h(4)).add(h(5)).sub(1.5).div(1.5).mul(0.03);
    const lzBulge = h(3).sub(0.5).mul(Rd).mul(0.4);
    const lz = mix(lzBulge, lzDisk, diskMask);
    const vc = Mg.div(r.mul(r).add(SOFT2).sqrt()).sqrt(); // softened circular speed
    const rp = rotXZ(r.mul(cAng), r.mul(sAng), lz, ca, sa, cz, sz);
    const rv = rotXZ(sAng.negate().mul(vc), cAng.mul(vc), float(0), ca, sa, cz, sz);
    const starPos = vec3(coreX.add(rp.x), rp.y, rp.z);
    const starVel = vec3(rv.x, coreVy.add(rv.y), rv.z);
    const diskCol = mix(vec3(0.55, 0.68, 1.0), vec3(1.0, 0.72, 0.46), gal1); // MW blue / Andromeda gold
    const bulgeCol = mix(vec3(1.0, 0.9, 0.82), vec3(1.0, 0.85, 0.6), gal1);
    const baseCol = mix(bulgeCol, diskCol, diskMask);
    const starCol = baseCol.mul(mix(float(1.4), float(0.9), diskMask).add(h(6).mul(0.6)));

    // cores (i = 0, 1) override the star candidate
    const core1Mask = step(0.5, fi); // 1 for i≥1 (Andromeda core + all stars), 0 for the MW core
    const starMask = step(1.5, fi); // 1 → star, 0 → a core
    const corePos = mix(vec3(c0x, 0, 0), vec3(c1x, 0, 0), core1Mask);
    const coreVel = mix(vec3(0, c0vy, 0), vec3(0, c1vy, 0), core1Mask);
    const coreMass = mix(float(mA), float(mB), core1Mask);
    const coreCol = mix(vec3(1.0, 0.9, 0.82).mul(2.6), vec3(1.0, 0.85, 0.6).mul(2.6), core1Mask);

    pos.element(i).assign(mix(corePos, starPos, starMask));
    vel.element(i).assign(mix(coreVel, starVel, starMask));
    mass.element(i).assign(mix(coreMass, float(0), starMask));
    col.element(i).assign(mix(coreCol, starCol, starMask));
  })() as GpuNode).compute(count);

  // ── pass 1: accelerate. Every particle sums the two cores' softened gravity; cores also drag. ──
  const accelPass: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const pi = pos.element(i).toVar();
    const vi = vel.element(i).toVar();
    const a = vec3(0).toVar();
    Loop(2, ({ i: j }: { i: GpuNode }) => {
      const d = pos.element(j).sub(pi);
      const r2 = d.dot(d).add(SOFT2);
      a.addAssign(d.mul(mass.element(j).mul(G).div(r2.mul(r2.sqrt())))); // self term → d=0 → 0
    });
    // dynamical friction on the cores only (drag ∝ velocity, stronger as the cores close)
    const dc = pos.element(1).sub(pos.element(0));
    const gamma = uFric.div(dc.dot(dc).add(0.5));
    const coreMask = float(1).sub(step(1.5, float(i))); // 1 for the two cores, 0 for stars
    a.subAssign(vi.mul(gamma.mul(coreMask)));
    const nv = vi.add(a.mul(uSubDt)).toVar();
    const sp2 = nv.dot(nv);
    const clamped = nv.mul(float(8).div(sp2.sqrt().max(1e-4)));
    nv.assign(mix(nv, clamped, step(64, sp2))); // clamp runaway kicks
    vel.element(i).assign(nv);
  })() as GpuNode).compute(count);

  // ── pass 2: integrate positions ──
  const integratePass: GpuNode = (Fn(() => {
    const i = instanceIndex;
    pos.element(i).assign(pos.element(i).add(vel.element(i).mul(uSubDt)));
  })() as GpuNode).compute(count);

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.9;
  material.positionNode = pos.toAttribute(); // barycentre stays at the origin (zero net momentum)
  material.colorNode = col.toAttribute();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  let curDt = dt0;
  let curSpeed = params.speed ?? 1.8;
  return {
    points,
    init,
    steps: [accelPass, integratePass],
    substeps: 3,
    particleCount: count,
    pointSize: 0.007,
    setParams(p: Record<string, number>): void {
      if ('friction' in p) uFric.value = p.friction;
      if ('speed' in p) curSpeed = p.speed;
      if ('dt' in p) curDt = p.dt;
      uSubDt.value = (curDt * curSpeed) / 3;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
};

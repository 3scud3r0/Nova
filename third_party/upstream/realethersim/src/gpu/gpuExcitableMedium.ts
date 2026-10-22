import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attributeArray, color, float, Fn, hash, instanceIndex, int, mix, step, uniform, vec3, vertexIndex } from 'three/tsl';
import type { GpuFactory, GpuNode } from './types';

// GPU excitable medium: Greenberg-Hastings cyclic cellular automaton on a toroidal W×W grid. Each
// cell cycles 0 (rest) → 1 (excited) → 2…N-1 (refractory) → 0. A resting cell ignites when at least
// `threshold` of its 8 Moore neighbours are excited (state 1); a non-rest cell deterministically
// advances toward rest. From random seeding this self-organises into travelling and SPIRAL waves.
//
// Mirrors gpuFoam's grid ping-pong: pass 1 reads canonical buffer A, applies the rule, writes B;
// pass 2 copies B→A so the render attribute always samples A. State is stored as a float (integer
// values 0..N-1) so the whole rule is expressible with step()/mix() and never blows up.
//
// `states` (N) is a rebuild-true param so it is baked as a constant captured at construction;
// `threshold` and `relief` are live uniforms driven by the existing Tweakpane sliders.
const EXTENT = 3;
const KEYS = ['threshold', 'relief'];
const DEFAULTS: Record<string, number> = { states: 6, threshold: 2, relief: 1.6 };

export const gpuExcitableMedium: GpuFactory = (count, _dt, params) => {
  const w = Math.max(48, Math.round(Math.sqrt(count)));
  const n = w * w;
  // N is rebuild-true: bake it as a constant from the params handed in at construction.
  const N = Math.max(3, Math.round(params?.states ?? DEFAULTS.states));
  const invN = 1 / (N - 1);

  const stateA: GpuNode = attributeArray(n, 'float');
  const stateB: GpuNode = attributeArray(n, 'float');

  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(DEFAULTS[k]);

  // Seed: ~50% resting, the rest a uniform random integer state in [0, N-1] — nucleates waves.
  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const cx = float(int(i).mod(w));
    const cy = float(int(i).div(w));
    // Seed a periodic phase ramp (KX×KY integer wavelengths so it wraps cleanly on the torus) plus a
    // little noise. A pure-random GH seed is a coin-flip between persistent spirals and die-out; a
    // phase ramp guarantees self-sustaining traveling-wave trains, and the noise breaks band edges
    // into spiral defects. State bands stay wide enough (≈ w/(KX·N) cells) to satisfy threshold≥2.
    const KX = 3;
    const KY = 2;
    const phase = cx.mul(KX / w).add(cy.mul(KY / w)).add(hash(i).mul(0.1));
    const seeded = phase.fract().mul(N).floor().min(N - 1); // states 0..N-1, periodic
    stateA.element(i).assign(seeded);
    stateB.element(i).assign(0);
  })() as GpuNode).compute(n);

  // 1.0 iff s is exactly the excited state (==1): 0.5<=s<1.5.
  const isExc = (s: GpuNode): GpuNode => step(0.5, s).sub(step(1.5, s));

  const react: GpuNode = (Fn(() => {
    const i = int(instanceIndex);
    const x = i.mod(w);
    const y = i.div(w);
    const xl = x.add(w - 1).mod(w);
    const xr = x.add(1).mod(w);
    const yu = y.add(w - 1).mod(w).mul(w);
    const yd = y.add(1).mod(w).mul(w);
    const yc = y.mul(w);

    const exc = isExc(stateA.element(yc.add(xl)))
      .add(isExc(stateA.element(yc.add(xr))))
      .add(isExc(stateA.element(yu.add(x))))
      .add(isExc(stateA.element(yd.add(x))))
      .add(isExc(stateA.element(yu.add(xl))))
      .add(isExc(stateA.element(yu.add(xr))))
      .add(isExc(stateA.element(yd.add(xl))))
      .add(isExc(stateA.element(yd.add(xr))));

    const cur = stateA.element(i).toVar();
    // Rest-cell outcome: ignite to 1 iff exc >= threshold, else stay 0.
    const ignite = step(u.threshold, exc);
    // Non-rest outcome: cur+1, wrapping to 0 once cur >= N-1.
    const advance = mix(cur.add(1), float(0), step(float(N - 1), cur));
    // Select: rest cells (cur==0) take ignite, others take advance.
    const isRest = step(0.5, cur).oneMinus();
    stateB.element(i).assign(mix(advance, ignite, isRest));
  })() as GpuNode).compute(n);

  const copy: GpuNode = (Fn(() => {
    const i = instanceIndex;
    stateA.element(i).assign(stateB.element(i));
  })() as GpuNode).compute(n);

  // Render: displaced point lattice addressed by vertexIndex, exactly like gpuFoam.
  const vi = int(vertexIndex);
  const cell = EXTENT / (w - 1);
  const half = EXTENT / 2;
  const fx: GpuNode = float(vi.mod(w)).mul(cell).sub(half);
  const fz: GpuNode = float(vi.div(w)).mul(cell).sub(half);
  const s: GpuNode = stateA.toAttribute();

  // Height: excited band (s==1) rides high at 1; refractory ramps s/(N-1); rest sits at 0.
  const exc1: GpuNode = step(0.5, s).sub(step(1.5, s)); // 1 iff s==1
  const phase: GpuNode = mix(s.mul(invN), float(1), exc1);
  const height: GpuNode = phase.mul(u.relief).sub(0.3);

  // Colour gradient by x-fraction (like the CPU per-cell colours), brightened on the excited band.
  const t = float(vi.mod(w)).div(w);
  const base = mix(color(0x244a8c), color(0xd0a040), t.clamp(0, 1));
  const colorNode = mix(base, color(0xfff0c0), exc1.mul(0.85));

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.85;
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

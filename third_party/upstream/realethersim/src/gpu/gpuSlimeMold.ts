import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  atomicAdd,
  atomicLoad,
  atomicStore,
  attributeArray,
  color,
  float,
  Fn,
  hash,
  If,
  instanceIndex,
  int,
  mix,
  step,
  uniform,
  vec3,
} from 'three/tsl';
import type { GpuFactory, GpuNode } from './types';

// GPU Physarum slime mold: ~100k agents wander a toroidal W×W trail field. Each agent senses the
// float field at 3 forward sensors, steers toward the strongest, moves, and deposits chemical; the
// field diffuses (3×3 box blur) and decays each step. Emergent transport networks appear in the
// AGENT density, so we render the agents as additive points (CPU-only trails/highlight are skipped).
//
// The agent↔field feedback is mediated through the grid (no all-pairs loop). Deposits are scattered
// into an integer ATOMIC buffer via fixed-point atomicAdd (WGSL atomics are int-only), then a
// diffuse+decay pass folds the deposit into a float trail field with ping-pong (fieldA→fieldB→copy)
// so the blur never reads a cell another invocation is writing. Passes mix two dispatch sizes —
// agent passes dispatch `count`, field passes dispatch W*W; each `.compute(size)` carries its own
// size, so the bootstrap substeps loop runs them all once per substep. substeps=1 keeps one
// self-consistent CPU step per frame (clear→sense/move/deposit→diffuse→copy→writePos).
const EXTENT = 3; // world span of the field plane (matches CPU)
const TWO_PI = Math.PI * 2;
const DEPOSIT_SCALE = 4096; // fixed-point scale for the integer atomic deposit buffer (+1 → 4096)

// `grid` controls buffer sizes so it is baked at construction (rebuild:true), not a uniform. KEYS
// omits it; the other five are live uniforms driven by the existing sliders.
const KEYS = ['speed', 'sensorDist', 'sensorAngle', 'turn', 'decay'];
const DEFAULTS: Record<string, number> = {
  speed: 1.0,
  sensorDist: 9,
  sensorAngle: 0.4,
  turn: 0.45,
  decay: 0.9,
  grid: 192,
};

export const gpuSlimeMold: GpuFactory = (count, _dt0, params) => {
  const w = Math.max(64, Math.round(params.grid ?? DEFAULTS.grid));
  const cells = w * w;

  // Agent state (x, y in cell units, heading) + the rendered world-space buffer + a per-agent tint
  // (the field strength under each agent, sampled in a compute pass to avoid a storage read in the
  // material). The two field buffers are zero-filled by allocation, so no field-clearing init is
  // needed; the atomic deposit buffer is cleared every frame by `clearDeposit`.
  const st: GpuNode = attributeArray(count, 'vec3');
  const pos: GpuNode = attributeArray(count, 'vec3');
  const tint: GpuNode = attributeArray(count, 'float');
  const deposit: GpuNode = attributeArray(cells, 'int').toAtomic();
  const fieldA: GpuNode = attributeArray(cells, 'float'); // canonical trail (sensed + rendered tint)
  const fieldB: GpuNode = attributeArray(cells, 'float'); // diffuse scratch (ping-pong)

  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(DEFAULTS[k]);

  const scale = EXTENT / w;
  const half = EXTENT / 2;

  // Toroidal cell index from float cell coords: floor → wrap into [0,w) (handles negative offsets).
  const cellIndex = (fx: GpuNode, fy: GpuNode): GpuNode => {
    const cx = int(fx.floor()).mod(w).add(w).mod(w);
    const cy = int(fy.floor()).mod(w).add(w).mod(w);
    return cy.mul(w).add(cx);
  };

  // Sample the canonical float field at a sensor offset (heading ang, distance dist), wrapped.
  // Sensor coords are rounded to the nearest cell to match the CPU's Math.round() sensor sampling
  // (the deposit cell, in contrast, floors — matching the CPU's `nx|0` truncation).
  const sense = (x: GpuNode, y: GpuNode, ang: GpuNode, dist: GpuNode): GpuNode => {
    const sx = x.add(ang.cos().mul(dist)).round();
    const sy = y.add(ang.sin().mul(dist)).round();
    return fieldA.element(cellIndex(sx, sy));
  };

  // --- init: seed agents at random cell positions + heading (fields are zero by allocation). ---
  const init: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const r1 = hash(i.mul(3));
    const r2 = hash(i.mul(3).add(1));
    const r3 = hash(i.mul(3).add(2));
    st.element(i).assign(vec3(r1.mul(w), r2.mul(w), r3.mul(TWO_PI)));
  })() as GpuNode).compute(count);

  // --- pass 1: clear the atomic deposit accumulator (must precede each scatter). ---
  const clearDeposit: GpuNode = (Fn(() => {
    atomicStore(deposit.element(instanceIndex), int(0));
  })() as GpuNode).compute(cells);

  // --- pass 2: agents sense → steer → move → scatter deposit (CPU order). ---
  const agentStep: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const s = st.element(i).toVar();
    const x = s.x.toVar();
    const y = s.y.toVar();
    const h = s.z.toVar();

    const fwd = sense(x, y, h, u.sensorDist).toVar();
    const left = sense(x, y, h.add(u.sensorAngle), u.sensorDist).toVar();
    const right = sense(x, y, h.sub(u.sensorAngle), u.sensorDist).toVar();

    // Steering, matching the CPU if / else-if cascade exactly.
    If(fwd.greaterThan(left).and(fwd.greaterThan(right)), () => {
      // forward strongest → keep heading
    })
      .ElseIf(fwd.lessThan(left).and(fwd.lessThan(right)), () => {
        // ambiguous → random ± turn. Seed from the (per-frame changing) position + id so it
        // decoheres like the CPU's rng() coin flip rather than biasing every step the same way.
        const rnd = hash(int(x).add(int(y).mul(w)).add(int(i).mul(31)));
        const dir = float(1).sub(step(0.5, rnd).mul(2)); // rnd<0.5 → +1, else −1
        h.addAssign(dir.mul(u.turn));
      })
      .ElseIf(left.greaterThan(right), () => {
        h.addAssign(u.turn);
      })
      .ElseIf(right.greaterThan(left), () => {
        h.subAssign(u.turn);
      });

    // Move + toroidal wrap into [0,w).
    const nx = x.add(h.cos().mul(u.speed)).toVar();
    const ny = y.add(h.sin().mul(u.speed)).toVar();
    nx.assign(nx.mod(w).add(w).mod(w));
    ny.assign(ny.mod(w).add(w).mod(w));
    st.element(i).assign(vec3(nx, ny, h));

    // Deposit +1 (fixed-point) into the new cell, atomically (agents race on shared cells).
    atomicAdd(deposit.element(cellIndex(nx, ny)), int(DEPOSIT_SCALE));
  })() as GpuNode).compute(count);

  // --- pass 3: 3×3 toroidal box blur × decay. val = fieldA + this frame's deposit; write fieldB. ---
  const diffuse: GpuNode = (Fn(() => {
    const i = int(instanceIndex);
    const cx = i.mod(w);
    const cy = i.div(w);
    const xl = cx.add(w - 1).mod(w);
    const xr = cx.add(1).mod(w);
    const yu = cy.add(w - 1).mod(w).mul(w);
    const yd = cy.add(1).mod(w).mul(w);
    const yc = cy.mul(w);

    // Persisted trail + this frame's fixed-point deposit (decoded to float).
    const val = (idx: GpuNode): GpuNode => {
      const dep: GpuNode = atomicLoad(deposit.element(idx));
      return fieldA.element(idx).add(float(dep).div(DEPOSIT_SCALE));
    };

    const sum = val(yc.add(cx))
      .add(val(yc.add(xl)))
      .add(val(yc.add(xr)))
      .add(val(yu.add(cx)))
      .add(val(yd.add(cx)))
      .add(val(yu.add(xl)))
      .add(val(yu.add(xr)))
      .add(val(yd.add(xl)))
      .add(val(yd.add(xr)));

    fieldB.element(i).assign(sum.div(9).mul(u.decay));
  })() as GpuNode).compute(cells);

  // --- pass 4: copy fieldB → fieldA so the next frame's sensing reads the canonical field. ---
  const copy: GpuNode = (Fn(() => {
    const i = instanceIndex;
    fieldA.element(i).assign(fieldB.element(i));
  })() as GpuNode).compute(cells);

  // --- pass 5: world-space render position + per-agent field tint (CPU syncPositions). ---
  const writePos: GpuNode = (Fn(() => {
    const i = instanceIndex;
    const s = st.element(i);
    pos.element(i).assign(vec3(s.x.mul(scale).sub(half), float(0), s.y.mul(scale).sub(half)));
    tint.element(i).assign(fieldA.element(cellIndex(s.x, s.y)));
  })() as GpuNode).compute(count);

  // --- render: additive warm-glow points tinted by the trail density under each agent. ---
  const attr: GpuNode = pos.toAttribute();
  const tintAttr: GpuNode = tint.toAttribute();

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.9;
  material.positionNode = attr;
  // Every agent gets a visible warm glow (bright base), brightening to white on dense trails so the
  // network reads via additive accumulation — like the CPU per-agent palette, not a field-only mask.
  material.colorNode = mix(color(0xff7a1e), color(0xfff4c4), tintAttr.mul(1.2).clamp(0, 1));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    // A few sim steps/frame so the trail field evolves at roughly the CPU accumulator's wall-clock
    // pace (1/frame was under-evolved; ~6 matched but over-collapsed the winner-take-all trail).
    steps: [clearDeposit, agentStep, diffuse, copy, writePos],
    substeps: 3,
    particleCount: count,
    pointSize: 0.01,
    setParams(p: Record<string, number>): void {
      for (const k of KEYS) if (k in p) u[k].value = p[k];
      // `grid` (rebuild) and `dt` (unused) are intentionally not live uniforms.
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
};

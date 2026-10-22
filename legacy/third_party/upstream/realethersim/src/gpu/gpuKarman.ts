import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attributeArray, float, Fn, If, instanceIndex, select, uniform, vec2, vec3, vertexIndex } from 'three/tsl';
import type { GpuFactory, GpuNode, GpuSim } from './types';

// GPU twin of the CPU Kármán LBM (D2Q9, BGK) — a 1:1 port of the verified CPU algorithm. Each
// lattice update is six compute passes (inflow/outflow BC → collide → stream w/ bounce-back →
// copy → velocity → vorticity); the field is rendered FLAT and coloured red/blue by vorticity (the
// classic top-down look the CPU path can't show, since CPU colours upload once). The 9 lattice
// directions are unrolled in JS at graph-build time.
const EX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
const EY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
const W9 = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];
const UMAX2 = 0.16 * 0.16;
const TAU_MIN = 0.515;
const CHANNEL_W = 3.2;
const COLOR_SCALE = 42; // vorticity → colour intensity
const KEYS = ['reynolds', 'speed'];
const DEFAULTS: Record<string, number> = { reynolds: 180, speed: 0.08 };

export const gpuKarman: GpuFactory = (count, _dt0, params): GpuSim => {
  const W = Math.max(32, Math.round(2 * Math.sqrt(count)));
  const H = Math.max(8, Math.round(count / W));
  const cells = W * H;
  const D = Math.max(2, Math.round(H / 5));
  const cxC = Math.floor(W * 0.24);
  const cyC = Math.floor(H / 2) - Math.max(1, Math.round(H * 0.04));
  const r2 = (D / 2) * (D / 2);
  const scaleX = CHANNEL_W / (W - 1);
  const halfW = CHANNEL_W / 2;
  const halfH = (CHANNEL_W * H) / W / 2;

  const fA: GpuNode = attributeArray(cells * 9, 'float');
  const fB: GpuNode = attributeArray(cells * 9, 'float');
  const vel: GpuNode = attributeArray(cells, 'vec2');
  const vort: GpuNode = attributeArray(cells, 'float');

  const u: Record<string, GpuNode> = {};
  for (const k of KEYS) u[k] = uniform(params[k] ?? DEFAULTS[k]);

  // equilibrium distribution for direction i (constants EX/EY/W9 baked at build)
  const feq = (i: number, rho: GpuNode, ux: GpuNode, uy: GpuNode): GpuNode => {
    const cu = ux.mul(EX[i]).add(uy.mul(EY[i]));
    const u2 = ux.mul(ux).add(uy.mul(uy));
    return rho.mul(W9[i]).mul(float(1).add(cu.mul(3)).add(cu.mul(cu).mul(4.5)).sub(u2.mul(1.5)));
  };
  // cylinder + top/bottom walls
  const isSolid = (xN: GpuNode, yN: GpuNode): GpuNode => {
    const wall = yN.lessThan(1).or(yN.greaterThan(H - 2));
    const dx = float(xN).sub(cxC);
    const dy = float(yN).sub(cyC);
    return wall.or(dx.mul(dx).add(dy.mul(dy)).lessThanEqual(r2));
  };
  const rhoOf = (fv: GpuNode[]): GpuNode => {
    let r = fv[0];
    for (let i = 1; i < 9; i++) r = r.add(fv[i]);
    return r;
  };
  const mxOf = (f: GpuNode[]): GpuNode => f[1].sub(f[3]).add(f[5]).sub(f[6]).sub(f[7]).add(f[8]);
  const myOf = (f: GpuNode[]): GpuNode => f[2].sub(f[4]).add(f[5]).add(f[6]).sub(f[7]).sub(f[8]);

  // --- init: equilibrium uniform rightward flow everywhere ---
  const init: GpuNode = (Fn(() => {
    const base = instanceIndex.mul(9);
    for (let i = 0; i < 9; i++) fA.element(base.add(i)).assign(feq(i, float(1), float(DEFAULTS.speed), float(0)));
  })() as GpuNode).compute(cells);

  // --- pass 1: equilibrium inflow (x=0) + zero-gradient outflow (x=W-1) ---
  const applyBC: GpuNode = (Fn(() => {
    const c = instanceIndex;
    const x = c.mod(W);
    const base = c.mul(9);
    If(x.lessThan(1), () => {
      for (let i = 0; i < 9; i++) fA.element(base.add(i)).assign(feq(i, float(1), u.speed, float(0)));
    });
    If(x.greaterThan(W - 2), () => {
      const src = c.sub(1).mul(9);
      for (let i = 0; i < 9; i++) fA.element(base.add(i)).assign(fA.element(src.add(i)));
    });
  })() as GpuNode).compute(cells);

  // --- pass 2: BGK collision on interior fluid cells ---
  const collide: GpuNode = (Fn(() => {
    const c = instanceIndex;
    const x = c.mod(W);
    const y = c.div(W);
    const interior = x.greaterThan(0).and(x.lessThan(W - 1)).and(y.greaterThan(0)).and(y.lessThan(H - 1));
    If(isSolid(x, y).not().and(interior), () => {
      const base = c.mul(9);
      const fv: GpuNode[] = [];
      for (let i = 0; i < 9; i++) fv[i] = fA.element(base.add(i)).toVar();
      const rho = rhoOf(fv).max(1e-6).toVar();
      const ux = mxOf(fv).div(rho).toVar();
      const uy = myOf(fv).div(rho).toVar();
      const fac = float(UMAX2).div(ux.mul(ux).add(uy.mul(uy)).max(1e-9)).sqrt().min(1);
      ux.assign(ux.mul(fac));
      uy.assign(uy.mul(fac));
      const nu = u.speed.mul(D).div(u.reynolds.max(1));
      const invTau = nu.mul(3).add(0.5).max(TAU_MIN).reciprocal();
      for (let i = 0; i < 9; i++) fA.element(base.add(i)).assign(fv[i].add(feq(i, rho, ux, uy).sub(fv[i]).mul(invTau)));
    });
  })() as GpuNode).compute(cells);

  // --- pass 3: streaming (pull) with halfway bounce-back ---
  const stream: GpuNode = (Fn(() => {
    const c = instanceIndex;
    const x = c.mod(W);
    const y = c.div(W);
    const base = c.mul(9);
    const boundary = isSolid(x, y).or(x.lessThan(1)).or(x.greaterThan(W - 2));
    If(boundary, () => {
      for (let i = 0; i < 9; i++) fB.element(base.add(i)).assign(fA.element(base.add(i)));
    }).Else(() => {
      for (let i = 0; i < 9; i++) {
        const sx = x.sub(EX[i]);
        const sy = y.sub(EY[i]);
        const sc = sy.mul(W).add(sx);
        fB.element(base.add(i)).assign(select(isSolid(sx, sy), fA.element(base.add(OPP[i])), fA.element(sc.mul(9).add(i))));
      }
    });
  })() as GpuNode).compute(cells);

  // --- pass 4: copy fB → fA ---
  const copy: GpuNode = (Fn(() => {
    fA.element(instanceIndex).assign(fB.element(instanceIndex));
  })() as GpuNode).compute(cells * 9);

  // --- pass 5: macroscopic velocity ---
  const computeU: GpuNode = (Fn(() => {
    const c = instanceIndex;
    const x = c.mod(W);
    const y = c.div(W);
    If(isSolid(x, y), () => {
      vel.element(c).assign(vec2(0, 0));
    }).Else(() => {
      const base = c.mul(9);
      const fv: GpuNode[] = [];
      for (let i = 0; i < 9; i++) fv[i] = fA.element(base.add(i)).toVar();
      const rho = rhoOf(fv).max(1e-6);
      vel.element(c).assign(vec2(mxOf(fv).div(rho), myOf(fv).div(rho)));
    });
  })() as GpuNode).compute(cells);

  // --- pass 6: vorticity (curl of velocity) ---
  const computeVort: GpuNode = (Fn(() => {
    const c = instanceIndex;
    const x = c.mod(W);
    const y = c.div(W);
    const interior = x.greaterThan(0).and(x.lessThan(W - 1)).and(y.greaterThan(0)).and(y.lessThan(H - 1));
    If(interior, () => {
      const w = vel.element(c.add(1)).y.sub(vel.element(c.sub(1)).y).mul(0.5).sub(vel.element(c.add(W)).x.sub(vel.element(c.sub(W)).x).mul(0.5));
      vort.element(c).assign(w);
    }).Else(() => {
      vort.element(c).assign(0);
    });
  })() as GpuNode).compute(cells);

  // --- render: flat grid, coloured red(+)/blue(−) by vorticity ---
  const vortAttr: GpuNode = vort.toAttribute();
  const px = float(vertexIndex.mod(W)).mul(scaleX).sub(halfW);
  const py = float(vertexIndex.div(W)).mul(scaleX).sub(halfH);
  const v = vortAttr.mul(COLOR_SCALE).clamp(-1, 1);

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending; // glow like the other systems
  material.opacity = 0.95;
  material.size = scaleX * 3.6; // big overlap so the grid reads as a solid field, not speckles
  material.sizeAttenuation = true;
  material.positionNode = vec3(px, 0, py); // horizontal field: elevated default camera views it top-down
  // red(+)/blue(−) by vorticity, brightened so the shed vortices pop against black
  material.colorNode = vec3(1.0, 0.45, 0.13).mul(v.max(0)).add(vec3(0.2, 0.55, 1.0).mul(v.min(0).negate())).mul(1.9);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cells * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [applyBC, collide, stream, copy, computeU, computeVort],
    substeps: 4,
    particleCount: cells,
    pointSize: scaleX * 1.7,
    setParams(p: Record<string, number>): void {
      for (const k of KEYS) if (k in p) u[k].value = p[k];
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
};

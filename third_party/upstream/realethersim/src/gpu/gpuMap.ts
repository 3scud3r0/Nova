import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attributeArray, color, float, Fn, hash, instanceIndex, mix, sign, uniform, vec3 } from 'three/tsl';
import type { GpuFactory, GpuNode, GpuSim } from './types';

// GPU-resident iterated maps: one map iteration per compute dispatch over a per-vertex storage
// buffer; points render straight from the buffer (no readback). TSL twins of the CPU iteratedMap
// formulas. 2D maps keep z = 0; Pickover is 3D. Particles are seeded near the on-attractor init so
// escape-prone maps (Hénon/Tinkerbell/Ikeda) stay in-basin.
interface GpuMapSystem {
  paramKeys: string[];
  defaults: Record<string, number>;
  iterate: (X: GpuNode, u: Record<string, GpuNode>) => GpuNode; // returns next state vec3
  seedRange: [number, number, number];
  seedOffset: [number, number, number];
  scale: number;
  center: [number, number, number];
  pointSize: number;
}

// Relief constants — MUST match iteratedMap.ts (CPU/GPU twins) so the face-on image is identical.
const DEPTH_FREQ = 1.7; // eggcrate frequency (attractor-image maps)
const DEPTH_AMP = 0.5;
const RADIAL_FREQ = 4.5; // concentric-ripple frequency (icons — radial relief preserves N-fold symmetry)
const RADIAL_AMP = 0.4;
const GPU_RADIAL = new Set([
  'icon-sanddollar', 'icon-trinity', 'icon-pentagram', 'icon-hexagon', 'icon-heptagon', 'icon-clamshell',
]);
// Canonical phase portraits + pickover (true-3D): no relief at all.
const GPU_FLAT = new Set(['tinkerbell', 'ikeda', 'henon', 'lozi', 'standard', 'zaslavsky', 'pickover']);

export const GPU_MAPS: Record<string, GpuMapSystem> = {
  clifford: {
    paramKeys: ['a', 'b', 'c', 'd'], defaults: { a: -1.4, b: 1.7, c: 1, d: 0.7 },
    iterate: (X, u) => vec3(u.a.mul(X.y).sin().add(u.c.mul(u.a.mul(X.x).cos())), u.b.mul(X.x).sin().add(u.d.mul(u.b.mul(X.y).cos())), 0),
    seedRange: [0.2, 0.2, 0], seedOffset: [0.1, 0.1, 0], scale: 0.625, center: [0, 0, 0], pointSize: 0.01,
  },
  'de-jong': {
    paramKeys: ['a', 'b', 'c', 'd'], defaults: { a: 1.4, b: -2.3, c: 2.4, d: -2.1 },
    iterate: (X, u) => vec3(u.a.mul(X.y).sin().sub(u.b.mul(X.x).cos()), u.c.mul(X.x).sin().sub(u.d.mul(X.y).cos()), 0),
    seedRange: [0.2, 0.2, 0], seedOffset: [0.1, 0.1, 0], scale: 0.75, center: [0, 0, 0], pointSize: 0.01,
  },
  svensson: {
    paramKeys: ['a', 'b', 'c', 'd'], defaults: { a: 1.4, b: 1.56, c: 1.4, d: -6.56 },
    iterate: (X, u) => vec3(u.d.mul(u.a.mul(X.x).sin()).sub(u.b.mul(X.y).sin()), u.c.mul(u.a.mul(X.x).cos()).add(u.b.mul(X.y).cos()), 0),
    seedRange: [0.2, 0.2, 0], seedOffset: [0.1, 0.1, 0], scale: 0.197, center: [0, 0, 0], pointSize: 0.01,
  },
  hopalong: {
    paramKeys: ['a', 'b', 'c'], defaults: { a: 0.4, b: 1, c: 0 },
    iterate: (X, u) => vec3(X.y.sub(sign(X.x).mul(u.b.mul(X.x).sub(u.c).abs().sqrt())), u.a.sub(X.x), 0),
    seedRange: [0.5, 0.5, 0], seedOffset: [0, 0, 0], scale: 0.05, center: [0, 0, 0], pointSize: 0.01,
  },
  'gumowski-mira': {
    paramKeys: ['a', 'b'], defaults: { a: -0.2, b: 1 },
    iterate: (X, u) => {
      const gm = (v: GpuNode): GpuNode => u.a.mul(v).add(float(2).mul(float(1).sub(u.a)).mul(v.mul(v)).div(float(1).add(v.mul(v))));
      const nx = u.b.mul(X.y).add(gm(X.x));
      return vec3(nx, X.x.negate().add(gm(nx)), 0);
    },
    seedRange: [0.3, 0.3, 0], seedOffset: [1, 1, 0], scale: 0.075, center: [0, 0, 0], pointSize: 0.01,
  },
  tinkerbell: {
    paramKeys: ['a', 'b', 'c', 'd'], defaults: { a: 0.9, b: -0.6013, c: 2, d: 0.5 },
    iterate: (X, u) => vec3(
      X.x.mul(X.x).sub(X.y.mul(X.y)).add(u.a.mul(X.x)).add(u.b.mul(X.y)),
      X.x.mul(X.y).mul(2).add(u.c.mul(X.x)).add(u.d.mul(X.y)),
      0,
    ),
    seedRange: [0.04, 0.04, 0], seedOffset: [-0.72, -0.64, 0], scale: 1.36, center: [-0.4, -0.7, 0], pointSize: 0.01,
  },
  ikeda: {
    paramKeys: ['u'], defaults: { u: 0.918 },
    iterate: (X, u) => {
      // t = 0.4 − 6 / (1 + x² + y²), built from the (loose) state nodes to stay scalar-typed.
      const t = X.x.mul(X.x).add(X.y.mul(X.y)).add(1).reciprocal().mul(-6).add(0.4);
      return vec3(
        u.u.mul(X.x.mul(t.cos()).sub(X.y.mul(t.sin()))).add(1),
        u.u.mul(X.x.mul(t.sin()).add(X.y.mul(t.cos()))),
        0,
      );
    },
    seedRange: [0.3, 0.3, 0], seedOffset: [0.1, 0.1, 0], scale: 0.833, center: [0.75, -0.8, 0], pointSize: 0.01,
  },
  henon: {
    paramKeys: ['a', 'b'], defaults: { a: 1.4, b: 0.3 },
    iterate: (X, u) => vec3(X.y.add(1).sub(u.a.mul(X.x.mul(X.x))), u.b.mul(X.x), 0),
    seedRange: [0.05, 0.05, 0], seedOffset: [0.1, 0.1, 0], scale: 1.0, center: [0, 0, 0], pointSize: 0.01,
  },
  lozi: {
    paramKeys: ['a', 'b'], defaults: { a: 1.7, b: 0.5 },
    iterate: (X, u) => vec3(X.x.abs().mul(u.a).negate().add(1).add(X.y), u.b.mul(X.x), 0),
    seedRange: [0.05, 0.05, 0], seedOffset: [0.1, 0.1, 0], scale: 1.25, center: [0.2, 0.1, 0], pointSize: 0.01,
  },
  bedhead: {
    paramKeys: ['a', 'b'], defaults: { a: 0.65343, b: 0.7345345 },
    iterate: (X, u) => vec3(
      X.x.mul(X.y).div(u.b).sin().mul(X.y).add(u.a.mul(X.x).sub(X.y).cos()),
      X.x.add(X.y.sin().div(u.b)),
      0,
    ),
    seedRange: [0.1, 0.1, 0], seedOffset: [1, 1, 0], scale: 0.88, center: [0.2, 0.7, 0], pointSize: 0.01,
  },
  pickover: {
    paramKeys: ['a', 'b', 'c', 'd', 'e'], defaults: { a: 2.24, b: 0.43, c: -0.65, d: -2.43, e: 1 },
    iterate: (X, u) => vec3(
      u.a.mul(X.y).sin().sub(X.z.mul(u.b.mul(X.x).cos())),
      X.z.mul(u.c.mul(X.x).sin()).sub(u.d.mul(X.y).cos()),
      u.e.mul(X.x.sin()),
    ),
    seedRange: [0.2, 0.2, 0.2], seedOffset: [0.1, 0.1, 0.1], scale: 0.68, center: [0, 0, 0], pointSize: 0.01,
  },
  'icon-sanddollar': {
    paramKeys: ['lambda', 'alpha', 'beta', 'gamma', 'omega'], defaults: { lambda: -2.34, alpha: 2.0, beta: 0.2, gamma: 0.1, omega: 0 },
    iterate: (X, u) => {
      // (zr, zi) = (x + iy)^4, unrolled via two complex squarings.
      const zzbar = X.x.mul(X.x).add(X.y.mul(X.y));
      const a2 = X.x.mul(X.x).sub(X.y.mul(X.y));
      const b2 = X.x.mul(X.y).mul(2);
      const zr = a2.mul(a2).sub(b2.mul(b2));
      const zi = a2.mul(b2).mul(2);
      const zn = X.x.mul(zr).sub(X.y.mul(zi));
      const f = u.lambda.add(u.alpha.mul(zzbar)).add(u.beta.mul(zn));
      return vec3(
        f.mul(X.x).add(u.gamma.mul(zr)).sub(u.omega.mul(X.y)),
        f.mul(X.y).sub(u.gamma.mul(zi)).add(u.omega.mul(X.x)),
        0,
      );
    },
    seedRange: [0.05, 0.05, 0], seedOffset: [0.01, 0.013, 0], scale: 1.4925, center: [0.0, 0.0, 0], pointSize: 0.007,
  },
  'icon-trinity': {
    paramKeys: ['lambda', 'alpha', 'beta', 'gamma', 'omega'], defaults: { lambda: 1.56, alpha: -1.0, beta: 0.1, gamma: -0.82, omega: 0.12 },
    iterate: (X, u) => {
      const zr = X.x.mul(X.x).sub(X.y.mul(X.y));      // Re(z^2) = x² − y²
      const zi = X.x.mul(X.y).mul(2);                  // Im(z^2) = 2xy
      const zzbar = X.x.mul(X.x).add(X.y.mul(X.y));    // x² + y²
      const zn = X.x.mul(zr).sub(X.y.mul(zi));         // Re(z^3)
      const pp = u.lambda.add(u.alpha.mul(zzbar)).add(u.beta.mul(zn));
      return vec3(
        pp.mul(X.x).add(u.gamma.mul(zr)).sub(u.omega.mul(X.y)),
        pp.mul(X.y).sub(u.gamma.mul(zi)).add(u.omega.mul(X.x)),
        0,
      );
    },
    seedRange: [0.1, 0.1, 0], seedOffset: [0.01, 0.013, 0], scale: 1.1111, center: [0.0, 0.0, 0], pointSize: 0.007,
  },
  'icon-pentagram': {
    paramKeys: ['lambda', 'alpha', 'beta', 'gamma', 'omega'], defaults: { lambda: 2.6, alpha: -2.0, beta: 0.0, gamma: -0.5, omega: 0.0 },
    iterate: (X, u) => {
      const x2 = X.x.mul(X.x);
      const y2 = X.y.mul(X.y);
      const zr = x2.mul(x2).sub(x2.mul(y2).mul(6)).add(y2.mul(y2)); // Re((x+iy)^4)
      const zi = X.x.mul(X.y).mul(4).mul(x2.sub(y2)); // Im((x+iy)^4)
      const zzbar = x2.add(y2);
      const zn = X.x.mul(zr).sub(X.y.mul(zi)); // Re(z^5)
      const pp = u.lambda.add(u.alpha.mul(zzbar)).add(u.beta.mul(zn));
      return vec3(
        pp.mul(X.x).add(u.gamma.mul(zr)).sub(u.omega.mul(X.y)),
        pp.mul(X.y).sub(u.gamma.mul(zi)).add(u.omega.mul(X.x)),
        0,
      );
    },
    seedRange: [0.1, 0.1, 0], seedOffset: [0.01, 0.01, 0], scale: 1.1538, center: [0.0, 0.0, 0], pointSize: 0.007,
  },
  'icon-hexagon': {
    paramKeys: ['lambda', 'alpha', 'beta', 'gamma', 'omega'], defaults: { lambda: -2.5, alpha: 5.0, beta: -1.9, gamma: 1.0, omega: 0.188 },
    iterate: (X, u) => {
      const zzbar = X.x.mul(X.x).add(X.y.mul(X.y));
      const x2 = X.x.mul(X.x).sub(X.y.mul(X.y));
      const y2 = float(2).mul(X.x).mul(X.y);
      const x4 = x2.mul(x2).sub(y2.mul(y2));
      const y4 = float(2).mul(x2).mul(y2);
      const zr = x4.mul(X.x).sub(y4.mul(X.y));
      const zi = x4.mul(X.y).add(y4.mul(X.x));
      const zn = X.x.mul(zr).sub(X.y.mul(zi));
      const pp = u.lambda.add(u.alpha.mul(zzbar)).add(u.beta.mul(zn));
      return vec3(
        pp.mul(X.x).add(u.gamma.mul(zr)).sub(u.omega.mul(X.y)),
        pp.mul(X.y).sub(u.gamma.mul(zi)).add(u.omega.mul(X.x)),
        0,
      );
    },
    seedRange: [0.05, 0.05, 0], seedOffset: [0.01, 0.013, 0], scale: 2.0833, center: [0.0, 0.0, 0], pointSize: 0.007,
  },
  'icon-heptagon': {
    paramKeys: ['lambda', 'alpha', 'beta', 'gamma', 'omega'], defaults: { lambda: 2.5, alpha: -2.5, beta: 0.0, gamma: 0.9, omega: 0.0 },
    iterate: (X, u) => {
      const zzbar = X.x.mul(X.x).add(X.y.mul(X.y));
      // (X.x + i X.y)^6 unrolled (degree n-1 = 6 for n = 7)
      const z2r = X.x.mul(X.x).sub(X.y.mul(X.y)), z2i = X.x.mul(X.y).mul(2);
      const z3r = z2r.mul(X.x).sub(z2i.mul(X.y)), z3i = z2r.mul(X.y).add(z2i.mul(X.x));
      const z4r = z3r.mul(X.x).sub(z3i.mul(X.y)), z4i = z3r.mul(X.y).add(z3i.mul(X.x));
      const z5r = z4r.mul(X.x).sub(z4i.mul(X.y)), z5i = z4r.mul(X.y).add(z4i.mul(X.x));
      const zr = z5r.mul(X.x).sub(z5i.mul(X.y)), zi = z5r.mul(X.y).add(z5i.mul(X.x));
      const zn = zr.mul(X.x).sub(zi.mul(X.y)); // Re((X.x + i X.y)^7)
      const p = u.lambda.add(u.alpha.mul(zzbar)).add(u.beta.mul(zn));
      return vec3(
        p.mul(X.x).add(u.gamma.mul(zr)).sub(u.omega.mul(X.y)),
        p.mul(X.y).sub(u.gamma.mul(zi)).add(u.omega.mul(X.x)),
        0,
      );
    },
    seedRange: [0.1, 0.1, 0], seedOffset: [0.01, 0.013, 0], scale: 1.4851, center: [0.0, 0.0, 0], pointSize: 0.007,
  },
  'icon-clamshell': {
    paramKeys: ['lambda', 'alpha', 'beta', 'gamma', 'omega'], defaults: { lambda: -1.86, alpha: 2.0, beta: 0.0, gamma: 1.0, omega: 0.1 },
    iterate: (X, u) => {
      const zr = X.x.mul(X.x).mul(X.x).sub(X.x.mul(X.y).mul(X.y).mul(3));
      const zi = X.x.mul(X.x).mul(X.y).mul(3).sub(X.y.mul(X.y).mul(X.y));
      const zn = X.x.mul(zr).sub(X.y.mul(zi));
      const zzbar = X.x.mul(X.x).add(X.y.mul(X.y));
      const p = u.lambda.add(u.alpha.mul(zzbar)).add(u.beta.mul(zn));
      return vec3(
        p.mul(X.x).add(u.gamma.mul(zr)).sub(u.omega.mul(X.y)),
        p.mul(X.y).sub(u.gamma.mul(zi)).add(u.omega.mul(X.x)),
        0,
      );
    },
    seedRange: [0.05, 0.05, 0], seedOffset: [0.01, 0.013, 0], scale: 1.6667, center: [0.0, 0.0, 0], pointSize: 0.007,
  },
  gingerbreadman: {
    paramKeys: ['s'], defaults: { s: 1 },
    iterate: (X, u) => vec3(u.s.mul(X.x.abs()).sub(X.y).add(1), X.x, 0),
    seedRange: [4, 4, 0], seedOffset: [-0.1, 0, 0], scale: 0.2727, center: [2.5, 2.5, 0], pointSize: 0.01,
  },
  standard: {
    paramKeys: ['K'], defaults: { K: 1.2 },
    iterate: (X, u) => {
      const TAU = float(2 * Math.PI);
      const mod = (v: GpuNode): GpuNode => v.sub(v.div(TAU).floor().mul(TAU)); // v mod 2π, result in [0,2π)
      const np = mod(X.y.add(u.K.mul(X.x.sin())));
      const nx = mod(X.x.add(np));
      return vec3(nx, np, 0);
    },
    seedRange: [6, 6, 0], seedOffset: [Math.PI, Math.PI, 0], scale: 0.4774648292756861, center: [Math.PI, Math.PI, 0], pointSize: 0.006,
  },
  'duffing-map': {
    paramKeys: ['a', 'b'], defaults: { a: 2.75, b: 0.2 },
    iterate: (X, u) => vec3(X.y, u.b.mul(X.x).negate().add(u.a.mul(X.y)).sub(X.y.mul(X.y).mul(X.y)), 0),
    seedRange: [0.1, 0.1, 0], seedOffset: [0.1, 0.1, 0], scale: 0.8571, center: [0.0, 0.0, 0], pointSize: 0.01,
  },
  'kings-dream': {
    paramKeys: ['a', 'b', 'c', 'd'], defaults: { a: -0.966, b: 2.879, c: 0.765, d: 0.744 },
    iterate: (X, u) => vec3(u.b.mul(X.y).sin().add(u.c.mul(u.b.mul(X.x).sin())), u.a.mul(X.x).sin().add(u.d.mul(u.a.mul(X.y).sin())), 0),
    seedRange: [0.1, 0.1, 0], seedOffset: [0.1, 0.1, 0], scale: 0.8333, center: [0.0, 0.0, 0], pointSize: 0.01,
  },
  'sprott-quadratic': {
    paramKeys: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11'],
    defaults: { a0: 1, a1: -0.8, a2: -0.7, a3: -0.1, a4: -0.7, a5: 0.1, a6: 1.1, a7: -0.3, a8: -0.5, a9: 0, a10: -0.9, a11: 0.2 },
    iterate: (X, u) => vec3(
      u.a0.add(u.a1.mul(X.x)).add(u.a2.mul(X.x.mul(X.x))).add(u.a3.mul(X.x.mul(X.y))).add(u.a4.mul(X.y)).add(u.a5.mul(X.y.mul(X.y))),
      u.a6.add(u.a7.mul(X.x)).add(u.a8.mul(X.x.mul(X.x))).add(u.a9.mul(X.x.mul(X.y))).add(u.a10.mul(X.y)).add(u.a11.mul(X.y.mul(X.y))),
      0,
    ),
    seedRange: [0.05, 0.05, 0], seedOffset: [0.05, 0.05, 0], scale: 0.813, center: [-0.379, 0.132, 0], pointSize: 0.01,
  },
  zaslavsky: {
    paramKeys: ['nu', 'eps', 'gamma'], defaults: { nu: 0.5, eps: 1.0, gamma: 0.8 },
    iterate: (X, u) => {
      const emg = u.gamma.negate().exp();
      const mu = float(1).sub(emg).div(u.gamma);
      const c = X.x.mul(float(Math.PI * 2)).cos();
      const n = X.x.add(u.nu.mul(float(1).add(mu.mul(X.y)))).add(u.eps.mul(u.nu).mul(mu).mul(c));
      return vec3(n.sub(n.floor()), emg.mul(X.y.add(u.eps.mul(c))), 0);
    },
    seedRange: [0.1, 0.1, 0], seedOffset: [0.1, 0.1, 0], scale: 3.0, center: [0.5, 0.0, 0], pointSize: 0.01,
  },
  martin: {
    paramKeys: ['a'], defaults: { a: 4 },
    iterate: (X, u) => vec3(X.y.sub(X.x.sin()), u.a.sub(X.x), 0),
    seedRange: [0.5, 0.5, 0], seedOffset: [0, 0, 0], scale: 0.3, center: [2.5, 1.5, 0], pointSize: 0.01,
  },
};

function buildGpuMap(sys: GpuMapSystem, count: number, depth: number, radialDepth: number): GpuSim {
  const pos: GpuNode = attributeArray(count, 'vec3');
  const u: Record<string, GpuNode> = {};
  for (const k of sys.paramKeys) u[k] = uniform(sys.defaults[k]);

  const [rx, ry, rz] = sys.seedRange;
  const [ox, oy, oz] = sys.seedOffset;
  const init: GpuNode = (Fn(() => {
    const p = pos.element(instanceIndex);
    const r1 = hash(instanceIndex.mul(3));
    const r2 = hash(instanceIndex.mul(3).add(1));
    const r3 = hash(instanceIndex.mul(3).add(2));
    p.assign(vec3(r1.sub(0.5).mul(rx).add(ox), r2.sub(0.5).mul(ry).add(oy), r3.sub(0.5).mul(rz).add(oz)));
  })() as GpuNode).compute(count);

  const step: GpuNode = (Fn(() => {
    const p = pos.element(instanceIndex);
    const x0 = p.toVar();
    p.assign(sys.iterate(x0, u));
  })() as GpuNode).compute(count);

  const attr: GpuNode = pos.toAttribute();
  const c = sys.center;
  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.85;
  const rp = attr.sub(vec3(c[0], c[1], c[2])).mul(sys.scale).toVar();
  // Relief mirrors the CPU twin exactly so the face-on X-Y image is identical. Attractor-image maps drape
  // over an eggcrate; icons get a RADIAL relief (z=f(R) ⇒ N-fold symmetry preserved); flat maps keep z.
  if (depth > 0) {
    material.positionNode = vec3(rp.x, rp.y, rp.x.mul(DEPTH_FREQ).sin().mul(rp.y.mul(DEPTH_FREQ).sin()).mul(float(depth)));
  } else if (radialDepth > 0) {
    const R = rp.x.mul(rp.x).add(rp.y.mul(rp.y)).sqrt().toVar();
    const zr = R.mul(RADIAL_FREQ).cos().mul(float(1).sub(R.mul(0.45)).max(0)).mul(float(radialDepth));
    material.positionNode = vec3(rp.x, rp.y, zr);
  } else {
    material.positionNode = rp;
  }
  material.colorNode = mix(color(0x4ad6c8), color(0xff8a4a), attr.x.mul(0.3).add(0.5).clamp(0, 1));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    init,
    steps: [step],
    substeps: 2,
    particleCount: count,
    pointSize: sys.pointSize,
    setParams(p: Record<string, number>): void {
      for (const k of sys.paramKeys) if (k in p) u[k].value = p[k];
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function makeGpuMap(id: string): GpuFactory {
  const sys = GPU_MAPS[id];
  const radial = GPU_RADIAL.has(id);
  const depth = (GPU_FLAT.has(id) || radial) ? 0 : DEPTH_AMP; // attractor-images get eggcrate; icons radial; rest flat
  const radialDepth = radial ? RADIAL_AMP : 0;
  return (count) => buildGpuMap(sys, count, depth, radialDepth);
}

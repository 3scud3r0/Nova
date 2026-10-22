import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as tsl from 'three/tsl';
import type { RaymarchKind, RaymarchSystem } from '../archetypes/raymarchFractal';

// TSL graph nodes are dynamically typed (see gpu/types.ts `GpuNode = any`). We pull the builder
// functions in untyped so hand-authored SDF chains (heavy on swizzles and free math fns) don't
// fight the strict bundled .d.ts overloads. Correctness is verified at runtime in the browser.
type Node = any;
const {
  Fn,
  Loop,
  If,
  Break,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  abs,
  acos,
  atan,
  clamp,
  cos,
  log,
  log2,
  max,
  min,
  mix,
  mod,
  normalize,
  pow,
  select,
  sin,
  screenUV,
  cameraPosition,
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  positionGeometry,
  cross,
  length,
  dot,
  sqrt,
  fract,
  floor,
  smoothstep,
  exp,
  tanh,
  fwidth,
} = tsl as any;

export interface RaymarchPass {
  mesh: THREE.Mesh;
  cameraDistance: number;
  setParams(p: Record<string, number>): void;
  update(elapsedSeconds: number): void;
  dispose(): void;
}

// ── quaternion helpers (for the Julia DE) ──
const qmul = Fn(([a, b]: [Node, Node]) =>
  vec4(
    a.x.mul(b.x).sub(a.y.mul(b.y)).sub(a.z.mul(b.z)).sub(a.w.mul(b.w)),
    a.x.mul(b.y).add(a.y.mul(b.x)).add(a.z.mul(b.w)).sub(a.w.mul(b.z)),
    a.x.mul(b.z).sub(a.y.mul(b.w)).add(a.z.mul(b.x)).add(a.w.mul(b.y)),
    a.x.mul(b.w).add(a.y.mul(b.z)).sub(a.z.mul(b.y)).add(a.w.mul(b.x)),
  ),
);
const qsqr = Fn(([q]: [Node]) =>
  vec4(
    q.x.mul(q.x).sub(q.y.mul(q.y)).sub(q.z.mul(q.z)).sub(q.w.mul(q.w)),
    q.x.mul(q.y).mul(2),
    q.x.mul(q.z).mul(2),
    q.x.mul(q.w).mul(2),
  ),
);

// rotate a vec3 about the Y then X axes by the given angles (cheap, branchless)
const rotYX = Fn(([v, ay, ax]: [Node, Node, Node]) => {
  const cy = cos(ay);
  const sy = sin(ay);
  const p1 = vec3(v.x.mul(cy).add(v.z.mul(sy)), v.y, v.z.mul(cy).sub(v.x.mul(sy)));
  const cx = cos(ax);
  const sx = sin(ax);
  return vec3(p1.x, p1.y.mul(cx).sub(p1.z.mul(sx)), p1.y.mul(sx).add(p1.z.mul(cx)));
});

// signed distance to an axis-aligned box of half-extents b
const sdBox = Fn(([p, b]: [Node, Node]) => {
  const d = abs(p).sub(b);
  return max(d, vec3(0)).length().add(min(max(d.x, max(d.y, d.z)), 0));
});

// ── Procedural noise for the volumetric (Volume) systems: hash → 3D value noise → FBM → IQ domain
// warp. Pure straight-line expression graphs (no Loop/If), so they compose inside the per-pixel march.
// sin-free Hoskins hash (GPU-portable). value noise uses a quintic (C1) fade so it's smooth across cells.
const hash31 = Fn(([c]: [Node]) => {
  const p = fract(c.mul(0.1031)).toVar();
  p.addAssign(dot(p, p.yzx.add(33.33)));
  return fract(p.x.add(p.y).mul(p.z));
});
const vnoise = Fn(([p]: [Node]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10)).toVar(); // 6t⁵−15t⁴+10t³
  const c000 = hash31(i.add(vec3(0, 0, 0)));
  const c100 = hash31(i.add(vec3(1, 0, 0)));
  const c010 = hash31(i.add(vec3(0, 1, 0)));
  const c110 = hash31(i.add(vec3(1, 1, 0)));
  const c001 = hash31(i.add(vec3(0, 0, 1)));
  const c101 = hash31(i.add(vec3(1, 0, 1)));
  const c011 = hash31(i.add(vec3(0, 1, 1)));
  const c111 = hash31(i.add(vec3(1, 1, 1)));
  const x00 = mix(c000, c100, u.x);
  const x10 = mix(c010, c110, u.x);
  const x01 = mix(c001, c101, u.x);
  const x11 = mix(c011, c111, u.x);
  const y0 = mix(x00, x10, u.y);
  const y1 = mix(x01, x11, u.y);
  return mix(y0, y1, u.z); // [0,1]
});
// 2-D value noise (for the Onsager line-integral-convolution flow texture). Hash → bilinear
// smoothstep interpolation; sampling it ALONG a streamline turns white noise into flowing streaks.
const hash21 = Fn(([p]: [Node]) => fract(sin(dot(floor(p), vec2(127.1, 311.7))).mul(43758.5453)));
const vnoise2 = Fn(([p]: [Node]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f.mul(-2).add(3)).toVar(); // 3t²−2t³
  const a = hash21(i);
  const b = hash21(i.add(vec2(1, 0)));
  const c = hash21(i.add(vec2(0, 1)));
  const d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); // [0,1]
});
function makeFbm(OCT: number) {
  return Fn(([p]: [Node]) => {
    const pp = p.toVar();
    const sum = float(0).toVar();
    const amp = float(0.5).toVar();
    const norm = float(0).toVar();
    for (let o = 0; o < OCT; o++) {
      sum.addAssign(amp.mul(vnoise(pp)));
      norm.addAssign(amp);
      amp.mulAssign(0.5);
      pp.mulAssign(2.0);
    }
    return sum.div(norm); // [0,1]
  });
}
const fbm3 = makeFbm(3);
// cheap single-octave IQ domain warp (4 fbm calls) — plasma + tunnel
const warp1 = Fn(([p]: [Node]) => {
  const q = vec3(fbm3(p), fbm3(p.add(vec3(5.2, 1.3, 2.8))), fbm3(p.add(vec3(1.7, 9.2, 3.4)))).toVar();
  return fbm3(p.add(q.mul(4.0)));
});
// full recursive IQ domain warp (7 fbm calls) — nebula only (flowing filaments are the whole look)
const warpFull = Fn(([p]: [Node]) => {
  const q = vec3(fbm3(p), fbm3(p.add(vec3(5.2, 1.3, 2.8))), fbm3(p.add(vec3(1.7, 9.2, 3.4)))).toVar();
  const pq = p.add(q.mul(4.0)).toVar();
  const r = vec3(
    fbm3(pq.add(vec3(1.7, 9.2, 8.3))),
    fbm3(pq.add(vec3(8.3, 2.8, 1.7))),
    fbm3(pq.add(vec3(2.6, 6.1, 5.4))),
  ).toVar();
  return fbm3(p.add(r.mul(4.0)));
});

// Build the distance-estimator for one fractal. Returns a TSL Fn(p) -> vec2(distance, orbitTrap).
// All loops are compile-time bounded with an escape Break; every divide/log is guarded so a single
// NaN can't poison the whole ray.
// ── implicit-surface fields F(c): the rendered surface is the level set F = isovalue ──
const cheb8 = (x: Node): Node => {
  const x2 = x.mul(x);
  const x4 = x2.mul(x2);
  const x6 = x4.mul(x2);
  const x8 = x4.mul(x4);
  return x8.mul(128).sub(x6.mul(256)).add(x4.mul(160)).sub(x2.mul(32)).add(1); // Chebyshev T₈
};
const surfaceField = (kind: string, c: Node): Node => {
  const x = c.x;
  const y = c.y;
  const z = c.z;
  if (kind === 'gyroid') return sin(x).mul(cos(y)).add(sin(y).mul(cos(z))).add(sin(z).mul(cos(x)));
  if (kind === 'schwarzP') return cos(x).add(cos(y)).add(cos(z));
  if (kind === 'schwarzD')
    return sin(x).mul(sin(y)).mul(sin(z))
      .add(sin(x).mul(cos(y)).mul(cos(z)))
      .add(cos(x).mul(sin(y)).mul(cos(z)))
      .add(cos(x).mul(cos(y)).mul(sin(z)));
  if (kind === 'schoenIWP')
    return cos(x).mul(cos(y)).add(cos(y).mul(cos(z))).add(cos(z).mul(cos(x))).mul(2)
      .sub(cos(x.mul(2)).add(cos(y.mul(2))).add(cos(z.mul(2))));
  if (kind === 'neovius')
    return cos(x).add(cos(y)).add(cos(z)).mul(3).add(cos(x).mul(cos(y)).mul(cos(z)).mul(4));
  if (kind === 'chmutov') return cheb8(x).add(cheb8(y)).add(cheb8(z)); // chmutov octic
  // ── algebraic surfaces (non-periodic; live inside the unit-ish ball) ──
  if (kind === 'heart') {
    // Taubin heart, cusp remapped to the world up-axis (formula z → world y) so it stands upright.
    const X = x, Y = z, Z = y;
    const X2 = X.mul(X), Y2 = Y.mul(Y), Z2 = Z.mul(Z), Z3 = Z2.mul(Z);
    const base = X2.add(Y2.mul(2.25)).add(Z2).sub(1);
    return base.mul(base).mul(base).sub(X2.mul(Z3)).sub(Y2.mul(Z3).mul(0.1125)); // (…)³ − x²z³ − 9/80 y²z³
  }
  if (kind === 'tanglecube') {
    const x2 = x.mul(x), y2 = y.mul(y), z2 = z.mul(z);
    return x2.mul(x2).sub(x2.mul(5)).add(y2.mul(y2)).sub(y2.mul(5)).add(z2.mul(z2)).sub(z2.mul(5)).add(11.8);
  }
  if (kind === 'goursat') {
    const x2 = x.mul(x), y2 = y.mul(y), z2 = z.mul(z);
    return x2.mul(x2).add(y2.mul(y2)).add(z2.mul(z2)).sub(1); // x⁴+y⁴+z⁴ = 1 (+iso) — rounded cube
  }
  if (kind === 'barth') {
    // Barth sextic — the golden-ratio 65-node surface. P = φ², (1+2φ) ≈ 4.236.
    const x2 = x.mul(x), y2 = y.mul(y), z2 = z.mul(z);
    const P = 2.6180339887;
    const t1 = x2.mul(P).sub(y2);
    const t2 = y2.mul(P).sub(z2);
    const t3 = z2.mul(P).sub(x2);
    const s = x2.add(y2).add(z2).sub(1);
    return t1.mul(t2).mul(t3).mul(4).sub(s.mul(s).mul(4.2360679));
  }
  if (kind === 'kummer') {
    // Kummer quartic (tetrahedroid), mu = 1.3 → 16 real nodes. s2 = sqrt(2).
    const mu2 = float(1.69); // mu = 1.3
    const lambda = float(3.1069); // (3*mu^2 - 1)/(3 - mu^2) at mu=1.3
    const s2 = float(1.4142135624);
    const r = x.mul(x).add(y.mul(y)).add(z.mul(z)).sub(mu2);
    const p1 = float(1).sub(z).sub(s2.mul(x));
    const p2 = float(1).sub(z).add(s2.mul(x));
    const p3 = float(1).add(z).add(s2.mul(y));
    const p4 = float(1).add(z).sub(s2.mul(y));
    const prod = p1.mul(p2).mul(p3).mul(p4);
    return r.mul(r).sub(lambda.mul(prod)); // (x²+y²+z²-μ²)² - λ·∏(planes)
  }
  if (kind === 'clebsch') {
    // Clebsch diagonal cubic — affine real form containing all 27 lines.
    const x2 = x.mul(x), y2 = y.mul(y), z2 = z.mul(z);
    const x3 = x2.mul(x), y3 = y2.mul(y), z3 = z2.mul(z);
    const cubes = x3.add(y3).add(z3);
    const mixed = x2.mul(y).add(x2.mul(z))
      .add(y2.mul(x)).add(y2.mul(z))
      .add(z2.mul(x)).add(z2.mul(y));
    const prod = x.mul(y).mul(z);
    const pairs = x.mul(y).add(y.mul(z)).add(z.mul(x));
    const sq = x2.add(y2).add(z2);
    const lin = x.add(y).add(z);
    return cubes.mul(81)
      .sub(mixed.mul(189))
      .add(prod.mul(54))
      .sub(pairs.mul(126))
      .add(sq.mul(9))
      .add(lin.mul(9))
      .sub(1); // 81Σx³ − 189Σx²y + 54xyz − 126Σxy + 9Σx² + 9Σx − 1
  }
  if (kind === 'cayley') {
    // Cayley's nodal cubic — 4 ordinary double points in tetrahedral arrangement.
    const x2 = x.mul(x), y2 = y.mul(y), z2 = z.mul(z);
    const cubic = x2.mul(y.add(z)).add(y2.mul(x.add(z))).add(z2.mul(x.add(y)));
    const quad = x.mul(y).add(y.mul(z)).add(z.mul(x));
    return cubic.mul(-5).add(quad.mul(2)); // -5·Σx²(y+z) + 2·Σxy
  }
  if (kind === 'fischerKoch')
    return cos(x.mul(2)).mul(sin(y)).mul(cos(z))
      .add(cos(y.mul(2)).mul(sin(z)).mul(cos(x)))
      .add(cos(z.mul(2)).mul(sin(x)).mul(cos(y))); // Fischer-Koch S nodal approximation
  if (kind === 'schwarzCLP')
    return cos(x.mul(2)).mul(cos(z)).add(cos(y.mul(2)).mul(sin(z))); // Schwarz CLP: cos2x·cosz + cos2y·sinz
  if (kind === 'togliatti') {
    // Togliatti quintic — the degree-5 surface with the maximal 31 ordinary double points.
    // Togliatti/Barth affine real form; the sqrt(5) terms give it pentagonal (icosahedral) symmetry.
    const s5 = float(2.2360679775); // sqrt(5)
    const x2 = x.mul(x), y2 = y.mul(y), z2 = z.mul(z);
    const x3 = x2.mul(x), x4 = x2.mul(x2), y4 = y2.mul(y2);
    // 64·(x−1)·(x⁴ − 4x³ − 10x²y² − 4x² + 16x − 20xy² + 5y⁴ + 16 − 20y²)
    const poly = x4
      .sub(x3.mul(4))
      .sub(x2.mul(y2).mul(10))
      .sub(x2.mul(4))
      .add(x.mul(16))
      .sub(x.mul(y2).mul(20))
      .add(y4.mul(5))
      .add(16)
      .sub(y2.mul(20));
    const t1 = x.sub(1).mul(poly).mul(64);
    // 5√5·(2z − √5 − 1)·(4(x²+y²−z²) + (1 + 3√5))²
    const inner = x2.add(y2).sub(z2).mul(4).add(s5.mul(3).add(1));
    const t2 = z.mul(2).sub(s5).sub(1).mul(inner.mul(inner)).mul(s5.mul(5));
    return t1.sub(t2); // 64(x−1)(…) − 5√5(2z−√5−1)(4(x²+y²−z²)+1+3√5)²
  }
  if (kind === 'whitneyUmbrella') {
    // Whitney umbrella — the canonical Whitney cross-cap: x² = y²·z.
    // Self-intersecting umbrella sheet for z>0 plus the singular handle line x=y=0, z<0.
    // The whole z-axis has vanishing gradient (∇F = (2x, −2yz, −y²) = 0 when x=y=0),
    // so the DE step is heavily under-relaxed and hard-capped to avoid overshoot.
    const x2 = x.mul(x), y2 = y.mul(y);
    return x2.sub(y2.mul(z)); // x² − y²z = iso
  }
  if (kind === 'tooth') {
    // Tooth / cushion quartic: x⁴+y⁴+z⁴ − (x²+y²+z²). Bounded body in [-1,1]³ with four
    // cusp-like dimples; the origin is a singular point (F=0, ∇F=0).
    const x2 = x.mul(x), y2 = y.mul(y), z2 = z.mul(z);
    return x2.mul(x2).add(y2.mul(y2)).add(z2.mul(z2)).sub(x2.add(y2).add(z2)); // x⁴+y⁴+z⁴ − (x²+y²+z²)
  }
  if (kind === 'lidinoid')
    return sin(x.mul(2)).mul(cos(y)).mul(sin(z))
      .add(sin(y.mul(2)).mul(cos(z)).mul(sin(x)))
      .add(sin(z.mul(2)).mul(cos(x)).mul(sin(y)))
      .mul(0.5)
      .sub(
        cos(x.mul(2)).mul(cos(y.mul(2)))
          .add(cos(y.mul(2)).mul(cos(z.mul(2))))
          .add(cos(z.mul(2)).mul(cos(x.mul(2))))
          .mul(0.5),
      )
      .add(0.15); // Lidinoid: ½Σ sin2x·cosy·sinz − ½Σ cos2x·cos2y + 0.15
  if (kind === 'dingDong') {
    // Ding-dong surface x²+y²−z²+z³, cusp axis remapped to world up (formula z → world y) so the
    // bell stands upright, plus a +0.5 recentre so the closed lobe (z∈[0,1]) frames around the origin.
    const X = x, Y = z;
    const Z = y.add(0.5);
    const Z2 = Z.mul(Z);
    return X.mul(X).add(Y.mul(Y)).sub(Z2).add(Z2.mul(Z)); // x²+y²−z²+z³
  }
  if (kind === 'dupinCyclide') {
    // Dupin ring cyclide — the inversion of a torus; every line of curvature is a circle.
    // Quartic (x²+y²+z²+b²−d²)² − 4(aX−cd)² − 4b²y² with a=1.9, c=1, b²=a²−c²=2.61, d=1.4
    // (a>d>c ⇒ ring cyclide). The body is off-axis (centre x≈−1), so X = x − 1 recentres it
    // on the origin for the bounding sphere / radial trap. Smooth (min|∇F|≈4.6 ⇒ no nodes).
    const a = float(1.9);
    const X = x.sub(1.0); // recentre: ring spans x∈[−4.3,2.3] about x=−1
    const s = X.mul(X).add(y.mul(y)).add(z.mul(z)).add(0.65); // …+ (b²−d²)=0.65
    const t = X.mul(a).sub(1.4); // aX − c·d  (c·d = 1.4)
    return s.mul(s).sub(t.mul(t).mul(4)).sub(y.mul(y).mul(10.44)); // s² − 4t² − 4b²y²  (4b²=10.44)
  }
  if (kind === 'orthocircle') {
    // Orthocircle — three mutually orthogonal ring-tubes (a=0.075, b=3). Each factor
    // ((u²+v²−1)²+w²) is a fattened unit ring in a coordinate plane; their product, minus
    // a²(1+b·r²), fuses the three rings into one smooth degree-12 surface. ∇F stays bounded
    // away from 0 on the surface (probe: |∇F|∈[0.14,0.79]), so no stepScale/maxStep needed.
    const x2 = x.mul(x), y2 = y.mul(y), z2 = z.mul(z);
    const r1 = x2.add(y2).sub(1), t1 = r1.mul(r1).add(z2); // ring in xy-plane (axis z)
    const r2 = y2.add(z2).sub(1), t2 = r2.mul(r2).add(x2); // ring in yz-plane (axis x)
    const r3 = z2.add(x2).sub(1), t3 = r3.mul(r3).add(y2); // ring in zx-plane (axis y)
    const rr = x2.add(y2).add(z2);
    // a² = 0.075² = 0.005625, a²·b = 0.005625·3 = 0.016875
    return t1.mul(t2).mul(t3).sub(float(0.005625).add(rr.mul(0.016875))); // ∏ringᵢ − a²(1+b·r²)
  }
  if (kind === 'decocube') {
    // Decocube — a rounded cube *frame* of 12 tube-edges, built as a product of three
    // intersecting-torus factors. r = 0.82 sets the tube offset, a² = 0.0004 (a = 0.02) the
    // tube thickness. Each factor ((·²+·²−r²)² + (·²−1)²) is a torus around one axis capped at ±1.
    const x2 = x.mul(x), y2 = y.mul(y), z2 = z.mul(z);
    const r2 = float(0.6724); // 0.82²
    const a2 = float(0.0004); // a = 0.02
    const f1 = x2.add(y2).sub(r2);
    const f2 = y2.add(z2).sub(r2);
    const f3 = z2.add(x2).sub(r2);
    const zc = z2.sub(1), xc = x2.sub(1), yc = y2.sub(1);
    const t1 = f1.mul(f1).add(zc.mul(zc));
    const t2 = f2.mul(f2).add(xc.mul(xc));
    const t3 = f3.mul(f3).add(yc.mul(yc));
    return t1.mul(t2).mul(t3).sub(a2); // ∏ tori − a²  → the 12-edge cube frame
  }
  if (kind === 'endrassOctic') {
    // Endraß octic — the degree-8 surface with 168 real nodes (the record for octics), w = 1.
    // A product of four planes minus the square of a degree-4 polynomial in (x²+y²) and z; the
    // √2 constants give the node cluster its 8-fold dihedral symmetry. ∇F vanishes at the 168
    // nodes and the field swings ~10⁴× across the surface, so the DE step is strongly under-relaxed
    // and hard-capped (like togliatti/barth/kummer) to avoid overshooting the pinch points.
    const s2 = float(1.4142135624); // √2
    const x2 = x.mul(x), y2 = y.mul(y), z2 = z.mul(z);
    const z4 = z2.mul(z2);
    const r2 = x2.add(y2);
    const sum = x.add(y), dif = x.sub(y);
    // 64·(x²−1)(y²−1)((x+y)²−2)((x−y)²−2)
    const t1 = x2.sub(1)
      .mul(y2.sub(1))
      .mul(sum.mul(sum).sub(2))
      .mul(dif.mul(dif).sub(2))
      .mul(64);
    // inner = −4(1+√2)(x²+y²)² + (8(2+√2)z² + 2(2+7√2))(x²+y²) − 16z⁴ + 8(1+2√2)z² − (1+12√2)
    const inner = r2.mul(r2).mul(s2.add(1).mul(-4))
      .add(z2.mul(s2.add(2).mul(8)).add(s2.mul(7).add(2).mul(2)).mul(r2))
      .sub(z4.mul(16))
      .add(z2.mul(s2.mul(2).add(1).mul(8)))
      .sub(s2.mul(12).add(1));
    return t1.sub(inner.mul(inner)); // 64·∏planes − inner²
  }
  if (kind === 'octicLattice') {
    // "Octic node lattice": a quartic double-well per axis Qₐ = a⁴ − a² = a²(a²−1) (zeros at 0, ±1),
    // multiplied across the three axes, with a nodal-coupling term (x²−y²)(y²−z²)(z²−x²) that breaks the
    // cubic symmetry into a crystalline cell lattice, plus a small xyz term. F = QxQyQz − 0.028·coupling
    // − 0.012·xyz. Very high degree ⇒ ∇F swings hard near the nodes, so the DE step is strongly
    // under-relaxed + hard-capped (like endrassOctic/togliatti).
    const x2 = x.mul(x), y2 = y.mul(y), z2 = z.mul(z);
    const qx = x2.mul(x2).sub(x2); // x⁴ − x²
    const qy = y2.mul(y2).sub(y2);
    const qz = z2.mul(z2).sub(z2);
    const coupling = x2.sub(y2).mul(y2.sub(z2)).mul(z2.sub(x2)); // (x²−y²)(y²−z²)(z²−x²)
    return qx.mul(qy).mul(qz).sub(coupling.mul(0.028)).sub(x.mul(y).mul(z).mul(0.012));
  }
  if (kind === 'cassini') {
    // Cassini oval of revolution. Long axis remapped to world-up (formula x → world y) so the
    // peanut stands upright. a=1, b=1.1 ⇒ connected dumbbell; a⁴−b⁴ = −0.4641.
    const X = y, Y = x, Z = z; // math-x (long axis) ← world y
    const X2 = X.mul(X), Y2 = Y.mul(Y), Z2 = Z.mul(Z);
    const r2 = X2.add(Y2).add(Z2);
    return r2.mul(r2).sub(X2.sub(Y2).sub(Z2).mul(2)).sub(0.4641); // (x²+y²+z²)² − 2a²(x²−y²−z²) + a⁴−b⁴
  }
  return cheb8(x).add(cheb8(y)).add(cheb8(z)); // default (unreachable for registered kinds)
};
const SURFACE_KINDS = [
  'gyroid', 'schwarzP', 'schwarzD', 'schoenIWP', 'neovius', 'chmutov',
  'heart', 'tanglecube', 'goursat', 'barth',
  'kummer', 'clebsch', 'cayley', 'fischerKoch', 'schwarzCLP',
  'togliatti', 'whitneyUmbrella', 'tooth', 'lidinoid', 'dingDong',
  'dupinCyclide', 'orthocircle', 'decocube', 'endrassOctic', 'cassini', 'octicLattice',
];

function makeMap(sys: RaymarchSystem, u: Record<string, Node>, uTime: Node): Node {
  const kind: RaymarchKind = sys.sdf;
  const ITER = sys.iters;

  if (SURFACE_KINDS.includes(kind)) {
    const freq = sys.freq ?? 1;
    return Fn(([p]: [Node]) => {
      const iso = u.iso.add(u.animate.mul(0.5).mul(sin(uTime.mul(0.3)))).toVar(); // animated level-set
      const fAt = (wp: Node): Node => surfaceField(kind, wp.mul(freq));
      const f0 = fAt(p).toVar();
      const e = 0.0025;
      const gx = fAt(p.add(vec3(e, 0, 0))).sub(f0);
      const gy = fAt(p.add(vec3(0, e, 0))).sub(f0);
      const gz = fAt(p.add(vec3(0, 0, e))).sub(f0);
      const gmag = vec3(gx, gy, gz).length().div(e).max(1e-4); // |∇F| (forward difference)
      let de = f0.sub(iso).abs().div(gmag).mul(sys.stepScale ?? 0.7); // |F−iso|/|∇F|, under-relaxed to avoid overshoot
      if (sys.maxStep !== undefined) de = de.min(sys.maxStep); // cap the step so steep surfaces can't overshoot
      return vec2(de.max(0), p.length().div(sys.bound)); // trap = radial → core→edge palette
    });
  }

  if (kind === 'mandelbulb') {
    const powerEff = u.power.add(u.animate.mul(1.6).mul(sin(uTime.mul(0.25)))).max(2);
    return Fn(([p]: [Node]) => {
      const z = p.toVar();
      const dr = float(1).toVar();
      const r = float(0).toVar();
      const trap = float(1e10).toVar();
      Loop(ITER, () => {
        r.assign(z.length());
        If(r.greaterThan(2), () => {
          Break();
        });
        trap.assign(min(trap, z.dot(z)));
        const rSafe = max(r, 1e-9);
        dr.assign(pow(rSafe, powerEff.sub(1)).mul(powerEff).mul(dr).add(1));
        const theta = acos(clamp(z.z.div(rSafe), -1, 1)).mul(powerEff);
        const phi = atan(z.y, z.x).mul(powerEff);
        const zr = pow(rSafe, powerEff);
        z.assign(
          vec3(sin(theta).mul(cos(phi)), sin(theta).mul(sin(phi)), cos(theta)).mul(zr).add(p),
        );
      });
      const de = log(max(r, 1e-9)).mul(r).mul(0.5).div(max(dr, 1e-12));
      return vec2(max(de, 0), trap);
    });
  }

  if (kind === 'qjulia') {
    return Fn(([p]: [Node]) => {
      const c = vec4(
        u.cx.add(u.animate.mul(0.16).mul(cos(uTime.mul(0.5)))),
        u.cy.add(u.animate.mul(0.16).mul(sin(uTime.mul(0.37)))),
        u.cz.add(u.animate.mul(0.16).mul(cos(uTime.mul(0.23)))),
        u.cw.add(u.animate.mul(0.16).mul(sin(uTime.mul(0.31)))),
      ).toVar();
      const q = vec4(p, 0).toVar();
      const dq = vec4(1, 0, 0, 0).toVar();
      const mz2 = q.dot(q).toVar();
      const md2 = float(1).toVar();
      const trap = float(1e10).toVar();
      Loop(ITER, () => {
        If(mz2.greaterThan(16), () => {
          Break();
        });
        dq.assign(qmul(q, dq).mul(2));
        q.assign(qsqr(q).add(c));
        md2.assign(dq.dot(dq));
        mz2.assign(q.dot(q));
        trap.assign(min(trap, mz2));
      });
      const de = float(0.25).mul(log(max(mz2, 1e-9))).mul(mz2.div(max(md2, 1e-12)).sqrt());
      return vec2(max(de, 0), trap);
    });
  }

  if (kind === 'mandelbox') {
    return Fn(([p]: [Node]) => {
      const scaleEff = u.scale.add(u.animate.mul(0.25).mul(sin(uTime.mul(0.2))));
      const minR2 = u.minRadius.mul(u.minRadius);
      const fixR2 = float(1);
      const z = p.toVar();
      const dr = float(1).toVar();
      const trap = float(1e10).toVar();
      Loop(ITER, () => {
        // box fold
        z.assign(clamp(z, -1, 1).mul(2).sub(z));
        const r2 = z.dot(z).toVar();
        trap.assign(min(trap, r2));
        // sphere fold (piecewise factor, branchless)
        const fInner = fixR2.div(minR2);
        const fShell = fixR2.div(max(r2, 1e-9));
        const f = select(r2.lessThan(minR2), fInner, select(r2.lessThan(fixR2), fShell, float(1)));
        z.assign(z.mul(f));
        dr.assign(dr.mul(f));
        // scale + translate
        z.assign(z.mul(scaleEff).add(p));
        dr.assign(dr.mul(abs(scaleEff)).add(1));
      });
      const de = z.length().div(max(abs(dr), 1e-9));
      return vec2(max(de, 0), trap.mul(0.25));
    });
  }

  if (kind === 'kaleidoTunnel') {
    // SDF: fold xy into N mirror wedges (kaleidoscope), tile z into a fly-through tunnel, place a hollow
    // hex-tube per cell; pack a flat-facet id into the trap output for the colorNode's faceted palette.
    return Fn(([p]: [Node]) => {
      const N = max(u.symmetry, float(2)); // fold count (guard ≥2)
      const cell = u.cellScale;
      const wedge = float(6.2831853).div(N).toVar();
      const zAdv = p.z.add(uTime.mul(u.speed)).toVar(); // tunnel scrolls toward the camera
      const zt = mod(zAdv, cell).sub(cell.mul(0.5)).toVar();
      const cellId = floor(zAdv.div(cell)).toVar();
      const tw = u.twist.mul(p.z); // depth-proportional helix twist
      const cw = cos(tw), sw = sin(tw);
      const rx0 = p.x.mul(cw).sub(p.y.mul(sw));
      const ry0 = p.x.mul(sw).add(p.y.mul(cw));
      const r = length(vec2(rx0, ry0)).toVar();
      const a0 = atan(ry0, rx0); // 2-arg atan; atan(0,0)=0 → finite on the r=0 axis
      const a = abs(mod(a0, wedge).sub(wedge.mul(0.5))).toVar(); // mirror-folded angle
      const rx = r.mul(cos(a)).toVar();
      const ry = r.mul(sin(a)).toVar();
      // IQ hexagon SDF (apothem 1), hollowed to a tube
      const kx = float(-0.8660254), ky = float(0.5), kz = float(0.57735);
      const ax = abs(rx).toVar(); const ay = abs(ry).toVar();
      const dd = min(kx.mul(ax).add(ky.mul(ay)), 0).mul(2).toVar();
      ax.subAssign(dd.mul(kx)); ay.subAssign(dd.mul(ky));
      ax.subAssign(clamp(ax, kz.mul(-1.0), kz));
      ay.subAssign(1.0);
      const hexSDF = sqrt(ax.mul(ax).add(ay.mul(ay))).mul(select(ay.lessThan(0), float(-1), float(1)));
      const hex = abs(hexSDF).sub(0.18).toVar(); // hollow tube, thickness 0.18
      const zc = abs(zt).sub(cell.mul(0.30)).toVar(); // z-slab → discrete ring bars
      const dOut = length(vec2(max(hex, 0), max(zc, 0)));
      const dIn = min(max(hex, zc), 0);
      const d = dOut.add(dIn).toVar();
      // facet id → trap: per-ring hash (∈[0,0.49)) + 0.5 for the mirror half → two-tone faceting
      const segHash = fract(sin(cellId.mul(12.9898)).mul(43758.5453)).mul(0.49).toVar();
      const half = select(a.greaterThan(wedge.mul(0.25)), float(0.5), float(0));
      const trap = segHash.add(half).toVar(); // ∈[0,0.99); decoded raw in colorNode (NOT sqrt'd)
      return vec2(max(d, 0), trap);
    });
  }

  // menger sponge
  return Fn(([p]: [Node]) => {
    const ang = uTime.mul(0.25).mul(u.animate);
    const pr = rotYX(p, ang, u.spin.mul(3.1416).add(ang.mul(0.5))).toVar();
    const d = sdBox(pr, vec3(1)).toVar();
    const s = float(1).toVar();
    const trap = float(1e10).toVar();
    Loop(ITER, () => {
      const a = mod(pr.mul(s), 2).sub(1).toVar();
      s.assign(s.mul(3));
      const rr = abs(float(1).sub(abs(a).mul(3))).toVar();
      trap.assign(min(trap, a.length()));
      const da = max(rr.x, rr.y);
      const db = max(rr.y, rr.z);
      const dc = max(rr.z, rr.x);
      const cross = min(da, min(db, dc)).sub(1).div(s);
      d.assign(max(d, cross));
    });
    return vec2(max(d, 0), trap);
  });
}

export function createRaymarch(sys: RaymarchSystem, backend: 'webgpu' | 'webgl2'): RaymarchPass {
  // Param uniforms (one per ParamSpec.key), seeded from defaults so frame 0 is correct.
  const u: Record<string, Node> = {};
  for (const spec of sys.params) u[spec.key] = uniform(spec.default);
  const uTime = uniform(0);
  // NDC near-plane z differs by backend (WebGPU 0..1, WebGL2 -1..1); used for ray reconstruction.
  const uNearZ = uniform(backend === 'webgpu' ? 0 : -1);

  const map: Node = makeMap(sys, u, uTime);
  const mapF = Fn(([p]: [Node]) => map(p).x); // scalar DE for normals / shadows / AO

  // surface normal via the 4-tap tetrahedron technique
  const calcNormal = Fn(([p]: [Node]) => {
    const h = float(0.0007);
    const k0 = vec3(1, -1, -1);
    const k1 = vec3(-1, -1, 1);
    const k2 = vec3(-1, 1, -1);
    const k3 = vec3(1, 1, 1);
    return normalize(
      k0
        .mul(mapF(p.add(k0.mul(h))))
        .add(k1.mul(mapF(p.add(k1.mul(h)))))
        .add(k2.mul(mapF(p.add(k2.mul(h)))))
        .add(k3.mul(mapF(p.add(k3.mul(h))))),
    );
  });

  const calcAO = Fn(([p, n]: [Node, Node]) => {
    const occ = float(0).toVar();
    const sca = float(1).toVar();
    Loop(5, ({ i }: { i: Node }) => {
      const hr = float(0.01).add(float(0.12).mul(float(i)).div(4));
      const dd = mapF(p.add(n.mul(hr)));
      occ.addAssign(hr.sub(dd).mul(sca));
      sca.assign(sca.mul(0.95));
    });
    return clamp(occ.mul(2.5).oneMinus(), 0, 1);
  });

  const softShadow = Fn(([ro, rd]: [Node, Node]) => {
    const res = float(1).toVar();
    const t = float(0.02).toVar();
    Loop(28, () => {
      const hh = mapF(ro.add(rd.mul(t))).toVar();
      res.assign(min(res, float(14).mul(hh).div(t)));
      t.addAssign(clamp(hh, 0.02, 0.5));
      If(hh.lessThan(0.0008), () => {
        Break();
      });
      If(t.greaterThan(float(sys.bound).mul(3)), () => {
        Break();
      });
    });
    return clamp(res, 0, 1);
  });

  const BG_LO = vec3(0.016, 0.022, 0.045);
  const BG_HI = vec3(0.04, 0.05, 0.09);
  const LIGHT = vec3(0.6, 0.85, 0.5).normalize();

  const mat = new MeshBasicNodeMaterial();
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.toneMapped = false;

  // Full-screen: a 2-unit plane whose vertexNode is written straight to clip space (z=far).
  mat.vertexNode = vec4(positionGeometry.x, positionGeometry.y, 1, 1);

  mat.colorNode = Fn(() => {
    // reconstruct a world-space ray for this pixel from the orbit camera (auto-bound nodes)
    const ndc = screenUV.mul(2).sub(1);
    const clip = vec4(ndc.x, ndc.y, uNearZ, 1);
    const viewH = cameraProjectionMatrixInverse.mul(clip);
    const rdView = normalize(viewH.xyz.div(viewH.w));
    const rd = normalize(cameraWorldMatrix.mul(vec4(rdView, 0)).xyz).toVar();
    const ro = vec3(cameraPosition).toVar();

    const col = mix(BG_LO, BG_HI, ndc.y.mul(0.5).add(0.5)).toVar();

    if (sys.sdf === 'blackhole') {
      // ── Non-SDF marcher: integrate a photon along a bent null geodesic (Schwarzschild). ──
      // Geometric units r_s = 1 (M = ½). The accel a = −1.5·r_s·L²·p/r⁵ is purely radial, so
      // L² = |p×v|² is conserved exactly and computed once → velocity-Verlet keeps the orbit shape.
      const RS = float(sys.rs ?? 1); // event-horizon radius
      const RIN = float(sys.diskIn ?? 3); // accretion-disk inner edge (ISCO = 3·r_s)
      const ROUT = u.disk; // disk outer edge (live param)
      const RESC = float(sys.bound); // photon escape radius
      const STEP = float(sys.photonStep ?? 0.1); // adaptive-dt fraction

      const pos = ro.toVar();
      const dir = rd.toVar(); // unit ray direction, advanced as a velocity
      const h2 = dot(cross(pos, dir), cross(pos, dir)).toVar(); // conserved L²
      const prevY = pos.y.toVar();
      const emis = vec3(0).toVar(); // accumulated disk emission (a ray can cross the plane twice)
      const done = float(0).toVar(); // 1 ⇒ fell through the horizon (pure black)

      Loop(sys.maxSteps, () => {
        const r = length(pos).toVar();
        If(r.lessThan(RS), () => { done.assign(1); Break(); }); // captured → shadow
        If(r.greaterThan(RESC), () => { Break(); }); // escaped → sample lensed sky below
        const dt = clamp(STEP.mul(r), 0.02, 0.6).toVar(); // fine near the hole, coarse far away

        // velocity-Verlet: half-kick → drift → half-kick (a points inward, ∝ 1/r⁵)
        const r5a = max(r.mul(r).mul(r).mul(r).mul(r), 1e-6);
        const acc = pos.mul(RS.mul(-1.5).mul(h2).div(r5a));
        const vh = dir.add(acc.mul(dt.mul(0.5))).toVar();
        const pn = pos.add(vh.mul(dt)).toVar();
        const rn = length(pn);
        const r5b = max(rn.mul(rn).mul(rn).mul(rn).mul(rn), 1e-6);
        const acc2 = pn.mul(RS.mul(-1.5).mul(h2).div(r5b));
        dir.assign(vh.add(acc2.mul(dt.mul(0.5))));

        // equatorial disk crossing: y sign-flip between pos and pn, then radius ∈ [RIN, ROUT]
        If(prevY.mul(pn.y).lessThan(0), () => {
          const f = prevY.div(prevY.sub(pn.y)); // linear interp to the y=0 plane
          const cx = mix(pos.x, pn.x, f);
          const cz = mix(pos.z, pn.z, f);
          const rad = length(vec2(cx, cz)).toVar();
          If(rad.greaterThan(RIN).and(rad.lessThan(ROUT)), () => {
            const s = clamp(rad.sub(RIN).div(ROUT.sub(RIN)), 0, 1);
            // hot blue-white inner → cool deep-red outer, hue nudged by colShift
            const base = mix(vec3(1.0, 0.95, 0.85), vec3(1.0, 0.35, 0.1), pow(s, 0.7)).toVar();
            const hue = u.colShift.mul(6.2832);
            base.assign(base.mul(vec3(
              cos(hue).mul(0.15).add(0.9),
              cos(hue.add(2.1)).mul(0.15).add(0.9),
              cos(hue.add(4.2)).mul(0.15).add(0.9),
            )));
            const inten = pow(RIN.div(rad), 0.75); // Shakura–Sunyaev-ish radial falloff
            const ang = atan(cz, cx); // two-arg atan (no atan2 in TSL)
            const turb = sin(ang.mul(7).add(uTime.mul(0.6)).add(rad.mul(2))).mul(0.18).add(0.82);
            // relativistic Doppler beaming + gravitational redshift → the iconic asymmetry
            const vdir = normalize(cross(vec3(0, 1, 0), normalize(vec3(cx, 0, cz)))); // prograde tangent
            const beta = sqrt(RS.mul(0.5).div(max(rad.sub(RS.mul(1.5)), 1e-3))); // √(M/(r−3M)), M=r_s/2
            const gam = float(1).div(sqrt(max(float(1).sub(beta.mul(beta)), 1e-4)));
            const nv = dot(normalize(dir), vdir);
            const dopp = float(1).div(gam.mul(float(1).sub(beta.mul(nv).mul(u.beaming))));
            const boost = dopp.mul(dopp).mul(dopp).mul(sqrt(max(float(1).sub(RS.div(rad)), 0))); // D³·√(1−r_s/r)
            emis.addAssign(base.mul(inten).mul(turb).mul(boost).mul(u.exposure));
          });
        });

        prevY.assign(pn.y);
        pos.assign(pn);
      });

      // escaped rays carry the LENSED direction → a procedural starfield smears into the Einstein ring
      const skyDir = normalize(dir);
      const q = floor(skyDir.mul(140));
      const hsh = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
      const star = smoothstep(0.9975, 1.0, hsh).mul(vec3(0.9, 0.95, 1.0));
      const sky = mix(BG_LO, BG_HI, skyDir.y.mul(0.5).add(0.5)).add(star);
      col.assign(sky.add(emis)); // disk glows over the bent sky
      col.assign(mix(col, vec3(0), done)); // horizon → pure black
    } else if (sys.sdf === 'conformal') {
      // ── 2D conformal map: per-pixel w=f(z) of the complex plane, coloured by a checkerboard of w
      //    (NO marching). Complex numbers are vec2; every divide floors |denom|² so poles stay finite.
      const cmul = (a: Node, b: Node): Node => vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x)));
      const cdiv = (a: Node, b: Node): Node => {
        const den = max(b.x.mul(b.x).add(b.y.mul(b.y)), 1e-6); // pole guard → finite everywhere
        return vec2(a.x.mul(b.x).add(a.y.mul(b.y)), a.y.mul(b.x).sub(a.x.mul(b.y))).div(den);
      };
      const z0 = vec2(ndc.x, ndc.y).mul(u.zoom).toVar();
      const th = uTime.mul(0.25).mul(u.animate); // conformal: rotating z preserves the look
      const z = cmul(z0, vec2(cos(th), sin(th))).toVar();
      const w = vec2(0).toVar();
      if (sys.sdf3 === 'mobius') {
        // fixed points p,q + complex multiplier λ=|λ|e^{iφ} (φ drifts with time): the Möbius flow
        const p = vec2(u.px, u.py);
        const q = vec2(u.qx, u.qy);
        const phi = u.lphase.mul(6.2832).add(uTime.mul(0.15).mul(u.animate));
        const k = vec2(cos(phi), sin(phi)).mul(u.lam).toVar();
        const rhs = cmul(k, cdiv(z.sub(p), z.sub(q))).toVar(); // (w−p)/(w−q)=λ(z−p)/(z−q)
        w.assign(cdiv(p.sub(cmul(q, rhs)), vec2(1, 0).sub(rhs)));
      } else if (sys.sdf3 === 'inverse') {
        w.assign(cdiv(vec2(1, 0), z)); // 1/z
      } else if (sys.sdf3 === 'square') {
        w.assign(cmul(z, z)); // z²
      } else if (sys.sdf3 === 'cexp') {
        const ex = exp(clamp(z.x, -8, 8)); // clamp Re so e^Re can't overflow fp32
        w.assign(vec2(ex.mul(cos(z.y)), ex.mul(sin(z.y))));
      } else {
        w.assign(z.add(cdiv(vec2(1, 0), z)).mul(0.5)); // joukowski ½(z+1/z)
      }
      // checkerboard of w with pixel-footprint smoothstep AA (band widens where |w| varies fast)
      const sw = vec2(sin(w.x.mul(u.scale)), sin(w.y.mul(u.scale)));
      const prod = sw.x.mul(sw.y).toVar();
      const aa = clamp(length(w).mul(0.04).add(0.06), 0.04, 0.5);
      const chk = smoothstep(aa.negate(), aa, prod).toVar();
      const a0 = u.colShift.mul(6.2832);
      const cA = vec3(cos(a0), cos(a0.add(2.1)), cos(a0.add(4.2))).mul(0.35).add(0.4);
      const cB = vec3(cos(a0.add(0.9)), cos(a0.add(3.0)), cos(a0.add(5.1))).mul(0.35).add(0.18);
      const tile = mix(cA, cB, chk).toVar();
      const fade = float(1).div(float(1).add(length(w).mul(0.18))); // far cells dissolve into the BG
      col.assign(mix(col, tile, fade));
    } else if (sys.sdf === 'newton') {
      // ── Newton fractal / polynomiography: per-pixel basins of Newton's method for p(z)=zⁿ−1. ──
      // z ← z − a·(z − z^{1−n})/n  (a=over-relaxation). Colour = which root it lands in (hue) × how
      // long it took to converge (the fractal basin boundaries glow → flowing N-fold ribbons).
      const TAU = 6.2831853;
      const n = u.fold; // 3..7 (uniform); roots are the n-th roots of unity
      const a = u.relax.add(u.animate.mul(0.4).mul(sin(uTime.mul(0.3)))).toVar(); // morph: drift relaxation
      const z = vec2(ndc.x, ndc.y).mul(u.zoom).toVar();
      const iter = float(0).toVar();
      const done = float(0).toVar();
      Loop(sys.iters, () => {
        const r = max(length(z), 1e-6);
        const th = atan(z.y, z.x); // two-arg atan (no atan2 in TSL)
        const m = float(1).sub(n); // exponent 1−n
        const rm = pow(r, m);
        const zpow = vec2(rm.mul(cos(m.mul(th))), rm.mul(sin(m.mul(th)))); // z^{1−n} in polar form
        const dz = z.sub(zpow).div(n).mul(a).toVar(); // a·(z − z^{1−n})/n
        const stepLen = length(dz).toVar();
        z.assign(z.sub(dz));
        iter.addAssign(done.oneMinus()); // count iterations until converged (then stops)
        If(stepLen.lessThan(2e-4), () => { done.assign(1); });
      });
      // root id → hue; per-root cosine palette shifted by colShift so the n sectors read distinctly
      const rootId = floor(atan(z.y, z.x).div(TAU).mul(n).add(0.5)); // nearest n-th root of unity
      const hue = rootId.div(n).mul(TAU).add(u.colShift.mul(TAU));
      const base = vec3(cos(hue).mul(0.5).add(0.5), cos(hue.add(2.1)).mul(0.5).add(0.5), cos(hue.add(4.2)).mul(0.5).add(0.5)).toVar();
      const mu = iter.div(float(sys.iters)).toVar(); // interior converges fast (→0); fractal boundary slow (→1)
      const glow = pow(mu, 1.25).toVar(); // dark basin interiors → the bright fractal seams pop (flowing ribbons)
      const white = pow(mu, 4).mul(0.7); // white-hot at the sharpest boundaries
      col.assign(base.mul(glow.mul(0.92).add(0.06)).add(white));
    } else if (sys.sdf === 'contour') {
      // ── Linework: morphing contour lines (isolines) of a folded sum-of-waves scalar field (after
      //    Zach Lieberman). White level-set lines on black; mirror-folded → symmetric; warped → the
      //    organic quasi-3D "rotating" morph. fwidth gives clean per-pixel anti-aliasing of the lines.
      const t = uTime.mul(0.2).mul(u.animate);
      const p0 = vec2(ndc.x, ndc.y).mul(u.zoom).toVar();
      const pb = p0.mul(float(1).add(p0.dot(p0).mul(0.18))).toVar(); // mild barrel (even → symmetric): centre cells swell
      const q0 = vec2(abs(pb.x), abs(pb.y)).toVar(); // FOLD first → crisp 4-fold mirror symmetry
      const wx = sin(q0.y.mul(1.7).add(t)).add(sin(q0.y.mul(0.9).sub(t.mul(1.3)))).mul(u.warp.mul(0.5));
      const wy = sin(q0.x.mul(1.9).sub(t.mul(0.8))).add(sin(q0.x.mul(1.1).add(t.mul(1.1)))).mul(u.warp.mul(0.5));
      const q = vec2(q0.x.add(wx), q0.y.add(wy)).toVar(); // warp the folded coords (symmetry preserved)
      // interference of plane waves (varied angles) + a radial term + an L∞ term → varied contour shapes
      const f = sin(q.x.mul(3.1).add(q.y.mul(0.7)).add(t))
        .add(sin(q.x.mul(0.6).sub(q.y.mul(2.7)).sub(t.mul(1.3))))
        .add(sin(q.x.mul(2.2).add(q.y.mul(2.1)).add(t.mul(0.7))))
        .add(sin(q.x.mul(1.3).sub(q.y.mul(3.3)).add(t.mul(1.1))))
        .add(sin(length(q).mul(4.0).sub(t.mul(1.6)))) // radial → concentric ovals
        .add(sin(max(q.x, q.y).mul(3.4).add(t.mul(0.5)))) // L∞ → square/rectangle contours
        .toVar();
      const ff = f.mul(u.density).toVar();
      const tri = abs(fract(ff).sub(0.5)).mul(2).toVar(); // triangle wave: 1 at level sets, 0 between
      const aa = fwidth(ff).mul(1.6).add(2e-3);
      const line = smoothstep(float(1).sub(u.thickness).sub(aa), float(1).sub(u.thickness), tri).toVar();
      const a0 = u.colShift.mul(6.2832); // faint tint (default ≈ white-on-black)
      const tint = vec3(cos(a0).mul(0.12).add(0.88), cos(a0.add(2.1)).mul(0.12).add(0.9), cos(a0.add(4.2)).mul(0.12).add(0.95));
      col.assign(tint.mul(line));
    } else if (sys.sdf === 'inkBloom') {
      // ── Bloom: soft ink-diffusion lobes over a light "paper" ground. Per-pixel sum of soft radial
      //    lobes (a metaball-ish field), domain-warped into organic petals, composited as translucent
      //    ink: peach at the soft edges, deep indigo where it pools. This branch OWNS col → it overrides
      //    the shared dark BG with a light paper gradient.
      const t = uTime.mul(0.15).mul(u.animate);
      const s2 = u.softness.mul(u.softness).toVar();
      col.assign(mix(vec3(0.99, 0.97, 0.95), vec3(0.97, 0.93, 0.91), ndc.y.mul(0.5).add(0.5))); // cream paper
      const p = vec2(ndc.x, ndc.y).mul(u.zoom).toVar();
      const pw = vec2(
        p.x.add(sin(p.y.mul(2.3).add(t)).mul(0.16)).add(sin(p.y.mul(1.1).sub(t.mul(1.3))).mul(0.1)),
        p.y.add(sin(p.x.mul(2.1).sub(t.mul(0.8))).mul(0.16)).add(sin(p.x.mul(0.9).add(t.mul(1.1))).mul(0.1)),
      ).toVar(); // domain warp → petal edges
      const a0 = u.colShift.mul(6.2832);
      const N = sys.lobes ?? 6;
      // Each petal is a TRANSLUCENT ink layer composited over the paper (watercolour): a petal multiplies
      // the colour beneath toward its pigment, so where petals OVERLAP the colour deepens — single petals
      // stay pale peach, the pooled heart goes deep indigo. (Subtractive layering, not a summed field.)
      for (let i = 0; i < N; i++) {
        const ang = float((i * 6.2831853) / N).add(t.mul(2)); // petals drift around a ring
        const ci = vec2(cos(ang), sin(ang)).mul(0.62);
        const d = pw.sub(ci);
        const a = clamp(exp(d.dot(d).div(s2).negate()).mul(u.bloom).mul(0.6), 0, 0.7); // petal alpha (translucent)
        const warmLobe = clamp(float(0.5).add(cos(float(i * 2.3).add(a0)).mul(0.5)).add(u.warmth.sub(0.5)), 0, 1);
        const ink = mix(vec3(0.34, 0.30, 0.62), vec3(0.98, 0.58, 0.42), warmLobe); // indigo ↔ peach pigment
        col.assign(mix(col, col.mul(ink).mul(1.25), a)); // layer the ink; overlaps multiply → deepen
      }
      const ac = clamp(exp(pw.dot(pw).div(s2.mul(1.8)).negate()).mul(u.bloom).mul(0.7), 0, 0.82); // pooled heart
      col.assign(mix(col, col.mul(vec3(0.34, 0.31, 0.52)), ac));
      col.assign(clamp(col, 0, 1));
    } else if (sys.sdf === 'gravLens') {
      // ── Spacetime: thin-lens gravitational lensing of a procedural sky by a point mass. The observed
      //    direction θ maps back to the SOURCE position β = θ·(1 − rE²/|θ|²) (point-mass deflection), so a
      //    source near the optic axis smears into an EINSTEIN RING at |θ|=rE plus counter-arcs. We sample
      //    two bright source galaxies + a faint star sprinkle through that map, glow the ring, and leave a
      //    dim deflector at the centre. (Pure lensing — no disk/horizon, unlike the black-hole marcher.)
      const t = uTime.mul(0.06).mul(u.animate);
      const p = vec2(ndc.x, ndc.y).mul(u.zoom).toVar(); // observed image plane
      const b = length(p).max(1e-3).toVar();
      const rE2 = u.mass.mul(u.mass).toVar(); // Einstein radius²
      const beta = p.mul(float(1).sub(rE2.div(b.mul(b)))).toVar(); // → source-plane position
      col.assign(vec3(0.012, 0.014, 0.028)); // deep space (this branch owns col)
      const a0 = u.colShift.mul(6.2832);
      // two drifting source galaxies, lensed into rings/arcs by the β map
      const g1 = vec2(sin(t).mul(0.1), cos(t.mul(0.8)).mul(0.07));
      const d1 = beta.sub(g1);
      const blob1 = exp(d1.dot(d1).mul(-70));
      const warm = vec3(cos(a0).mul(0.1).add(1.0), 0.8, 0.5);
      col.assign(col.add(warm.mul(blob1.mul(1.3))));
      const g2 = vec2(sin(t.mul(0.6).add(2)).mul(0.16), cos(t.add(1)).mul(0.12).add(0.05));
      const d2 = beta.sub(g2);
      const blob2 = exp(d2.dot(d2).mul(-110));
      col.assign(col.add(vec3(0.55, 0.75, 1.0).mul(blob2)));
      // faint star sprinkle in the source plane (hashed point per cell) — also lensed
      const s = beta.mul(14);
      const cell = floor(s);
      const fc = fract(s).sub(0.5);
      const h1 = fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453)); // presence
      const h2 = fract(sin(dot(cell, vec2(269.5, 183.3))).mul(43758.5453)); // x offset
      const h3 = fract(sin(dot(cell, vec2(419.2, 371.9))).mul(43758.5453)); // y offset
      const sp = fc.sub(vec2(h2.sub(0.5), h3.sub(0.5)).mul(0.7));
      const star = exp(sp.dot(sp).mul(-110)).mul(pow(h1, 9)); // round, sparse
      col.assign(col.add(vec3(star)));
      // Einstein-ring magnification glow at |θ|=rE
      const ring = exp(b.sub(u.mass).mul(b.sub(u.mass)).mul(-160)).mul(0.25);
      col.assign(col.add(warm.mul(ring)));
      // the deflector galaxy: a small dim central glow
      col.assign(col.add(vec3(0.6, 0.55, 0.7).mul(exp(b.mul(b).mul(-40)).mul(0.18))));
      col.assign(clamp(col, 0, 1));
    } else if (sys.sdf === 'moire') {
      // ── Linework: a barrier-grid MOIRÉ illusion. A fixed radial hash grating (ticks around the
      //    circle) is overlaid with a sliding vertical stripe barrier; the XOR of the two binary
      //    gratings is a moiré rosette whose hyperbolic fringes SWEEP as the barrier translates — static
      //    geometry that reads as rotation. Stark black/white; this branch owns col. ──
      const t = uTime.mul(u.animate).mul(2);
      const p = vec2(ndc.x, ndc.y).mul(u.zoom).toVar();
      const r = length(p).toVar();
      const th = atan(p.y, p.x);
      const A = smoothstep(float(-0.12), float(0.12), sin(th.mul(u.spokes))); // fixed radial hashes
      const B = smoothstep(float(-0.12), float(0.12), sin(p.x.mul(u.bars).add(t))); // moving barrier
      const moire = abs(A.sub(B)).toVar(); // XOR → interference fringes
      const disk = smoothstep(float(1.0), float(0.82), r); // circular figure, soft edge
      const calm = smoothstep(float(0.04), float(0.16), r); // tame the centre singularity
      col.assign(vec3(moire.mul(disk).mul(calm)));
    } else if (sys.sdf === 'opticalVortex') {
      // ── Spectral: interfering optical vortices. Several Laguerre–Gauss vortex beams (helical phase
      //    e^{iℓθ}, amplitude zero at the core) drift on ellipses; their COMPLEX amplitudes add and the
      //    screen shows the intensity I = |ΣE_k|². Where windings disagree the fringes tear into the
      //    tell-tale FORKS of a phase singularity. Rendered as a true field (not points), so the
      //    interference is exact. Inferno-ish palette; this branch owns col. ──
      const t = uTime.mul(u.drift).mul(0.5);
      const spin = uTime.mul(u.twist).mul(0.8);
      const f = vec2(ndc.x, ndc.y).mul(u.zoom).mul(1.5).toVar();
      const w = u.width.mul(0.55).toVar();
      const inv2w2 = float(1).div(w.mul(w).mul(2)).toVar();
      const er = float(0).toVar();
      const ei = float(0).toVar();
      const K = sys.beams ?? 5;
      Loop(K, ({ i }: { i: Node }) => {
        const fi = float(i);
        const a = fi.div(float(K)).mul(6.2831853).toVar();
        // beam centre: a base ring position plus a slow elliptical drift
        const cx = cos(a).mul(0.26).add(cos(t.add(fi.mul(1.7))).mul(0.14));
        const cy = sin(a).mul(0.26).add(sin(t.mul(1.1).add(fi.mul(2.3))).mul(0.14));
        const dx = f.x.sub(cx).toVar();
        const dy = f.y.sub(cy).toVar();
        const rho = sqrt(dx.mul(dx).add(dy.mul(dy))).add(1e-4).toVar();
        // topological charge ℓ: magnitude 1 or 2 (fract parity), sign ±1 ((−1)^i via cos(iπ))
        const mag = fract(fi.mul(0.5)).mul(2).add(1).toVar(); // 1,2,1,2,…
        const sign = cos(fi.mul(3.14159265)).toVar(); // +1,−1,+1,−1,…
        const l = sign.mul(mag).toVar();
        // Laguerre–Gauss-like amplitude: (ρ/w)^|ℓ|·exp(−ρ²/2w²), zero at the core
        const amp = pow(rho.div(w), mag).mul(exp(rho.mul(rho).mul(inv2w2).mul(-1))).toVar();
        const ph = l.mul(atan(dy, dx)).add(spin.mul(sign)).toVar();
        er.addAssign(amp.mul(cos(ph)));
        ei.addAssign(amp.mul(sin(ph)));
      });
      // a tilted reference plane wave — its fine carrier fringes are FORKED by each vortex core,
      // exactly as in a computer-generated hologram of an optical vortex
      const carrier = f.x.mul(32).add(f.y.mul(13)).add(spin.mul(1.5)).toVar();
      er.addAssign(cos(carrier).mul(0.7));
      ei.addAssign(sin(carrier).mul(0.7));
      const I = er.mul(er).add(ei.mul(ei)).mul(u.gain.mul(u.gain).mul(0.16)).toVar();
      const inten = clamp(I, 0, 1).toVar();
      // inferno-ish: black → violet → orange → white, background faded to black
      const c = mix(vec3(0.10, 0.04, 0.22), vec3(1.0, 0.5, 0.08), smoothstep(float(0.06), float(0.55), inten)).toVar();
      c.assign(mix(c, vec3(1.0, 0.95, 0.8), smoothstep(float(0.55), float(1.0), inten)));
      c.assign(c.mul(smoothstep(float(0.015), float(0.13), inten)));
      col.assign(c);
    } else if (sys.sdf === 'onsagerFlow') {
      // ── Fluid: an Onsager point-vortex gas at NEGATIVE temperature. Same-sign vortices, which
      //    ordinarily repel their opposites, CLUMP into two giant coherent domains (the condensate
      //    Onsager predicted in 1949). We fix K vortices in a few same-sign clusters and, per pixel,
      //    sum their Biot–Savart velocity u = Σ Γ/(2π)·(ẑ×Δ)/|Δ|² and their vorticity ω = Σ Γ·G(Δ).
      //    A short line-integral convolution (march noise a few steps along u, both ways) paints the
      //    streaming ribbons; ω's sign tints them blue (⟳) vs ember (⟲); the cores burn white.
      //    A true field, so the flow is exact — points can't render a stirred continuum. Owns col. ──
      const t = uTime.mul(u.speed).mul(0.28);
      const f = vec2(ndc.x, ndc.y).mul(u.zoom).mul(1.25).toVar();
      const K = sys.beams ?? 14; // two condensed domains of K/2 same-sign vortices each
      const HALF = float(2).div(float(K)); // 1/(vortices-per-cluster) → cluster index via floor
      const a2 = float(0.006); // core softening (regularised Biot–Savart)
      // ── line-integral convolution: march a forward and a backward tracer along the flow, sampling
      //    a fine noise; the average streaks the noise into streamlines (the LIC flow texture) ──
      const pf = f.toVar();
      const pb = f.toVar();
      const lic = float(0).toVar();
      const licN = float(0).toVar();
      Loop(11, () => {
        const vfx = float(0).toVar();
        const vfy = float(0).toVar();
        const vbx = float(0).toVar();
        const vby = float(0).toVar();
        Loop(K, ({ i: j }: { i: Node }) => {
          const fj = float(j);
          const cl = floor(fj.mul(HALF)).toVar(); // 0 = left domain (+), 1 = right domain (−)
          const sgn = cos(cl.mul(3.14159265)).toVar(); // +1 / −1 circulation
          const orbit = t.mul(0.3).toVar(); // the counter-rotating dipole slowly precesses
          const base = sgn.mul(-0.42).toVar();
          const ccx = base.mul(cos(orbit)).toVar();
          const ccy = base.mul(sin(orbit)).toVar();
          const ia = fract(fj.mul(HALF)).mul(6.2831853).add(t.mul(1.1)).toVar(); // intra-cluster spin
          const rkx = ccx.add(cos(ia).mul(0.15)).toVar();
          const rky = ccy.add(sin(ia).mul(0.15)).toVar();
          const dfx = pf.x.sub(rkx);
          const dfy = pf.y.sub(rky);
          const rf2 = dfx.mul(dfx).add(dfy.mul(dfy)).add(a2).toVar();
          vfx.addAssign(sgn.mul(dfy).mul(-1).div(rf2)); // u = Γ·(ẑ×Δ)/|Δ|² = Γ·(−Δy,Δx)/|Δ|²
          vfy.addAssign(sgn.mul(dfx).div(rf2));
          const dbx = pb.x.sub(rkx);
          const dby = pb.y.sub(rky);
          const rb2 = dbx.mul(dbx).add(dby.mul(dby)).add(a2).toVar();
          vbx.addAssign(sgn.mul(dby).mul(-1).div(rb2));
          vby.addAssign(sgn.mul(dbx).div(rb2));
        });
        const vfl = sqrt(vfx.mul(vfx).add(vfy.mul(vfy))).add(1e-4);
        const vbl = sqrt(vbx.mul(vbx).add(vby.mul(vby))).add(1e-4);
        pf.addAssign(vec2(vfx.div(vfl), vfy.div(vfl)).mul(0.014));
        pb.subAssign(vec2(vbx.div(vbl), vby.div(vbl)).mul(0.014));
        lic.addAssign(vnoise2(pf.mul(72)));
        lic.addAssign(vnoise2(pb.mul(72)));
        licN.addAssign(2);
      });
      lic.assign(lic.div(licN));
      // ── local vorticity sign (for colour) + white-hot vortex cores, sampled at the pixel itself ──
      const omega = float(0).toVar();
      const core = float(0).toVar();
      Loop(K, ({ i: j }: { i: Node }) => {
        const fj = float(j);
        const cl = floor(fj.mul(HALF)).toVar();
        const sgn = cos(cl.mul(3.14159265)).toVar();
        const orbit = t.mul(0.3).toVar();
        const base = sgn.mul(-0.42).toVar();
        const ccx = base.mul(cos(orbit)).toVar();
        const ccy = base.mul(sin(orbit)).toVar();
        const ia = fract(fj.mul(HALF)).mul(6.2831853).add(t.mul(1.1)).toVar();
        const rkx = ccx.add(cos(ia).mul(0.15)).toVar();
        const rky = ccy.add(sin(ia).mul(0.15)).toVar();
        const dx = f.x.sub(rkx);
        const dy = f.y.sub(rky);
        const d2 = dx.mul(dx).add(dy.mul(dy)).toVar();
        omega.addAssign(sgn.mul(exp(d2.mul(-7)))); // Gaussian-smoothed circulation
        core.addAssign(exp(d2.mul(-320))); // tight bright core
      });
      // colour: signed vorticity picks the domain (ember ⟲ vs cyan ⟳); its MAGNITUDE saturates the
      // hue so the weak-field interstitium falls to a deep-indigo dark instead of a muddy grey; the
      // LIC streaks modulate brightness; cores burn white. gain lifts contrast.
      const dom = smoothstep(float(-0.14), float(0.14), omega).toVar();
      const hue = mix(vec3(1.0, 0.5, 0.14), vec3(0.24, 0.62, 1.0), dom).toVar();
      const sat = smoothstep(float(0.02), float(0.24), abs(omega)).toVar(); // 0 in neutral zones
      const base = mix(vec3(0.05, 0.055, 0.11), hue, sat).toVar(); // deep indigo → domain colour
      const streak = pow(clamp(lic, 0, 1), float(1.6)).mul(u.gain).toVar(); // dark background, bright ribbons
      const cc = base.mul(streak.mul(1.25).add(0.12)).toVar();
      cc.addAssign(hue.mul(sat).mul(0.14)); // faint domain glow so the two colours read even in slack flow
      cc.addAssign(vec3(1.0, 0.96, 0.88).mul(clamp(core, 0, 1).mul(1.4))); // white-hot cores
      col.assign(clamp(cc, 0, 1.5));
    } else if (sys.sdf === 'screenedVortex') {
      // ── Fluid: a SCREENED (quasi-geostrophic / equivalent-barotropic) point-vortex gas — the model
      //    behind real geophysical turbulence (Jupiter's bands, ocean eddies). Unlike Onsager's
      //    unscreened 1/r vortices, here the streamfunction obeys (−∇²+R_d⁻²)ψ=q, so each vortex's pull
      //    is cut off exponentially beyond the deformation radius R_d (Yukawa/Bessel-K₀ screening,
      //    approximated as a 1/r kernel × e^{−r/R_d}). Only neighbours interact → many small rotating
      //    islands + translating opposite-sign pairs bind into a full-frame turbulent weave that
      //    "begins as a gas and resembles weather". Two PV signs, two shades each (jade↔emerald /
      //    crimson↔copper); the LIC threads are passive tracers stretched by the flow. Owns col. ──
      const t = uTime.mul(u.speed).mul(0.3);
      const f = vec2(ndc.x, ndc.y).mul(u.zoom).mul(1.4).toVar();
      const K = sys.beams ?? 36;
      const a2 = float(0.004);
      const invRd = float(1).div(u.screen).toVar(); // 1/R_d screening rate
      // ── LIC: march a tracer forward + backward along the screened velocity, average a fine noise ──
      const pf = f.toVar();
      const pb = f.toVar();
      const lic = float(0).toVar();
      const licN = float(0).toVar();
      Loop(8, () => {
        const vfx = float(0).toVar();
        const vfy = float(0).toVar();
        const vbx = float(0).toVar();
        const vby = float(0).toVar();
        Loop(K, ({ i: j }: { i: Node }) => {
          const fj = float(j);
          const grp = floor(fj.mul(0.16667)).toVar(); // 6 same-sign vortices per island → they bind & co-rotate
          const gph = fract(sin(grp.mul(93.719)).mul(17231.1)).mul(6.2831853).toVar();
          const sgn = select(fract(sin(grp.mul(39.425)).mul(24634.6)).lessThan(0.5), float(-1), float(1)).toVar();
          const gcx = fract(sin(grp.mul(12.9898)).mul(43758.5453)).sub(0.5).mul(2.4).add(sin(t.mul(0.4).add(gph)).mul(0.16)).toVar(); // island translates
          const gcy = fract(sin(grp.mul(78.233)).mul(43758.5453)).sub(0.5).mul(2.4).add(cos(t.mul(0.33).add(gph)).mul(0.16)).toVar();
          const jr = fract(sin(fj.mul(45.13)).mul(9812.3)).mul(0.17).add(0.05).toVar(); // member orbit radius (spread so dots separate)
          const jph = fract(sin(fj.mul(77.17)).mul(5123.4)).mul(6.2831853).toVar();
          const rkx = gcx.add(cos(jph.add(t.mul(0.9))).mul(jr)).toVar(); // members orbit the island centre
          const rky = gcy.add(sin(jph.add(t.mul(0.9))).mul(jr)).toVar();
          const dfx = pf.x.sub(rkx);
          const dfy = pf.y.sub(rky);
          const rf2 = dfx.mul(dfx).add(dfy.mul(dfy)).add(a2).toVar();
          const wf = exp(sqrt(rf2).mul(invRd).mul(-1)).div(rf2).toVar(); // screened Biot–Savart weight
          vfx.addAssign(sgn.mul(dfy).mul(-1).mul(wf));
          vfy.addAssign(sgn.mul(dfx).mul(wf));
          const dbx = pb.x.sub(rkx);
          const dby = pb.y.sub(rky);
          const rb2 = dbx.mul(dbx).add(dby.mul(dby)).add(a2).toVar();
          const wb = exp(sqrt(rb2).mul(invRd).mul(-1)).div(rb2).toVar();
          vbx.addAssign(sgn.mul(dby).mul(-1).mul(wb));
          vby.addAssign(sgn.mul(dbx).mul(wb));
        });
        const vfl = sqrt(vfx.mul(vfx).add(vfy.mul(vfy))).add(1e-4);
        const vbl = sqrt(vbx.mul(vbx).add(vby.mul(vby))).add(1e-4);
        pf.addAssign(vec2(vfx.div(vfl), vfy.div(vfl)).mul(0.016));
        pb.subAssign(vec2(vbx.div(vbl), vby.div(vbl)).mul(0.016));
        lic.addAssign(vnoise2(pf.mul(80)));
        lic.addAssign(vnoise2(pb.mul(80)));
        licN.addAssign(2);
      });
      lic.assign(lic.div(licN));
      // ── local PV sign (for the two-tone weave) + sign-separated core glows (the bright clusters) ──
      const omega = float(0).toVar();
      const coreP = float(0).toVar();
      const coreN = float(0).toVar();
      Loop(K, ({ i: j }: { i: Node }) => {
        const fj = float(j);
        const grp = floor(fj.mul(0.16667)).toVar();
        const gph = fract(sin(grp.mul(93.719)).mul(17231.1)).mul(6.2831853).toVar();
        const sgn = select(fract(sin(grp.mul(39.425)).mul(24634.6)).lessThan(0.5), float(-1), float(1)).toVar();
        const gcx = fract(sin(grp.mul(12.9898)).mul(43758.5453)).sub(0.5).mul(2.4).add(sin(t.mul(0.4).add(gph)).mul(0.16)).toVar();
        const gcy = fract(sin(grp.mul(78.233)).mul(43758.5453)).sub(0.5).mul(2.4).add(cos(t.mul(0.33).add(gph)).mul(0.16)).toVar();
        const jr = fract(sin(fj.mul(45.13)).mul(9812.3)).mul(0.17).add(0.05).toVar();
        const jph = fract(sin(fj.mul(77.17)).mul(5123.4)).mul(6.2831853).toVar();
        const rkx = gcx.add(cos(jph.add(t.mul(0.9))).mul(jr)).toVar();
        const rky = gcy.add(sin(jph.add(t.mul(0.9))).mul(jr)).toVar();
        const dx = f.x.sub(rkx);
        const dy = f.y.sub(rky);
        const d2 = dx.mul(dx).add(dy.mul(dy)).toVar();
        omega.addAssign(sgn.mul(exp(d2.mul(invRd).mul(invRd).mul(-1)))); // screened vorticity footprint
        const glow = exp(d2.mul(-620)).toVar();
        coreP.addAssign(select(sgn.greaterThan(0), glow, float(0)));
        coreN.addAssign(select(sgn.greaterThan(0), float(0), glow));
      });
      // colour: PV sign picks jade vs copper family; a low-frequency noise slides each between its two
      // shades (jade↔emerald / crimson↔copper); the LIC threads light the woven mid-tone background;
      // the vortex cores burn bright mint (⊕) or warm amber (⊖) — the glowing point clusters.
      const dom = smoothstep(float(-0.14), float(0.14), omega).toVar();
      const shade = vnoise2(f.mul(1.7).add(t.mul(0.08))).toVar();
      const jade = mix(vec3(0.16, 0.30, 0.15), vec3(0.42, 0.60, 0.30), shade).toVar(); // emerald → jade (olive)
      const copper = mix(vec3(0.40, 0.22, 0.10), vec3(0.66, 0.44, 0.22), shade).toVar(); // crimson → copper (tan)
      const hue = mix(copper, jade, dom).toVar();
      const streak = pow(clamp(lic, 0, 1), float(1.7)).mul(u.gain).toVar(); // finer, higher-contrast threads
      const cc = hue.mul(streak.mul(0.9).add(0.34)).toVar(); // woven mid-tone stays visible
      cc.addAssign(vec3(0.55, 1.0, 0.75).mul(clamp(coreP, 0, 1).mul(1.3))); // mint ⊕ cores
      cc.addAssign(vec3(1.0, 0.62, 0.24).mul(clamp(coreN, 0, 1).mul(1.3))); // amber ⊖ cores
      col.assign(clamp(cc, 0, 1.6));
    } else if (sys.sdf === 'jellyfishBloom') {
      // ── Bloom: a drifting swarm of bioluminescent jellyfish. Each is a pulsing translucent bell (a
      //    glowing elliptical membrane + soft inner light) trailing wavy tentacles, in cool living-light
      //    colours over an abyssal gradient flecked with marine snow. Pure additive glow over the dark. ──
      const t = uTime.mul(0.5).mul(u.animate);
      const p = vec2(ndc.x, ndc.y).mul(u.zoom).toVar();
      col.assign(mix(vec3(0.012, 0.03, 0.05), vec3(0.0, 0.008, 0.02), ndc.y.mul(0.5).add(0.5))); // abyss
      // marine snow: faint round motes drifting slowly upward (hashed point per cell, not whole cells)
      const sP = vec2(p.x, p.y.add(t.mul(0.04))).mul(9).toVar();
      const scell = floor(sP);
      const sf = fract(sP).sub(0.5);
      const sh = fract(sin(dot(scell, vec2(12.9, 78.2))).mul(43758.5453));
      const sh2 = fract(sin(dot(scell, vec2(63.7, 11.4))).mul(24634.6345));
      const md = sf.sub(vec2(sh.sub(0.5), sh2.sub(0.5)).mul(0.6));
      col.assign(col.add(vec3(0.4, 0.6, 0.75).mul(exp(md.dot(md).mul(-55)).mul(pow(sh, 28).mul(0.4)))));
      const N = sys.lobes ?? 6;
      for (let j = 0; j < N; j++) {
        const bx = ((j * 0.61803398875) % 1) * 2 - 1; // spread base positions (compile-time)
        const by = ((j * 0.4142 + 0.31) % 1) * 2 - 1;
        const cx = float(bx * 1.2).add(sin(t.mul(0.6).add(j * 1.3)).mul(0.16));
        const cy = float(by * 0.8).add(sin(t.mul(0.4).add(j * 2.1)).mul(0.1));
        const q = vec2(p.x.sub(cx), p.y.sub(cy)).toVar();
        const pulse = sin(t.mul(2.2).add(j * 1.7)).mul(0.1).mul(u.pulse);
        const rw = float(0.24 + (j % 3) * 0.03).add(pulse); // bell half-width (pulses)
        const rh = float(0.18 + (j % 2) * 0.03).sub(pulse.mul(0.6)); // bell half-height (anti-phase → propulsion)
        const e = length(vec2(q.x.div(rw), q.y.div(rh))).toVar(); // elliptical radius
        const upper = smoothstep(-0.12, 0.08, q.y); // the bell occupies the upper half
        const rim = exp(e.sub(1).mul(e.sub(1)).mul(-45)).mul(upper); // glowing membrane edge
        const fill = exp(e.mul(e).mul(-2)).mul(0.35).mul(upper); // soft inner light
        const jhue = u.colShift.add(j * 0.11).mul(6.2832);
        const jcol = vec3(cos(jhue).mul(0.28).add(0.32), 0.72, cos(jhue.add(2.2)).mul(0.25).add(0.72)); // cyan↔violet
        col.assign(col.add(jcol.mul(rim.add(fill).mul(u.glow))));
        // tentacles: a few wavy glowing strands hanging below the bell
        const ty = q.y.negate().toVar(); // depth below the bell centre
        for (let s = 0; s < 3; s++) {
          const off = (s / 2 - 0.5) * 0.22;
          const wav = sin(q.y.mul(8).sub(t.mul(3)).add(j + s)).mul(0.05).mul(smoothstep(0, 0.6, ty));
          const tox = q.x.sub(off).add(wav);
          const strand = exp(tox.mul(tox).mul(-220)).mul(smoothstep(0.02, 0.3, ty)).mul(exp(ty.mul(-1.5)));
          col.assign(col.add(jcol.mul(strand.mul(u.glow.mul(0.9)))));
        }
      }
      col.assign(clamp(col, 0, 1));
    } else if (sys.sdf === 'volumetric') {
      // ── Non-SDF marcher: accumulate volumetric EMISSION through a domain-warped density field. ──
      // Fixed-step ray, no bending. Density e drives o += exp(−e·k)·palette·e·Δs·E (the twigl look).
      const STEP = float(sys.volStep ?? 0.06);
      const K = u.absorb; // self-attenuation: e·exp(−e·k) peaks at e=1/k → mid-density wisps glow most
      const SCALE = u.scale; // field frequency (capped in the registry for fp32 hash safety)
      const RB = float(sys.bound);

      // occlude (opt-in per preset): front-to-back compositing so near density occludes far → crisp
      // SOLID voxels. Left off (default) for plasma/nebula → pure additive emission, byte-identical.
      const occlude = !!sys.occlude;
      const pos = ro.toVar();
      // per-pixel step dither (occlusion only) → breaks the fixed-march terracing on hard voxel faces
      // into fine noise. Plasma/nebula are smooth and stay un-dithered (byte-identical).
      if (occlude) pos.addAssign(rd.mul(STEP.mul(fract(sin(ndc.x.mul(12.99).add(ndc.y.mul(78.23))).mul(43758.5)))));
      const emis = vec3(0).toVar();
      const trans = occlude ? float(1).toVar() : null; // remaining transmittance along the ray
      // camDist often EXCEEDS bound for these compact volumes, so only break once we've entered then left
      const entered = float(0).toVar();
      const ca = cos(uTime.mul(0.15)).toVar(); // slow domain churn about Y so the volume evolves
      const sa = sin(uTime.mul(0.15)).toVar();

      Loop(sys.maxSteps, () => {
        const r = length(pos).toVar();
        If(r.lessThan(RB), () => { entered.assign(1); });
        If(entered.greaterThan(0.5).and(r.greaterThan(RB)), () => { Break(); });
        If(r.lessThan(RB), () => {
          const q = vec3(
            pos.x.mul(ca).sub(pos.z.mul(sa)),
            pos.y,
            pos.x.mul(sa).add(pos.z.mul(ca)),
          ).mul(SCALE).toVar();
          const e = float(0).toVar();
          const toneOff = occlude ? float(0).toVar() : null; // per-cell two-tone hue offset (voxel only)
          if (sys.sdf2 === 'plasmaOrb') {
            // hollow plasma shell at r≈1 (thin), textured by hi-freq trig × one warp octave; pow → contrast
            const base = clamp(float(1).sub(abs(length(q).sub(1.0)).div(0.42)), 0, 1).toVar();
            const tex = cos(q.x.mul(9).add(uTime))
              .mul(cos(q.y.mul(9).sub(uTime.mul(0.7))))
              .mul(cos(q.z.mul(9))).mul(0.5).add(0.5).toVar();
            const fil = warp1(q.mul(2.2)).toVar(); // marbled filaments
            e.assign(pow(base, 1.5).mul(tex.mul(0.45).add(0.25)).mul(fil.mul(1.6).pow(1.5)));
          } else if (sys.sdf2 === 'voxelCloud') {
            // "I Eat Pixels": blocky fire/ice cubes — quantize q to a cubic lattice, density at the cell
            // CENTRE (flat per voxel), two-tone by a per-cell hash, rim-light faces. Occlusion makes them solid.
            const N = float(sys.cells ?? 3.0);
            const cell = floor(q.mul(N)).toVar();
            const cc2 = cell.add(0.5).div(N).toVar();
            const dens = max(fbm3(cc2.mul(2.0)).sub(0.5), 0).mul(float(1).div(float(1).sub(0.5))).toVar();
            toneOff.assign(hash31(cell).sub(0.5).mul(2.6)); // ±1.3 rad palette swing → fire vs ice
            const lf = fract(q.mul(N)).toVar();
            const edgeDist = min(
              min(lf.x, float(1).sub(lf.x)),
              min(min(lf.y, float(1).sub(lf.y)), min(lf.z, float(1).sub(lf.z))),
            ).toVar();
            const edge = clamp(float(1).sub(edgeDist.div(0.1)), 0, 1).mul(u.edge).toVar();
            const filled = clamp(dens.mul(1e4), 0, 1).toVar();
            e.assign(clamp(dens.add(edge.mul(filled)), 0, 1));
          } else if (sys.sdf2 === 'flower') {
            // everlasting flower: sin-octave turbulence in a LOG-SPHERICAL domain (the つぶやきGLSL
            // genre — feathery self-similar petal layers), combed into petals by an azimuthal ridge
            // wave that leans with the polar angle (cupped petals), inside a rounded bloom envelope.
            const rq = length(q).max(1e-4).toVar();
            const phi = atan(q.z, q.x).toVar();
            const pol = acos(clamp(q.y.div(rq), -1, 1)).toVar();
            const lp = vec3(log2(rq.add(0.25)).mul(3.0), pol.mul(2.2), phi).toVar();
            const turb = float(0).toVar();
            for (let oc = 1; oc <= 5; oc++) {
              const s = float(1 << oc); // 2,4,8,16,32 — fixed octaves (TSL loop bounds are compile-time)
              turb.addAssign(dot(sin(lp.yzy.mul(s).add(uTime.mul(0.2))), sin(lp.xxz.mul(s))).div(s));
            }
            // petal VANES: thin azimuthal ridges (pow-sharpened) that twist with log-radius — thin
            // radial sheets survive the line integral where a soft angular blend would fog out
            const comb = sin(phi.mul(u.petals).add(pol.mul(3.0)).add(turb.mul(2.2)).add(lp.x.mul(0.7))).mul(0.5).add(0.5).toVar();
            const vane = pow(comb, 6.0).toVar();
            // scalloped silhouette: the envelope's outer edge extends where a vane runs, so petal
            // TIPS break the outline instead of a smooth ball
            const rEdge = float(0.68).add(vane.mul(0.38)).toVar();
            const env = float(1).sub(smoothstep(rEdge.mul(0.62), rEdge, rq)).mul(smoothstep(float(0.02), float(0.22), rq)).toVar();
            const wisp = max(turb.sub(0.55), 0).mul(0.3); // sparse turbulent fluff between vanes
            e.assign(pow(clamp(env.mul(vane.mul(turb.mul(0.4).add(0.8)).add(wisp)).mul(2.2), 0, 1), 1.3));
          } else {
            // nebula: fbm cloud (full recursive warp) thresholded to wisps, with a radial falloff
            const cloud = warpFull(q.mul(0.9).add(vec3(uTime.mul(0.05), 0, 0))).toVar();
            const fall = clamp(float(1).sub(length(q).div(2.6)), 0, 1).toVar();
            e.assign(max(cloud.sub(0.45), 0).mul(2.0).mul(fall));
          }
          const ec = clamp(e, 0, 1).toVar();
          // cosine palette keyed by density + live colShift (+ per-cell two-tone when occluding);
          // the flower instead keys its palette by POSITION — cream heart, blush petals, green sepals
          let aExpr = ec.mul(2.0).add(u.colShift.mul(6.2832)).add(0.3);
          if (occlude) aExpr = aExpr.add(toneOff);
          const a = aExpr.toVar();
          let pal;
          if (sys.sdf2 === 'flower') {
            // NOTE: the volumetric ray reconstruction displays world −y at screen-top (invisible in the
            // y-symmetric plasma/nebula/blackhole fields; first seen here) — so "below the bloom" is +y.
            const sep = smoothstep(float(0.05), float(0.5), pos.y).mul(smoothstep(float(0.3), float(0.6), r)).toVar(); // sepals wrap the outer shell, screen-bottom
            const core = float(1).sub(smoothstep(float(0.08), float(0.3), r)).toVar(); // small cream heart
            const shiftA = u.colShift.mul(6.2832);
            const petal = vec3(float(1.02), cos(shiftA).mul(0.15).add(0.55), cos(shiftA.add(1.6)).mul(0.2).add(0.5));
            pal = mix(mix(petal, vec3(0.28, 0.62, 0.2), sep), vec3(1.05, 0.98, 0.85), core);
          } else {
            pal = vec3(cos(a), cos(a.add(2.1)), cos(a.add(4.2))).mul(0.5).add(0.5);
          }
          if (occlude) {
            // front-to-back emission–absorption: opacity this step (Beer–Lambert), emit·transmittance, attenuate
            const aStep = float(1).sub(exp(ec.mul(K).mul(STEP).negate())).toVar();
            emis.addAssign(pal.mul(aStep).mul(trans).mul(u.exposure));
            trans.assign(trans.mul(float(1).sub(aStep)));
          } else {
            emis.addAssign(pal.mul(ec).mul(exp(ec.mul(K.negate()))).mul(STEP).mul(u.exposure));
          }
        });
        pos.addAssign(rd.mul(STEP));
        if (occlude) If(trans.lessThan(0.02), () => { Break(); }); // ray opaque — stop early
      });
      if (occlude) col.assign(col.add(emis)); // already composited (bounded by 1−transmittance)
      else col.assign(col.add(vec3(tanh(emis.x), tanh(emis.y), tanh(emis.z)))); // tanh tone-map (additive)
    } else {
    // clip the march to the fractal's bounding sphere (origin, radius bound)
    const bnd = float(sys.bound);
    const bdot = ro.dot(rd);
    const cc = ro.dot(ro).sub(bnd.mul(bnd));
    const disc = bdot.mul(bdot).sub(cc);
    If(disc.greaterThan(0), () => {
      const sq = disc.sqrt();
      const tN = max(bdot.negate().sub(sq), 0).toVar();
      const tF = bdot.negate().add(sq).toVar();
      If(tF.greaterThan(tN), () => {
        const t = tN.toVar();
        const hit = float(0).toVar();
        const hp = vec3(0).toVar();
        const trap = float(0).toVar();
        Loop(sys.maxSteps, () => {
          const p = ro.add(rd.mul(t)).toVar();
          const m = map(p).toVar();
          const d = m.x.toVar();
          If(d.lessThan(max(float(0.00035).mul(t), 0.00004)), () => {
            hit.assign(1);
            hp.assign(p);
            trap.assign(m.y);
            Break();
          });
          t.addAssign(d);
          If(t.greaterThan(tF), () => {
            Break();
          });
        });
        If(hit.greaterThan(0.5), () => {
          const n = calcNormal(hp).toVar();
          If(n.dot(rd).greaterThan(0), () => { n.assign(n.negate()); }); // face the camera (implicit surfaces flip sign). Braces avoid the implicit-return the arrow would otherwise hand If() — r185 warns on a return inside an inline Fn's If().
          const diff = max(n.dot(LIGHT), 0).toVar();
          const sh = softShadow(hp.add(n.mul(0.0025)), LIGHT).toVar();
          const ao = calcAO(hp, n).toVar();
          const amb = n.y.mul(0.25).add(0.4).toVar();
          const fres = pow(max(float(1).sub(n.dot(rd.negate()).max(0)), 0), 3).toVar();
          // colour: kaleidoscope = flat faceted palette; everything else = the orbit-trap cosine palette
          let base: Node;
          if (sys.sdf === 'kaleidoTunnel') {
            const isHalf = trap.greaterThan(0.5);
            const dim = select(isHalf, float(0.72), float(1.0)); // mirror half dimmed → two-tone facets
            const segBase = trap.sub(select(isHalf, float(0.5), float(0))); // per-ring hash ∈ [0,0.49)
            const hue = mod(segBase.div(0.49).mul(6).add(u.colShift.mul(6)), 6).toVar();
            const ph = floor(hue).div(6).mul(6.2831853).toVar(); // quantised hue wheel → flat per facet
            base = vec3(
              cos(ph).mul(0.4).add(0.55),
              cos(ph.add(2.094)).mul(0.4).add(0.55),
              cos(ph.add(4.188)).mul(0.4).add(0.55),
            ).mul(dim).toVar();
          } else {
            // orbit-trap → cosine palette
            const tt = trap.sqrt().mul(2.4).add(u.colShift.mul(6.2832)).toVar();
            base = vec3(
              cos(tt).mul(0.5).add(0.5),
              cos(tt.add(2.1)).mul(0.5).add(0.5),
              cos(tt.add(4.2)).mul(0.5).add(0.5),
            ).toVar();
          }
          const lit = base
            .mul(amb.mul(ao))
            .add(base.mul(diff.mul(sh)))
            .add(vec3(1).mul(fres.mul(ao).mul(0.45)));
          col.assign(lit);
        });
      });
    });
    } // end SDF path

    return vec4(clamp(col, 0, 1), 1);
  })();

  const geo = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  return {
    mesh,
    cameraDistance: sys.camDist,
    setParams(p: Record<string, number>): void {
      for (const spec of sys.params) if (spec.key in p) u[spec.key].value = p[spec.key];
    },
    update(elapsed: number): void {
      uTime.value = elapsed;
    },
    dispose(): void {
      geo.dispose();
      mat.dispose();
    },
  };
}

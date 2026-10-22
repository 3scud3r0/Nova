import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { spectralGradient } from '../core/color';

// Parametric geometry: a formula maps an index (or a (u,v) grid cell) to a 3D point, sampled into a
// glowing point cloud. Covers Fibonacci/phyllotaxis sequences and classic parametric surfaces
// (torus, Klein bottle, Möbius, seashell, superformula). Static between parameter changes — step()
// recomputes only when a slider moves — so dragging a shape knob reshapes it live, no rebuild.
const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // golden angle ≈ 2.39996 rad

// Normalized (u,v) ∈ [0,1]² for grid-sampled surfaces (W×W from the particle count).
function uv(i: number, n: number): [number, number] {
  const W = Math.max(2, Math.round(Math.sqrt(n)));
  return [(i % W) / (W - 1), Math.floor(i / W) / (W - 1)];
}

// 1-D superformula radius (Gielis): r(φ) = (|cos(mφ/4)/a|^n2 + |sin(mφ/4)/b|^n3)^(-1/n1)
function superR(angle: number, m: number, n1: number, n2: number, n3: number): number {
  const t = (m * angle) / 4;
  const a = Math.pow(Math.abs(Math.cos(t)), n2);
  const b = Math.pow(Math.abs(Math.sin(t)), n3);
  const s = a + b;
  if (s < 1e-6) return 0;
  return Math.min(Math.pow(s, -1 / Math.max(n1, 1e-3)), 4);
}

// Signed power: sign(t)·|t|^e — keeps pow-of-negative finite for super-shapes (super-toroid etc.).
function sgnpow(t: number, e: number): number {
  return Math.sign(t) * Math.pow(Math.abs(t), e);
}

// Sweep a circular tube of radius `rad` along a space curve. C(t) is the centreline, dC(t) its
// tangent. Index i is split into (around-the-tube, along-the-curve); a fixed up-vector frame avoids
// the cost of parallel transport (a closed knot tolerates the mild twist this introduces).
function sweepTube(
  i: number,
  n: number,
  rad: number,
  out: Float32Array,
  o: number,
  C: (t: number) => [number, number, number],
  dC: (t: number) => [number, number, number],
): void {
  const around = 24;
  const alongCount = Math.max(1, Math.floor(n / around));
  const ai = i % around;
  const t = (Math.floor(i / around) / alongCount) * TAU;
  const v = (ai / around) * TAU;
  const c = C(t);
  const d = dC(t);
  let tx = d[0], ty = d[1], tz = d[2];
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  // N = normalize(up × T); swap up away from T to keep the cross product well-conditioned
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(ty) > 0.9) { ux = 1; uy = 0; uz = 0; }
  let nx = uy * tz - uz * ty, ny = uz * tx - ux * tz, nz = ux * ty - uy * tx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx; // B = T × N
  const cv = Math.cos(v), sv = Math.sin(v);
  out[o] = c[0] + rad * (cv * nx + sv * bx);
  out[o + 1] = c[1] + rad * (cv * ny + sv * by);
  out[o + 2] = c[2] + rad * (cv * nz + sv * bz);
}

// Cumulative turning angles of the Spiral of Theodorus: θ_v = Σ_{j=1}^{v} (atan(1/√j) + drift). The
// running sum is O(N), so memoize it per (N, drift) — rebuild() calls position() for every particle
// with the same params, and recomputing the sum inside each call would be O(n·N). Single-threaded
// rebuild ⇒ a module-level cache is safe.
let _theoCache: { N: number; drift: number; th: Float64Array } | null = null;
function theodorusAngles(N: number, drift: number): Float64Array {
  if (_theoCache && _theoCache.N === N && _theoCache.drift === drift) return _theoCache.th;
  const th = new Float64Array(N);
  let acc = 0;
  for (let v = 1; v < N; v++) {
    acc += Math.atan(1 / Math.sqrt(v)) + drift; // unit leg at radius √v subtends atan(1/√v); drift twists it
    th[v] = acc;
  }
  _theoCache = { N, drift, th };
  return th;
}

export interface ParamSurface {
  id: string;
  label: string;
  defaultParticleCount: number;
  scale: number;
  pointSize: number;
  params: ParamSpec[];
  position: (i: number, n: number, p: ResolvedParams, out: Float32Array, o: number) => void;
}

export const PARAMETRIC_SYSTEMS: Record<string, ParamSurface> = {
  fibonacci: {
    id: 'fibonacci', label: 'Fibonacci Sphere', defaultParticleCount: 120_000, scale: 1.45, pointSize: 0.01,
    params: [
      { key: 'twist', label: 'twist', min: 0, max: 4, step: 0.01, default: 1 },
      { key: 'squash', label: 'squash', min: 0.3, max: 1.6, step: 0.01, default: 1 },
    ],
    position: (i, n, p, out, o) => {
      const y = 1 - (2 * (i + 0.5)) / n; // -1 → 1
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * GOLDEN * p.twist;
      out[o] = r * Math.cos(th);
      out[o + 1] = y * p.squash;
      out[o + 2] = r * Math.sin(th);
    },
  },
  torus: {
    id: 'torus', label: 'Torus', defaultParticleCount: 160_000, scale: 0.55, pointSize: 0.008,
    params: [
      { key: 'R', label: 'R (ring)', min: 1, max: 3, step: 0.01, default: 2 },
      { key: 'r', label: 'r (tube)', min: 0.2, max: 1.4, step: 0.01, default: 0.8 },
    ],
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = a * TAU;
      const v = b * TAU;
      const w = p.R + p.r * Math.cos(v);
      out[o] = w * Math.cos(u);
      out[o + 1] = p.r * Math.sin(v);
      out[o + 2] = w * Math.sin(u);
    },
  },
  klein: {
    id: 'klein', label: 'Klein Bottle', defaultParticleCount: 200_000, scale: 0.42, pointSize: 0.008,
    params: [{ key: 'size', label: 'size', min: 1.5, max: 4, step: 0.01, default: 3 }],
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = a * TAU;
      const v = b * TAU;
      const c2 = Math.cos(u / 2);
      const s2 = Math.sin(u / 2);
      const sv = Math.sin(v);
      const s2v = Math.sin(2 * v);
      const w = p.size + c2 * sv - s2 * s2v; // figure-8 immersion
      out[o] = w * Math.cos(u);
      out[o + 1] = s2 * sv + c2 * s2v;
      out[o + 2] = w * Math.sin(u);
    },
  },
  mobius: {
    id: 'mobius', label: 'Möbius Strip', defaultParticleCount: 120_000, scale: 1.0, pointSize: 0.008,
    params: [
      { key: 'width', label: 'width', min: 0.2, max: 1.6, step: 0.01, default: 0.9 },
      { key: 'twists', label: 'half-twists', min: 1, max: 6, step: 1, default: 1 },
    ],
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = a * TAU;
      const v = (b * 2 - 1) * p.width; // [-width, width]
      const h = (p.twists * u) / 2;
      const rad = 1.6 + v * 0.5 * Math.cos(h);
      out[o] = rad * Math.cos(u);
      out[o + 1] = v * 0.5 * Math.sin(h);
      out[o + 2] = rad * Math.sin(u);
    },
  },
  seashell: {
    id: 'seashell', label: 'Seashell', defaultParticleCount: 200_000, scale: 0.5, pointSize: 0.008,
    params: [
      { key: 'turns', label: 'turns', min: 2, max: 8, step: 0.1, default: 5 },
      { key: 'taper', label: 'taper', min: 0.4, max: 1.6, step: 0.01, default: 1 },
    ],
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = a * Math.PI * p.turns; // along the spiral
      const v = b * TAU; // around the tube
      const e = Math.exp(u / (p.turns * Math.PI));
      const cs = Math.cos(v / 2) ** 2;
      // logarithmic-spiral shell (z = up)
      out[o] = 2 * (1 - e) * Math.cos(u) * cs;
      out[o + 1] = (1 - Math.exp((2 * u) / (p.turns * Math.PI)) - Math.sin(v) + e * Math.sin(v)) * p.taper;
      out[o + 2] = 2 * (e - 1) * Math.sin(u) * cs;
    },
  },
  superformula: {
    id: 'superformula', label: 'Superformula', defaultParticleCount: 200_000, scale: 1.15, pointSize: 0.008,
    params: [
      { key: 'm', label: 'symmetry m', min: 1, max: 14, step: 1, default: 7 },
      { key: 'n1', label: 'n₁', min: 0.1, max: 4, step: 0.01, default: 0.3 },
      { key: 'n2', label: 'n₂', min: 0.1, max: 4, step: 0.01, default: 1.7 },
      { key: 'n3', label: 'n₃', min: 0.1, max: 4, step: 0.01, default: 1.7 },
    ],
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const phi = a * TAU - Math.PI; // [-π, π]
      const theta = b * Math.PI - Math.PI / 2; // [-π/2, π/2]
      const r1 = superR(phi, p.m, p.n1, p.n2, p.n3);
      const r2 = superR(theta, p.m, p.n1, p.n2, p.n3);
      const ct = r2 * Math.cos(theta);
      out[o] = r1 * Math.cos(phi) * ct;
      out[o + 1] = r2 * Math.sin(theta);
      out[o + 2] = r1 * Math.sin(phi) * ct;
    },
  },
  sunflower: {
    id: 'sunflower', label: 'Sunflower', defaultParticleCount: 120_000, scale: 1.5, pointSize: 0.01,
    params: [
      { key: 'dome', label: 'dome', min: 0, max: 1.5, step: 0.01, default: 0.5 },
      { key: 'spread', label: 'spread', min: 0.6, max: 1.6, step: 0.01, default: 1 },
    ],
    // Vogel's model — the flat phyllotaxis seed head (golden-angle spiral), gently domed into 3D.
    position: (i, n, p, out, o) => {
      const r = Math.sqrt((i + 0.5) / n); // equal-area radius
      const th = i * GOLDEN;
      const rr = r * p.spread;
      out[o] = rr * Math.cos(th);
      out[o + 1] = p.dome * (1 - r * r) - 0.2; // gentle central dome
      out[o + 2] = rr * Math.sin(th);
    },
  },
  torusknot: {
    id: 'torusknot', label: 'Torus Knot', defaultParticleCount: 144_000, scale: 0.5, pointSize: 0.007,
    params: [
      { key: 'p', label: 'p (longit.)', min: 1, max: 9, step: 1, default: 2 },
      { key: 'q', label: 'q (merid.)', min: 1, max: 9, step: 1, default: 3 },
      { key: 'tube', label: 'thickness', min: 0.05, max: 0.6, step: 0.01, default: 0.28 },
    ],
    // (p,q) torus knot swept into a solid tube — p=2,q=3 is the trefoil. coprime p,q ⇒ a true knot.
    position: (i, n, pp, out, o) => {
      sweepTube(i, n, pp.tube, out, o, (t) => {
        const w = 2 + Math.cos(pp.q * t);
        return [w * Math.cos(pp.p * t), -Math.sin(pp.q * t), w * Math.sin(pp.p * t)];
      }, (t) => {
        const cqt = Math.cos(pp.q * t), sqt = Math.sin(pp.q * t);
        const cpt = Math.cos(pp.p * t), spt = Math.sin(pp.p * t);
        const w = 2 + cqt;
        return [
          -pp.q * sqt * cpt - pp.p * w * spt,
          -pp.q * cqt,
          -pp.q * sqt * spt + pp.p * w * cpt,
        ];
      });
    },
  },
  lissajous: {
    id: 'lissajous', label: 'Lissajous Curve', defaultParticleCount: 120_000, scale: 1.5, pointSize: 0.006,
    params: [
      { key: 'a', label: 'a', min: 1, max: 8, step: 1, default: 3 },
      { key: 'b', label: 'b', min: 1, max: 8, step: 1, default: 2 },
      { key: 'c', label: 'c', min: 1, max: 8, step: 1, default: 4 },
      { key: 'phase', label: 'phase', min: 0, max: Math.PI, step: 0.01, default: Math.PI / 2 },
      { key: 'tube', label: 'thickness', min: 0.02, max: 0.2, step: 0.005, default: 0.07 },
    ],
    // 3D Lissajous: three sinusoids at integer frequencies — the higher-dimensional cousin of the
    // oscilloscope figures. Closes into a knot when a:b:c are coprime. Swept into a solid tube.
    position: (i, n, p, out, o) => {
      sweepTube(
        i, n, p.tube, out, o,
        (t) => [Math.sin(p.a * t + p.phase), Math.sin(p.b * t), Math.sin(p.c * t)],
        (t) => [p.a * Math.cos(p.a * t + p.phase), p.b * Math.cos(p.b * t), p.c * Math.cos(p.c * t)],
      );
    },
  },
  harmonograph: {
    id: 'harmonograph', label: 'Harmonograph', defaultParticleCount: 160_000, scale: 0.8, pointSize: 0.007,
    params: [
      { key: 'symmetry', label: 'symmetry N', min: 3, max: 12, step: 1, default: 6 },
      { key: 'ratio', label: 'freq ratio b', min: 1, max: 8, step: 1, default: 4 },
      { key: 'damp', label: 'damping', min: 0, max: 1, step: 0.01, default: 0.45 },
      { key: 'phase', label: 'phase', min: 0, max: Math.PI, step: 0.01, default: 0 },
      { key: 'lift', label: '3D lift', min: 0.02, max: 0.3, step: 0.01, default: 0.08 },
      { key: 'tube', label: 'thickness', min: 0.006, max: 0.05, step: 0.002, default: 0.018 },
    ],
    // A harmonograph mandala as one closed curve. All three phasor frequencies are ≡ 1 (mod N), so
    // C(t+2π/N) = e^{i·2π/N}·C(t) — an exact N-fold rosette. A 2π/N-periodic "breathing" envelope
    // exp(−d(1−cos Nt)) pulls each lobe inward to draw the central starburst without breaking symmetry
    // or closure; the retrograde fast term (ω₂=1−N(b+1)) throws long chords through the centre. Tube-swept.
    position: (i, n, p, out, o) => {
      const N = Math.max(2, Math.round(p.symmetry));
      const b = Math.max(1, Math.round(p.ratio));
      const w1 = 1 + N * b; // ≡ 1 (mod N)
      const w2 = 1 - N * (b + 1); // ≡ 1 (mod N), retrograde
      const A0 = 1, A1 = 0.55, A2 = 0.32;
      const ph = p.phase, d = p.damp, lift = p.lift;
      sweepTube(i, n, p.tube, out, o, (t) => {
        const env = Math.exp(-d * (1 - Math.cos(N * t)));
        const x = env * (A0 * Math.cos(t) + A1 * Math.cos(w1 * t + ph) + A2 * Math.cos(w2 * t));
        const y = env * (A0 * Math.sin(t) + A1 * Math.sin(w1 * t + ph) + A2 * Math.sin(w2 * t));
        return [x, y, lift * Math.sin(N * t)]; // X-Y plane faces the camera; small z-lift for depth
      }, (t) => {
        const env = Math.exp(-d * (1 - Math.cos(N * t)));
        const denv = env * (-d * N * Math.sin(N * t));
        const sx = A0 * Math.cos(t) + A1 * Math.cos(w1 * t + ph) + A2 * Math.cos(w2 * t);
        const sy = A0 * Math.sin(t) + A1 * Math.sin(w1 * t + ph) + A2 * Math.sin(w2 * t);
        const dsx = -(A0 * Math.sin(t) + A1 * w1 * Math.sin(w1 * t + ph) + A2 * w2 * Math.sin(w2 * t));
        const dsy = A0 * Math.cos(t) + A1 * w1 * Math.cos(w1 * t + ph) + A2 * w2 * Math.cos(w2 * t);
        return [denv * sx + env * dsx, denv * sy + env * dsy, lift * N * Math.cos(N * t)];
      });
    },
  },
  dini: {
    id: 'dini', label: "Dini's Surface", defaultParticleCount: 160_000, scale: 0.42, pointSize: 0.008,
    params: [
      { key: 'twist', label: 'twist', min: 0.05, max: 1.2, step: 0.01, default: 0.3 },
      { key: 'turns', label: 'turns', min: 1, max: 5, step: 0.1, default: 2.5 },
    ],
    // The twisted pseudosphere — a surface of constant negative curvature spiralling up an axis.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = a * p.turns * TAU;
      const v = 0.12 + b * (1.45 - 0.12); // (0.12, 1.45) keeps ln(tan(v/2)) finite
      const sv = Math.sin(v);
      out[o] = Math.cos(u) * sv;
      out[o + 1] = Math.cos(v) + Math.log(Math.tan(v / 2)) + p.twist * u - 1; // up (centred funnel)
      out[o + 2] = Math.sin(u) * sv;
    },
  },
  harmonic: {
    id: 'harmonic', label: 'Harmonic Sphere', defaultParticleCount: 160_000, scale: 1.3, pointSize: 0.008,
    params: [
      { key: 'lobesU', label: 'lobes φ', min: 1, max: 10, step: 1, default: 4 },
      { key: 'lobesV', label: 'lobes θ', min: 1, max: 10, step: 1, default: 5 },
      { key: 'amp', label: 'amplitude', min: 0, max: 0.7, step: 0.01, default: 0.35 },
    ],
    // A sphere whose radius is modulated by a product of sinusoids — the look of a spherical-harmonic
    // mode: petals, sea-urchins, bumpy planets.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const phi = a * TAU;
      const theta = b * Math.PI;
      const st = Math.sin(theta);
      const r = 1 + p.amp * Math.sin(p.lobesU * phi) * Math.sin(p.lobesV * theta);
      out[o] = r * st * Math.cos(phi);
      out[o + 1] = r * Math.cos(theta);
      out[o + 2] = r * st * Math.sin(phi);
    },
  },
  boy: {
    id: 'boy', label: "Boy's Surface", defaultParticleCount: 200_000, scale: 0.7, pointSize: 0.008,
    params: [
      { key: 'bulge', label: 'bulge', min: 0.3, max: 1, step: 0.01, default: 1 },
    ],
    // Apéry's parametrization — an immersion of the real projective plane RP² with no singular points
    // and 3-fold symmetry. The shared denominator never vanishes for bulge ≤ 1, so every point is
    // finite. z is centred by −1.5 so the model sits on the origin.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = a * Math.PI; // [0, π]
      const v = b * Math.PI; // [0, π]
      const cv2 = Math.cos(v) ** 2;
      const s2v = Math.sin(2 * v);
      const denom = 2 - p.bulge * Math.SQRT2 * Math.sin(3 * u) * s2v; // ≥ 0.586 for bulge ≤ 1
      out[o] = (Math.SQRT2 * Math.cos(2 * u) * cv2 + Math.cos(u) * s2v) / denom;
      out[o + 1] = (3 * cv2) / denom - 1.5; // up axis, centred
      out[o + 2] = (Math.SQRT2 * Math.sin(2 * u) * cv2 - Math.sin(u) * s2v) / denom;
    },
  },
  roman: {
    id: 'roman', label: 'Roman Surface', defaultParticleCount: 200_000, scale: 3.2, pointSize: 0.008,
    params: [
      { key: 'fold', label: 'fold', min: 0.2, max: 1.6, step: 0.01, default: 1 },
      { key: 'pinch', label: 'pinch', min: 0.5, max: 1.5, step: 0.01, default: 1 },
    ],
    // Steiner's Roman surface — the unit sphere (a,b,c) folded by the quadratic map (bc, ca, ab).
    // Antipodal points collapse together, so it is really the projective plane RP² immersed in 3-space,
    // with six Whitney-pinch points and three lines of self-intersection meeting at the centre.
    position: (i, n, p, out, o) => {
      const [s, t] = uv(i, n);
      const theta = s * Math.PI; // [0, π]
      const phi = t * TAU; // [0, 2π]
      const st = Math.sin(theta);
      const a = st * Math.cos(phi);
      const b = st * Math.sin(phi);
      const c = Math.cos(theta);
      out[o] = b * c * p.fold;
      out[o + 1] = c * a * p.pinch;
      out[o + 2] = a * b * p.fold;
    },
  },
  hopf: {
    id: 'hopf', label: 'Hopf Fibration', defaultParticleCount: 200_000, scale: 0.3, pointSize: 0.007,
    params: [
      { key: 'tori', label: 'tori', min: 3, max: 12, step: 1, default: 7 },
      { key: 'spread', label: 'spread', min: 0.7, max: 1, step: 0.01, default: 0.92 },
    ],
    // Nested interlocking Villarceau tori. u is split into a discrete latitude band (which torus η)
    // plus the base azimuth φ₀; v runs around the fiber circle ψ — so each torus gets a full
    // azimuth×fiber sweep (the iconic look), not a single fan. Each base point (η,φ₀) lifts to an S³
    // fiber point q=(cos η·cos ψ, cos η·sin ψ, sin η·cos(ψ+φ₀), sin η·sin(ψ+φ₀)), stereographically
    // projected from the q₄=1 pole; η<π/2 keeps q₄<1 so the projection never blows up.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const NB = Math.max(2, Math.round(p.tori));
      const aa = a * NB;
      const bi = Math.min(NB - 1, Math.floor(aa));
      const phi0 = (aa - bi) * TAU; // base azimuth, swept fully within each band
      const etaMax = (Math.PI / 2 - 0.15) * p.spread;
      const eta = 0.18 + ((bi + 0.5) / NB) * (etaMax - 0.18); // latitude → which nested torus
      const psi = b * TAU;
      const ce = Math.cos(eta);
      const se = Math.sin(eta);
      const q1 = ce * Math.cos(psi);
      const q2 = ce * Math.sin(psi);
      const q3 = se * Math.cos(psi + phi0);
      const q4 = se * Math.sin(psi + phi0);
      const denom = 1 - q4;
      const safe = denom < 1e-3 ? 1e-3 : denom; // guard the stereographic pole (q4 < 1 always)
      out[o] = q1 / safe;
      out[o + 1] = q2 / safe;
      out[o + 2] = q3 / safe;
    },
  },
  orbital: {
    id: 'orbital', label: 'Spherical Harmonic', defaultParticleCount: 160_000, scale: 1.56, pointSize: 0.008,
    params: [
      { key: 'l', label: 'l (degree)', min: 1, max: 4, step: 1, default: 3 },
      { key: 'm', label: 'm (order)', min: -4, max: 4, step: 1, default: 0 },
      { key: 'base', label: 'base radius', min: 0, max: 0.5, step: 0.01, default: 0.18 },
    ],
    // Real spherical harmonic Y_lm rendered as an "orbital": radius r = |Y_lm(theta,phi)| + base, so
    // the closed surface bulges into the lobes of the harmonic. l selects the degree (l=3 stacked
    // lobes, l=4 flower); m the order (|m| equatorial nodes, sign picks cos/sin in phi). P_lm is
    // hardcoded for l up to 4. m is clamped to [-l, l]; the base radius keeps it a closed shell.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const phi = a * TAU;
      const theta = b * Math.PI;
      const l = Math.max(1, Math.min(4, Math.round(p.l)));
      const m = Math.max(-l, Math.min(l, Math.round(p.m)));
      const am = m < 0 ? -m : m;
      const x = Math.cos(theta);
      const s = Math.sqrt(Math.max(0, 1 - x * x)); // sin(theta), guarded >= 0
      // Associated Legendre P_l^|m|(cos theta), explicit for l = 1..4.
      let P: number;
      if (l === 1) {
        P = am === 0 ? x : -s;
      } else if (l === 2) {
        P = am === 0 ? 0.5 * (3 * x * x - 1) : am === 1 ? -3 * x * s : 3 * (1 - x * x);
      } else if (l === 3) {
        P = am === 0 ? 0.5 * x * (5 * x * x - 3)
          : am === 1 ? -1.5 * (5 * x * x - 1) * s
          : am === 2 ? 15 * x * (1 - x * x)
          : -15 * s * (1 - x * x);
      } else {
        P = am === 0 ? 0.125 * (35 * x * x * x * x - 30 * x * x + 3)
          : am === 1 ? -2.5 * (7 * x * x * x - 3 * x) * s
          : am === 2 ? 7.5 * (7 * x * x - 1) * (1 - x * x)
          : am === 3 ? -105 * x * s * (1 - x * x)
          : 105 * (1 - x * x) * (1 - x * x);
      }
      // Real-SH normalization K = sqrt((2l+1)/4pi * (l-|m|)!/(l+|m|)!) * (m==0 ? 1 : sqrt2).
      let ratio = 1;
      for (let k = l - am + 1; k <= l + am; k++) ratio /= k; // (l-|m|)!/(l+|m|)!
      const K = Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * ratio) * (m === 0 ? 1 : Math.SQRT2);
      const ang = m > 0 ? Math.cos(m * phi) : m < 0 ? Math.sin(am * phi) : 1;
      const r = Math.abs(K * P * ang) + p.base;
      out[o] = r * s * Math.cos(phi);
      out[o + 1] = r * x;
      out[o + 2] = r * s * Math.sin(phi);
    },
  },
  maurerRose: {
    id: 'maurerRose', label: 'Maurer Rose', defaultParticleCount: 160_000, scale: 1.55, pointSize: 0.008,
    params: [
      { key: 'petals', label: 'petals n', min: 1, max: 9, step: 1, default: 6 },
      { key: 'd', label: 'degree step', min: 1, max: 179, step: 1, default: 71 },
      { key: 'lift', label: '3D lift', min: 0, max: 0.3, step: 0.01, default: 0.06 },
      { key: 'tube', label: 'thickness', min: 0.004, max: 0.04, step: 0.002, default: 0.012 },
    ],
    // A rose curve r = sin(nθ) sampled only at θ = k·d degrees (k = 0…360) and joined by straight
    // chords — the long chords criss-cross the petals into a lace-like web. Swept into a thin tube.
    position: (i, n, p, out, o) => {
      const DEG = Math.PI / 180;
      const SEG = 360; // 360 chords between 361 sample vertices
      const vert = (k: number): [number, number, number] => {
        const theta = k * p.d * DEG;
        const r = Math.sin(p.petals * theta);
        // rose in the X-Y plane (faces the default camera), gently rippled along z by the lift
        return [r * Math.cos(theta), r * Math.sin(theta), p.lift * Math.sin(p.petals * theta * 0.5)];
      };
      sweepTube(
        i, n, p.tube, out, o,
        (t) => {
          const f = (t / TAU) * SEG; // continuous index 0…360
          const k = Math.min(SEG - 1, Math.floor(f));
          const frac = f - k;
          const a = vert(k);
          const b = vert(k + 1);
          return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac, a[2] + (b[2] - a[2]) * frac];
        },
        (t) => {
          const f = (t / TAU) * SEG;
          const k = Math.min(SEG - 1, Math.floor(f));
          const a = vert(k);
          const b = vert(k + 1);
          let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
          if (Math.hypot(dx, dy, dz) < 1e-9) { dx = 1; dy = 0; dz = 0; } // guard zero-length chord
          return [dx, dy, dz];
        },
      );
    },
  },
  theodorus: {
    id: 'theodorus', label: 'Spiral of Theodorus', defaultParticleCount: 160_000, scale: 1.55, pointSize: 0.008,
    params: [
      { key: 'triangles', label: 'triangles N', min: 16, max: 160, step: 1, default: 72 },
      { key: 'symmetry', label: 'symmetry M', min: 1, max: 16, step: 1, default: 9 },
      { key: 'drift', label: 'drift', min: -0.5, max: 0.5, step: 0.005, default: -0.2 },
      { key: 'tube', label: 'thickness', min: 0.004, max: 0.04, step: 0.002, default: 0.012 },
      { key: 'lift', label: '3D lift', min: 0, max: 0.3, step: 0.01, default: 0.05 },
    ],
    // The √n spiral of Theodorus: a chain of right triangles each adding a unit outer leg, so vertex v
    // sits at radius √v and the cumulative turning angle is θ_v = Σ atan(1/√k). DRIFT-DEFORMED — a small
    // constant angular drift per step twists the arm — and replicated into M rotated copies, so the
    // single staircase becomes a rotationally-symmetric flower of nested zigzag petals. Each arm is its
    // own swept tube (no chord linking tip back to centre); radius is normalised by √N so the framing is
    // stable as N changes. Laid flat in the X-Y plane (faces the camera) with a tiny z-lift.
    position: (i, n, p, out, o) => {
      const M = Math.max(1, Math.round(p.symmetry));
      const N = Math.max(3, Math.round(p.triangles));
      const lift = p.lift;
      const invR = 1 / Math.sqrt(N); // normalise the outer radius to ≈1 regardless of N
      const th = theodorusAngles(N, p.drift);
      const perArm = Math.max(1, Math.floor(n / M));
      let arm = Math.floor(i / perArm);
      if (arm >= M) arm = M - 1; // remainder particles fold into the last arm
      const li = i - arm * perArm;
      const rot = arm * (TAU / M);
      const vert = (vv: number): [number, number, number] => {
        const v = vv < 0 ? 0 : vv > N - 1 ? N - 1 : vv;
        const r = Math.sqrt(v + 1) * invR; // normalised radius ∈ [1/√N, 1]
        const a = th[v] + rot;
        // Radial dome (rise toward the hub, flat at the rim) — pure-z, so x,y and the M-fold angular
        // symmetry are untouched: the rosette still reads face-on, orbiting reveals a shallow bowl.
        const domeH = lift * 3.0;
        const ripple = lift * Math.sin(v * 0.6) * (0.5 + 0.5 * r); // keep the triangle-staircase texture everywhere
        const z = domeH * (1 - r * r) + ripple - domeH * 0.5; // recentre on the origin
        return [r * Math.cos(a), r * Math.sin(a), z];
      };
      sweepTube(
        li, perArm, p.tube, out, o,
        (t) => {
          const f = (t / TAU) * (N - 1); // continuous vertex index 0…N-1 along this arm
          const k = Math.min(N - 2, Math.floor(f));
          const frac = f - k;
          const a = vert(k);
          const b = vert(k + 1);
          return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac, a[2] + (b[2] - a[2]) * frac];
        },
        (t) => {
          const f = (t / TAU) * (N - 1);
          const k = Math.min(N - 2, Math.floor(f));
          const a = vert(k);
          const b = vert(k + 1);
          let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
          if (Math.hypot(dx, dy, dz) < 1e-9) { dx = 1; dy = 0; dz = 0; } // guard zero-length leg
          return [dx, dy, dz];
        },
      );
    },
  },
  enneper: {
    id: 'enneper', label: 'Enneper Surface', defaultParticleCount: 160_000, scale: 0.37, pointSize: 0.008,
    params: [
      { key: 'extent', label: 'extent', min: 1, max: 2, step: 0.01, default: 1.6 },
      { key: 'fold', label: 'fold', min: 0, max: 2, step: 0.01, default: 1 },
    ],
    // Enneper minimal surface: a polynomial self-intersecting saddle with 3-fold symmetry.
    // x = u − u³/3 + u v² ; y = v − v³/3 + v u² ; z = u² − v². Pure polynomial ⇒ always finite.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = (a * 2 - 1) * p.extent; // [-extent, extent]
      const v = (b * 2 - 1) * p.extent;
      const u2 = u * u;
      const v2 = v * v;
      out[o] = u - (u2 * u) / 3 + p.fold * u * v2;
      out[o + 1] = v - (v2 * v) / 3 + p.fold * v * u2;
      out[o + 2] = u2 - v2;
    },
  },
  breather: {
    id: 'breather', label: 'Breather Surface', defaultParticleCount: 160_000, scale: 0.2, pointSize: 0.008,
    params: [
      { key: 'aa', label: 'aa (soliton)', min: 0.3, max: 0.7, step: 0.01, default: 0.4 },
      { key: 'extent', label: 'extent', min: 6, max: 12, step: 0.1, default: 12 },
    ],
    // Breather pseudospherical surface — a localized "breathing" soliton of constant negative
    // curvature, the geometric face of the sine-Gordon breather. aa∈(0,1) sets the soliton width.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const aa = p.aa;
      const w = Math.sqrt(Math.max(1e-6, 1 - aa * aa));
      const u = (a * 2 - 1) * p.extent; // [-extent, extent]
      const v = (b * 2 - 1) * p.extent; // [-extent, extent]
      const ch = Math.cosh(aa * u);
      const sh = Math.sinh(aa * u);
      const swv = Math.sin(w * v);
      const cwv = Math.cos(w * v);
      const sv = Math.sin(v);
      const cv = Math.cos(v);
      let denom = aa * ((w * ch) * (w * ch) + (aa * swv) * (aa * swv));
      if (denom < 1e-7) denom = 1e-7; // guard divide (denom ≥ aa·w² > 0 here, never triggers)
      out[o] = -u + (2 * (1 - aa * aa) * ch * sh) / denom;
      out[o + 1] = (2 * w * ch * (-w * cv * cwv - sv * swv)) / denom + 2.5; // centre (raw y ∈ [-5,0])
      out[o + 2] = (2 * w * ch * (-w * sv * cwv + cv * swv)) / denom;
    },
  },
  kuen: {
    id: 'kuen', label: 'Kuen Surface', defaultParticleCount: 160_000, scale: 0.8, pointSize: 0.008,
    params: [
      { key: 'reach', label: 'reach', min: 2, max: 6, step: 0.1, default: 4.5 },
      { key: 'funnel', label: 'funnel', min: 0.3, max: 1, step: 0.01, default: 0.6 },
    ],
    // Kuen's surface — constant negative (Gaussian) curvature K = -1. u sweeps the petals, v runs from
    // the flared lobes toward the log-tan cusp; both denom and ln(tan(v/2)) are guarded finite.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = (a * 2 - 1) * p.reach; // [-reach, reach]
      const v = p.funnel + b * (2.1 - p.funnel); // (funnel, 2.1) ⊂ (0, π) keeps ln(tan) finite
      const sv = Math.sin(v);
      const denom = 1 + u * u * sv * sv; // ≥ 1, never zero
      const t = Math.tan(v / 2);
      const lg = t > 1e-9 ? Math.log(t) : -20.7; // guard the v→0 cusp
      out[o] = (2 * (Math.cos(u) + u * Math.sin(u)) * sv) / denom - 0.64; // centre (raw x ∈ [-0.7,2])
      out[o + 1] = (2 * (Math.sin(u) - u * Math.cos(u)) * sv) / denom;
      out[o + 2] = lg + (2 * Math.cos(v)) / denom;
    },
  },
  catenoidHelicoid: {
    id: 'catenoidHelicoid', label: 'Catenoid ↔ Helicoid', defaultParticleCount: 160_000, scale: 0.4645, pointSize: 0.008,
    params: [
      { key: 'morph', label: 'morph', min: 0, max: Math.PI / 2, step: 0.01, default: 0.6 },
      { key: 'span', label: 'span', min: 0.8, max: 2, step: 0.01, default: 1.5 },
    ],
    // Associate (Bonnet) family bending a helicoid (morph=0) isometrically into a catenoid (morph=π/2).
    // All members are minimal surfaces. u∈[-π,π] is symmetric so z = u·cos t + v·sin t (odd in u and v)
    // is automatically centred on the origin — no offset baked in. cosh/sinh are entire ⇒ always finite.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = a * TAU - Math.PI; // [-π, π], symmetric ⇒ origin-centred
      const v = (b * 2 - 1) * p.span; // [-span, span]
      const t = p.morph;
      const ct = Math.cos(t), st = Math.sin(t);
      const shv = Math.sinh(v), chv = Math.cosh(v);
      const su = Math.sin(u), cu = Math.cos(u);
      out[o] = ct * shv * su + st * chv * cu;
      out[o + 1] = -ct * shv * cu + st * chv * su;
      out[o + 2] = u * ct + v * st; // odd in u and v ⇒ centred
    },
  },
  catalan: {
    id: 'catalan', label: "Catalan's Surface", defaultParticleCount: 160_000, scale: 0.23, pointSize: 0.008,
    params: [
      { key: 'arches', label: 'arches', min: 2, max: 4, step: 1, default: 4 },
      { key: 'extent', label: 'extent', min: 0.8, max: 1.6, step: 0.01, default: 1.3 },
    ],
    // Catalan's minimal surface — a soap-film saddle that contains a full cycloid as a geodesic (the
    // v=0 curve). u sweeps along the rolling-circle arches, v flares the surface out via cosh/sinh.
    // cosh/sinh are entire ⇒ every sample is finite. The raw shape runs along +x (centre x=uMax/2)
    // and sits at y=1; both offsets are baked out so it rests on the origin.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const arches = Math.max(2, Math.round(p.arches));
      const uMax = arches * Math.PI;
      const u = a * uMax; // [0, arches·π]
      const v = (b * 2 - 1) * p.extent; // [-extent, extent]
      const ch = Math.cosh(v);
      const sh2 = Math.sinh(v / 2);
      out[o] = u - Math.sin(u) * ch - uMax / 2; // along the cycloid, centred
      out[o + 1] = 1 - Math.cos(u) * ch - 1; // up axis, centred (raw y ∈ [0,2])
      out[o + 2] = 4 * Math.sin(u / 2) * sh2;
    },
  },
  henneberg: {
    id: 'henneberg', label: "Henneberg's Surface", defaultParticleCount: 160_000, scale: 0.31, pointSize: 0.008,
    params: [
      { key: 'reach', label: 'reach', min: 0.4, max: 0.9, step: 0.01, default: 0.8 },
      { key: 'flatten', label: 'flatten', min: 0, max: 1.5, step: 0.01, default: 1 },
    ],
    // Henneberg's minimal surface — a non-orientable soap film containing a Neil semicubical parabola.
    // x,y mix sinh(u),sinh(3u); z = 2 cosh(2u) cos(2v). sinh(3u) grows fast, so u is clamped to
    // [-reach, reach] with reach ≤ 0.9. All sinh/cosh ⇒ always finite; the symmetric u domain makes
    // the surface origin-centred (verified bbox centre = (0,0,0)), so no offset is baked in.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = (a * 2 - 1) * p.reach; // [-reach, reach], reach ≤ 0.9 bounds sinh(3u)
      const v = b * Math.PI; // [0, π]
      const su = Math.sinh(u);
      const s3u = Math.sinh(3 * u);
      const c2u = Math.cosh(2 * u);
      const k = p.flatten * (2 / 3); // weights the fast sinh(3u) cubic term
      out[o] = 2 * su * Math.cos(v) - k * s3u * Math.cos(3 * v);
      out[o + 1] = 2 * su * Math.sin(v) + k * s3u * Math.sin(3 * v);
      out[o + 2] = 2 * c2u * Math.cos(2 * v);
    },
  },
  scherk: {
    id: 'scherk', label: "Scherk's Surface", defaultParticleCount: 200_000, scale: 0.5, pointSize: 0.008,
    params: [
      { key: 'cells', label: 'cells', min: 1, max: 3, step: 1, default: 2 },
      { key: 'margin', label: 'tower clamp', min: 0.08, max: 0.4, step: 0.01, default: 0.2 },
    ],
    // Scherk's first (doubly-periodic) minimal surface: z = ln(cos x) − ln(cos y), the "saddle tower".
    // x,y are tiled over `cells` fundamental cells of width π; within each cell the cos argument is
    // folded to (−π/2, π/2) and clamped `margin` away from the ±π/2 asymptotes so the towers stay
    // bounded (ln|cos|→−∞ there). z is up; the domain is symmetric so the model sits on the origin.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const HALF = Math.PI / 2; // fundamental half-cell width (frequency a = 1)
      const span = p.cells * Math.PI; // total domain width = cells fundamental cells
      const x = (a - 0.5) * span; // raw planar X, centred on origin
      const y = (b - 0.5) * span; // raw planar Y, centred on origin
      const lim = HALF - p.margin; // clamp the cos argument away from the asymptotes
      const fold = (t: number): number => {
        let loc = t % Math.PI; // period π
        if (loc > HALF) loc -= Math.PI;
        if (loc < -HALF) loc += Math.PI;
        if (loc > lim) loc = lim;
        if (loc < -lim) loc = -lim;
        return loc;
      };
      const cx = Math.abs(Math.cos(fold(x)));
      const cy = Math.abs(Math.cos(fold(y)));
      out[o] = x;
      out[o + 1] = Math.log(cx < 1e-6 ? 1e-6 : cx) - Math.log(cy < 1e-6 ? 1e-6 : cy); // up
      out[o + 2] = y;
    },
  },
  astroidalEllipsoid: {
    id: 'astroidalEllipsoid', label: 'Astroidal Ellipsoid', defaultParticleCount: 160_000, scale: 1.6, pointSize: 0.008,
    params: [
      { key: 'sharp', label: 'cusp sharpness', min: 1, max: 5, step: 0.05, default: 3 },
      { key: 'stretch', label: 'z stretch', min: 0.4, max: 1.8, step: 0.01, default: 1 },
    ],
    // Astroidal ellipsoid (4-cusped star solid): the spherical product of two astroids. Raising each
    // signed factor to an odd-ish power 'sharp' (3 = the classic cube) preserves sign and pulls the
    // faces inward into eight pointed lobes. Pure powers of bounded sines/cosines ⇒ always finite;
    // the body is symmetric about the origin (bbox exactly [-1,1]), so no centring offset is needed.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = a * TAU; // [0, 2π]
      const v = (b - 0.5) * Math.PI; // [-π/2, π/2]
      const cu = Math.cos(u), su = Math.sin(u);
      const cv = Math.cos(v), sv = Math.sin(v);
      // signed power |s|^k·sign(s) keeps the cusps and preserves the sign of each base value
      const sp = (s: number): number => Math.sign(s) * Math.pow(Math.abs(s), p.sharp);
      out[o] = sp(cu * cv);
      out[o + 1] = sp(sv) * p.stretch;
      out[o + 2] = sp(su * cv);
    },
  },
  superToroid: {
    id: 'superToroid', label: 'Super Toroid', defaultParticleCount: 200_000, scale: 0.55, pointSize: 0.008,
    params: [
      { key: 'R', label: 'R (ring)', min: 1, max: 3, step: 0.01, default: 2 },
      { key: 'r', label: 'r (tube)', min: 0.2, max: 1.4, step: 0.01, default: 0.8 },
      { key: 'e1', label: 'e₁ (tube)', min: 0.2, max: 2, step: 0.01, default: 1 },
      { key: 'e2', label: 'e₂ (ring)', min: 0.2, max: 2, step: 0.01, default: 1 },
    ],
    // Super-toroid: a superellipse cross-section (squareness e1) swept around a superelliptical ring
    // (squareness e2). sgnpow(t,e)=sign(t)·|t|^e keeps pow-of-negative finite; e<1 squares the
    // profile, e>1 pinches it. Origin-centred for all params (bbox is symmetric: ±(R+r), ±r, ±(R+r)).
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = a * TAU - Math.PI; // [-π, π] around the ring
      const v = b * TAU - Math.PI; // [-π, π] around the tube
      const cu = sgnpow(Math.cos(u), p.e2);
      const su = sgnpow(Math.sin(u), p.e2);
      const cv = sgnpow(Math.cos(v), p.e1);
      const sv = sgnpow(Math.sin(v), p.e1);
      const w = p.R + p.r * cv;
      out[o] = w * cu;
      out[o + 1] = p.r * sv;
      out[o + 2] = w * su;
    },
  },
  toroidalSpiral: {
    id: 'toroidalSpiral', label: 'Toroidal Spiral', defaultParticleCount: 160_000, scale: 0.55, pointSize: 0.008,
    params: [
      { key: 'coils', label: 'coils p', min: 4, max: 40, step: 1, default: 18 },
      { key: 'tube', label: 'thickness', min: 0.04, max: 0.2, step: 0.005, default: 0.12 },
    ],
    // A helix wound p times around a torus ring (a slinky bent into a donut), swept into a solid tube.
    // Centreline rides a coil of radius r=0.6 around a ring of radius R=2; coprime is irrelevant here —
    // it always closes after one trip in t. Centred on the origin (bbox is symmetric, no offset needed).
    position: (i, n, p, out, o) => {
      const R = 2, r = 0.6;
      const pc = p.coils;
      sweepTube(i, n, p.tube, out, o, (t) => {
        const w = R + r * Math.cos(pc * t);
        return [w * Math.cos(t), r * Math.sin(pc * t), w * Math.sin(t)];
      }, (t) => {
        const ct = Math.cos(t), st = Math.sin(t);
        const cp = Math.cos(pc * t), sp = Math.sin(pc * t);
        const w = R + r * cp;
        const dw = -r * pc * sp;
        return [dw * ct - w * st, r * pc * cp, dw * st + w * ct];
      });
    },
  },
  sievert: {
    id: 'sievert', label: "Sievert's Surface", defaultParticleCount: 200_000, scale: 1.15, pointSize: 0.008,
    params: [
      { key: 'C', label: 'shape C', min: 0.6, max: 3, step: 0.01, default: 1 },
    ],
    // Sievert–Enneper surface of constant positive Gaussian curvature K = +1 — a twisted bulb.
    // u ∈ (-π/2, π/2) is taken via atan2 (no tan blow-up at ±π/2); v ∈ (0, π) is clamped away
    // from 0 so ln(tan(v/2)) stays finite. The denominator (C+1 − C·sin²v·cos²u) ≥ 1 never
    // vanishes. The raw surface sits at x ≈ √((C+1)/C); that offset is baked out so it is centred,
    // and the long log-tan ridge axis is mapped to the up axis.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const C = p.C;
      const uEps = 0.06;
      const u = -Math.PI / 2 + uEps + a * (Math.PI - 2 * uEps); // (-π/2, π/2)
      const v = 0.07 + b * (Math.PI - 0.14); // (0.07, π-0.07) keeps ln(tan(v/2)) finite
      const sC1 = Math.sqrt(C + 1);
      const sqC = Math.sqrt(C);
      const su = Math.sin(u), cu = Math.cos(u), sv = Math.sin(v), cv = Math.cos(v);
      const phi = -u / sC1 + Math.atan2(sC1 * su, cu); // continuous across u = ±π/2
      let denom = (C + 1) - C * sv * sv * cu * cu; // ≥ 1, never zero
      if (denom < 1e-6) denom = 1e-6;
      const A = 2 / denom;
      const r = (A / sqC) * sv * sC1 * Math.sqrt(1 + C * su * su);
      const th = Math.tan(v / 2);
      const lg = th > 1e-9 ? Math.log(th) : -20.7; // guard the v→0 cusp
      const offX = Math.sqrt((C + 1) / C); // bake out the off-origin shift (= maxX/2)
      out[o] = r * Math.cos(phi) - offX;
      out[o + 1] = lg / sqC + (A * (C + 1) * cv) / sqC; // up axis (the twisted ridge)
      out[o + 2] = r * Math.sin(phi);
    },
  },
  crossCap: {
    id: 'crossCap', label: 'Cross-Cap', defaultParticleCount: 200_000, scale: 1.6, pointSize: 0.008,
    params: [
      { key: 'width', label: 'width', min: 0.4, max: 1.6, step: 0.01, default: 1 },
      { key: 'height', label: 'height', min: 0.4, max: 1.8, step: 0.01, default: 1 },
    ],
    // Cross-cap — the simplest immersion of the real projective plane RP² (one segment of double points
    // joining two pinch points), completing the Boy/Roman trio. Standard parametrization over
    // u,v ∈ [0,π]: x = cos u·sin 2v, y = sin u·sin 2v, z = cos²v·sin²u (z ≥ 0 always). Pure
    // sines/cosines ⇒ every point finite (probe: 0 NaN, 0 Inf). Raw bbox x,y∈[-1,1], z∈[0,1]; the
    // double-point segment (z-axis) is mapped to the up axis and centred by −0.5.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = a * Math.PI; // [0, π]
      const v = b * Math.PI; // [0, π]
      const s2v = Math.sin(2 * v);
      const cv = Math.cos(v);
      const su = Math.sin(u);
      const cu = Math.cos(u);
      const z = cv * cv * su * su; // = cos²v − cos²u·cos²v, the pinch/double-point segment ∈ [0,1]
      out[o] = cu * s2v * p.width; // planar X
      out[o + 1] = z * p.height - 0.5 * p.height; // up axis (double-point segment), centred (raw z ∈ [0,1])
      out[o + 2] = su * s2v * p.width; // planar Z
    },
  },
  monkeySaddle: {
    id: 'monkeySaddle', label: 'Monkey Saddle', defaultParticleCount: 160_000, scale: 0.73, pointSize: 0.008,
    params: [
      { key: 'reach', label: 'reach R', min: 0.8, max: 1.8, step: 0.01, default: 1.3 },
      { key: 'legs', label: 'legs k', min: 2, max: 6, step: 1, default: 3 },
      { key: 'lift', label: 'height lift', min: 0.3, max: 1.6, step: 0.01, default: 1 },
    ],
    // Monkey saddle z = x³ − 3xy² = r³cos(3θ): a saddle with three descending valleys (two legs and a
    // tail) instead of two. Sampled in polar form over a disk — u is the radius fraction (×R), v the
    // angle — so the height field is exactly rⁿ·cos(kθ) (k=3 is the classic monkey saddle, k=2 the
    // ordinary saddle). Odd-symmetric ⇒ already origin-centred (probe centre ≈ (0,0,0)); no offset.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const rad = a * p.reach; // [0, R] radius
      const v = b * TAU; // [0, 2π] angle
      const k = Math.max(2, Math.round(p.legs));
      out[o] = rad * Math.cos(v);
      out[o + 1] = p.lift * Math.pow(rad, k) * Math.cos(k * v); // monkey-saddle height r^k cos(kθ), up axis
      out[o + 2] = rad * Math.sin(v);
    },
  },
  supershape3D: {
    id: 'supershape3D', label: 'Supershape 3D', defaultParticleCount: 200_000, scale: 1.15, pointSize: 0.008,
    params: [
      { key: 'm1', label: 'symmetry m₁ (lat)', min: 1, max: 14, step: 1, default: 7 },
      { key: 'm2', label: 'symmetry m₂ (lon)', min: 1, max: 14, step: 1, default: 7 },
      { key: 'n1', label: 'n₁', min: 0.1, max: 4, step: 0.01, default: 0.3 },
      { key: 'n2', label: 'n₂', min: 0.1, max: 4, step: 0.01, default: 1.7 },
      { key: 'n3', label: 'n₃', min: 0.1, max: 4, step: 0.01, default: 1.7 },
    ],
    // Full 3D Gielis supershape with INDEPENDENT symmetries for the two angles (unlike 'superformula',
    // which shares one m). r1 = superR(theta, m1, …) shapes the latitude, r2 = superR(phi, m2, …) the
    // longitude; their spherical product gives the solid. superR already clamps the radius (≤ 4) and
    // guards the pow-of-negative / divide cases, so every sample is finite (verified: 0 NaN/Inf over
    // 201×201 grids and 7 parameter cases). Default-param half-extent is 1.0 (identical to the
    // 'superformula' sibling), so scale matches it at 1.15. Extreme in-range params (two clamped
    // radii compounding) can reach half≈16, exactly as the sibling does — an accepted family trait.
    // Body is symmetric about the origin for typical params, so no centring offset is baked in.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const phi = a * TAU - Math.PI; // [-π, π] longitude
      const theta = b * Math.PI - Math.PI / 2; // [-π/2, π/2] latitude
      const r1 = superR(theta, p.m1, p.n1, p.n2, p.n3);
      const r2 = superR(phi, p.m2, p.n1, p.n2, p.n3);
      const ct = r1 * Math.cos(theta);
      out[o] = r2 * Math.cos(phi) * ct;
      out[o + 1] = r1 * Math.sin(theta);
      out[o + 2] = r2 * Math.sin(phi) * ct;
    },
  },
  bourSurface: {
    id: 'bourSurface', label: "Bour's Surface", defaultParticleCount: 160_000, scale: 0.55, pointSize: 0.008,
    params: [
      { key: 'extent', label: 'extent', min: 0.8, max: 2, step: 0.01, default: 1.6 },
      { key: 'flare', label: 'flare', min: 0.3, max: 1.6, step: 0.01, default: 1 },
    ],
    // Bour's minimal surface (order 2) — a polynomial-times-power-of-u minimal surface with three
    // self-intersecting lobes (3-fold symmetry in v). The u^1.5 power needs u ≥ 0, so u runs over
    // [0, extent]; Math.max(0,u) guards the fractional power. The raw shape drifts along +x by the
    // midpoint of its x-range; that offset (= extent/2 − 1/8, verified against the sampled bbox) is
    // baked back out so the model sits exactly on the origin (probe centre = (0,0,0) for all extent).
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const u = a * p.extent; // [0, extent], u ≥ 0 for u^1.5
      const v = b * TAU; // [0, 2π]
      const u15 = Math.pow(Math.max(0, u), 1.5); // guard pow-of-negative
      const u2h = (u * u) / 2;
      out[o] = u * Math.cos(v) - u2h * Math.cos(2 * v) + (p.extent / 2 - 0.125); // centred along x
      out[o + 1] = -u * Math.sin(v) - u2h * Math.sin(2 * v);
      out[o + 2] = (4 / 3) * u15 * Math.cos(1.5 * v) * p.flare; // flare scales the height lobes
    },
  },
  pluckerConoid: {
    id: 'pluckerConoid', label: "Plücker's Conoid", defaultParticleCount: 160_000, scale: 1.23, pointSize: 0.008,
    params: [
      { key: 'folds', label: 'folds n', min: 1, max: 6, step: 1, default: 2 },
      { key: 'amp', label: 'amplitude', min: 0.2, max: 1.2, step: 0.01, default: 0.6 },
    ],
    // Plücker's conoid (cylindroid): a ruled surface whose height oscillates with the azimuth. Each
    // horizontal ray of length R=1.3 sweeps around while riding the wave z = amp·sin(n·v), folding the
    // disk into n saddle "blades". Pure trig ⇒ always finite; the domain is symmetric so the bbox is
    // exactly ±1.3 (planar) × ±amp (height), already centred on the origin — no offset baked in.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const R = 1.3;
      const r = a * R; // [0, R] along each ruling
      const v = b * TAU; // [0, 2π] azimuth
      out[o] = r * Math.cos(v);
      out[o + 1] = p.amp * Math.sin(p.folds * v); // up axis (oscillating height)
      out[o + 2] = r * Math.sin(v);
    },
  },
  sphericalSpiral: {
    id: 'sphericalSpiral', label: 'Spherical Spiral', defaultParticleCount: 160_000, scale: 1.5, pointSize: 0.008,
    params: [
      { key: 'turns', label: 'turns c', min: 6, max: 24, step: 1, default: 16 },
      { key: 'tube', label: 'thickness', min: 0.01, max: 0.08, step: 0.005, default: 0.04 },
    ],
    // A loxodrome-like spiral winding pole to pole on the unit sphere, swept into a solid tube. The
    // sweepTube parameter t∈[0,2π] is remapped to latitude φ = t/2 − π/2 ∈ [−π/2, π/2]; the centreline
    // C(φ) = (cosφ·cos cφ, sinφ, cosφ·sin cφ) rides the sphere while winding c times in longitude. The
    // analytic tangent dC/dφ never vanishes (|dC| ≥ 1 from the sinφ→cosφ middle term), so the frame is
    // always well-conditioned. Lives on the unit sphere ⇒ already origin-centred (bbox ≈ ±1.04).
    position: (i, n, p, out, o) => {
      sweepTube(i, n, p.tube, out, o, (t) => {
        const phi = t / 2 - Math.PI / 2; // [-π/2, π/2]
        const cl = Math.cos(phi);
        return [cl * Math.cos(p.turns * phi), Math.sin(phi), cl * Math.sin(p.turns * phi)];
      }, (t) => {
        const phi = t / 2 - Math.PI / 2;
        const cl = Math.cos(phi), sl = Math.sin(phi);
        const ca = Math.cos(p.turns * phi), sa = Math.sin(p.turns * phi);
        // dC/dφ (constant ½ from dφ/dt dropped — sweepTube normalizes the tangent)
        return [
          -sl * ca - cl * p.turns * sa,
          cl,
          -sl * sa + cl * p.turns * ca,
        ];
      });
    },
  },
  sphericalLissajous: {
    id: 'sphericalLissajous', label: 'Spherical Lissajous', defaultParticleCount: 160_000, scale: 1.5, pointSize: 0.008,
    params: [
      { key: 'wind', label: 'wind a (latitude)', min: 1, max: 19, step: 1, default: 7 },
      { key: 'loop', label: 'loop b (longitude)', min: 1, max: 19, step: 1, default: 6 },
      { key: 'tube', label: 'thickness', min: 0.01, max: 0.08, step: 0.005, default: 0.035 },
    ],
    // A Lissajous figure woven over the unit sphere: latitude winds a times, longitude loops b times, so
    // one closed thread covers the sphere in a wireframe-orb lattice. C=(sin at·cos bt, cos at, sin at·sin bt)
    // ⇒ |C|=1 exactly and |dC|≥a (the −a·sin at term never lets the tangent vanish). Coprime a,b ⇒ a single
    // non-repeating loop with a-fold symmetry about the up axis. Distinct from the pole-to-pole sphericalSpiral.
    position: (i, n, p, out, o) => {
      const a = Math.max(1, Math.round(p.wind)); // latitude (θ) winding frequency
      const b = Math.max(1, Math.round(p.loop)); // longitude (φ) looping frequency
      sweepTube(i, n, p.tube, out, o, (t) => {
        const sa = Math.sin(a * t);
        return [sa * Math.cos(b * t), Math.cos(a * t), sa * Math.sin(b * t)]; // on the unit sphere, y up
      }, (t) => {
        const sa = Math.sin(a * t), ca = Math.cos(a * t);
        const cb = Math.cos(b * t), sb = Math.sin(b * t);
        return [
          a * ca * cb - b * sa * sb,
          -a * sa,
          a * ca * sb + b * sa * cb,
        ];
      });
    },
  },
  bohemianDome: {
    id: 'bohemianDome', label: 'Bohemian Dome', defaultParticleCount: 160_000, scale: 0.64, pointSize: 0.008,
    params: [
      { key: 'a', label: 'a (circle)', min: 0.5, max: 2, step: 0.01, default: 1 },
      { key: 'b', label: 'b (ellipse)', min: 0.5, max: 3, step: 0.01, default: 1.5 },
      { key: 'c', label: 'c (depth)', min: 0.5, max: 2, step: 0.01, default: 1 },
    ],
    // Bohemian dome — a circle of radius a swept so its centre traces an ellipse (semi-axes b, c) in a
    // perpendicular plane. x = a·cos u; y = b·cos v + a·sin u; z = c·sin v; u,v ∈ [0,2π]. Pure bounded
    // trig ⇒ every sample finite (no NaN/Inf). All three coords range symmetrically about 0, so the
    // surface is exactly origin-centred (verified bbox centre = (0,0,0)) — no offset baked in.
    position: (i, n, p, out, o) => {
      const [aa, bb] = uv(i, n);
      const u = aa * TAU; // [0, 2π] around the swept circle
      const v = bb * TAU; // [0, 2π] around the guiding ellipse
      out[o] = p.a * Math.cos(u);
      out[o + 1] = p.b * Math.cos(v) + p.a * Math.sin(u); // up axis, symmetric ⇒ centred
      out[o + 2] = p.c * Math.sin(v);
    },
  },
  decaySpiral: {
    id: 'decaySpiral', label: 'Decaying Spiral', defaultParticleCount: 160_000, scale: 1.25, pointSize: 0.008,
    params: [
      { key: 'turns', label: 'turns', min: 3, max: 20, step: 1, default: 9 },
      { key: 'decay', label: 'radius decay', min: 0.5, max: 4, step: 0.05, default: 2.2 },
      { key: 'climb', label: 'height', min: 0.5, max: 3, step: 0.05, default: 1.6 },
      { key: 'tube', label: 'thickness', min: 0.01, max: 0.08, step: 0.005, default: 0.03 },
    ],
    // A genuine 3D decaying spiral: a logarithmic funnel-coil. The point winds a fixed number of `turns`
    // around a vertical axis while its radius decays EXPONENTIALLY (ρ = R₀·e^(−decay·u)) and it climbs in
    // y — wide loose loops at the base tightening to a thread at the apex. Swept into a glowing tube.
    position: (i, n, p, out, o) => {
      const R0 = 1.15, turns = p.turns, decay = p.decay, climb = p.climb;
      const W = turns * TAU; // total winding angle
      sweepTube(i, n, p.tube, out, o, (t) => {
        const u = t / TAU; // ∈ [0,1] along the coil
        const rho = R0 * Math.exp(-decay * u);
        const phi = W * u;
        return [rho * Math.cos(phi), climb * (u - 0.5), rho * Math.sin(phi)];
      }, (t) => {
        const u = t / TAU;
        const rho = R0 * Math.exp(-decay * u);
        const phi = W * u;
        // dC/du (sweepTube normalises): ρ' = −decay·ρ, φ' = W, y' = climb
        return [
          -decay * rho * Math.cos(phi) - rho * W * Math.sin(phi),
          climb,
          -decay * rho * Math.sin(phi) + rho * W * Math.cos(phi),
        ];
      });
    },
  },
  conicalSpiral: {
    id: 'conicalSpiral', label: 'Conical Spiral', defaultParticleCount: 160_000, scale: 1.3, pointSize: 0.008,
    params: [
      { key: 'turns', label: 'turns', min: 1, max: 18, step: 1, default: 9 },
      { key: 'tube', label: 'thickness', min: 0.02, max: 0.12, step: 0.005, default: 0.06 },
    ],
    // A spiral climbing a cone (a unicorn horn / snail spike), swept into a solid tube. The centreline
    // winds `turns` times while its radius tapers linearly from R0=1 to a point and it rises over
    // height H=2.2. The (s-0.5)·H term centres the model on the up axis; analytic tangent dC supplied.
    // sweepTube drives the curve param over [0, 2π], so s = t/τ ∈ [0,1] and dC carries the 1/τ chain factor.
    position: (i, n, p, out, o) => {
      const R0 = 1, H = 2.2;
      const a = p.turns;
      sweepTube(i, n, p.tube, out, o, (t) => {
        const s = t / TAU;            // s ∈ [0,1] along the spiral
        const ang = a * TAU * s;
        const rad = (1 - s) * R0;     // taper to a point
        return [rad * Math.cos(ang), (s - 0.5) * H, rad * Math.sin(ang)]; // up axis centred
      }, (t) => {
        const s = t / TAU;
        const ang = a * TAU * s;
        const rad = (1 - s) * R0;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const dang = a * TAU;         // d(ang)/ds
        // dC/ds = (-R0·cos − rad·sin·dang, H, -R0·sin + rad·cos·dang); chain ×(1/τ) for d/dt
        return [
          (-R0 * ca - rad * sa * dang) / TAU,
          H / TAU,
          (-R0 * sa + rad * ca * dang) / TAU,
        ];
      });
    },
  },
  einsteinRosen: {
    id: 'einstein-rosen', label: 'Einstein–Rosen Bridge', defaultParticleCount: 200_000, scale: 0.5, pointSize: 0.008,
    params: [
      { key: 'mass', label: 'mass M', min: 0.2, max: 1.2, step: 0.01, default: 0.5 },
      { key: 'reach', label: 'reach', min: 1.5, max: 5, step: 0.05, default: 3 },
    ],
    // Flamm's paraboloid: the equatorial t=const slice of the Schwarzschild metric, isometrically
    // embedded in flat 3-space — the wormhole Einstein & Rosen (1935) found inside gravity. We
    // parametrize by the embedding height h (NOT the radius r), so the throat, where dz/dr→∞, is
    // sampled smoothly: r = 2M + h²/(8M). Both sheets (h ≷ 0) meet at the throat r = 2M.
    position: (i, n, p, out, o) => {
      const [a, b] = uv(i, n);
      const h = (a * 2 - 1) * p.reach; // embedding height, −reach…+reach spanning both sheets
      const r = 2 * p.mass + (h * h) / (8 * p.mass); // throat radius 2M; paraboloid flare
      const phi = b * TAU;
      out[o] = r * Math.cos(phi);
      out[o + 1] = h; // vertical embedding axis
      out[o + 2] = r * Math.sin(phi);
    },
  },
};

class ParametricArchetype implements Archetype {
  readonly kind = 'flow' as const;
  readonly id: string;
  readonly particleCount: number;

  private readonly sys: ParamSurface;
  private readonly scale: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly state = new Float64Array(1); // no dynamic state; deterministic from params
  private last = '';

  constructor(sys: ParamSurface, config: ArchetypeConfig) {
    this.sys = sys;
    this.id = sys.id;
    this.particleCount = config.particleCount;
    this.scale = sys.scale;
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    spectralGradient(this.particleCount, this.colors);
    this.rebuild(config.params);
  }

  private rebuild(p: ResolvedParams): void {
    const n = this.particleCount;
    const s = this.scale;
    const pos = this.positions;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      this.sys.position(i, n, p, pos, o);
      pos[o] *= s;
      pos[o + 1] *= s;
      pos[o + 2] *= s;
    }
    this.last = this.sys.params.map((ps) => p[ps.key]).join(',');
  }

  step(_dt: number, p: ResolvedParams): void {
    // recompute only when a shape parameter actually changed (live, no full rebuild)
    const key = this.sys.params.map((ps) => p[ps.key]).join(',');
    if (key !== this.last) this.rebuild(p);
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return this.state;
  }
  loadState(): void {
    /* deterministic from params — nothing to restore */
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: this.sys.label, stateOffset: 0, stateLength: 0 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: this.sys.pointSize };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export function makeParametricFactory(sys: ParamSurface): ArchetypeFactory {
  return {
    id: sys.id,
    label: sys.label,
    category: 'Parametric',
    kind: 'flow',
    params: sys.params,
    defaultParticleCount: sys.defaultParticleCount,
    particleCountOptions: [40_000, 120_000, 200_000, 360_000],
    defaultDt: 0.016,
    defaultTrail: 0, // static surfaces — trails are meaningless and 200k×160 tanks fps
    create: (config) => new ParametricArchetype(sys, config),
  };
}

import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  Derivative,
  GuideSpec,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { spectralGradient } from '../core/color';
import { rk4Step } from '../physics/integrators/rk4';
import { mulberry32, type Rng } from '../state/rng';

// A strange-attractor system: one ODE flow shared by an ensemble of particles that differ
// only in initial conditions. The 100k "particles" are a cloud of initial conditions
// collapsing onto the attractor manifold.
export interface AttractorSystem {
  id: string;
  label: string;
  dim: number; // 3 for classic attractors; 4 for the conservative Hamiltonian flows (Hénon–Heiles, double pendulum)
  dt: number; // per-system integration step (set on the global dt when this system is selected)
  defaults: Record<string, number>; // system params (σ, ρ, β …)
  paramSpec: ParamSpec[]; // UI controls for this system
  deriv: Derivative;
  seedPoint: number[]; // canonical on-attractor point (Lyapunov start + center reference)
  sampleInit(out: Float64Array, off: number, rng: Rng): void;
  scale: number; // world-space render scale
  center: [number, number, number]; // subtracted before scaling to recentre the manifold
  pointSize: number;
  // Optional projection from the (≥3-D) state to the 3 render coordinates, written into
  // out[po..po+2]; defaults to the first three state components. The 4-D Hamiltonian flows use it —
  // e.g. the double pendulum renders its bob in Cartesian space because the raw angles grow
  // without bound when an arm swings over the top.
  project?: (state: Float64Array, so: number, out: Float32Array, po: number) => void;
  // Optional static overlay geometry in render space (matches this system's scale/center).
  guides?: () => GuideSpec;
}

export const LORENZ: AttractorSystem = {
  id: 'lorenz',
  label: 'Lorenz',
  dim: 3,
  dt: 0.005,
  defaults: { sigma: 10, rho: 28, beta: 8 / 3 },
  paramSpec: [
    { key: 'sigma', label: 'σ', min: 0, max: 30, step: 0.1, default: 10 },
    { key: 'rho', label: 'ρ', min: 0, max: 60, step: 0.1, default: 28 },
    { key: 'beta', label: 'β', min: 0, max: 6, step: 0.01, default: 8 / 3 },
  ],
  deriv: (o, x, p) => {
    o[0] = p.sigma * (x[1] - x[0]);
    o[1] = x[0] * (p.rho - x[2]) - x[1];
    o[2] = x[0] * x[1] - p.beta * x[2];
  },
  seedPoint: [0, 1, 1.05],
  sampleInit: (out, off, rng) => {
    out[off] = (rng() * 2 - 1) * 18;
    out[off + 1] = (rng() * 2 - 1) * 24;
    out[off + 2] = rng() * 48;
  },
  scale: 0.06,
  center: [0, 0, 25],
  pointSize: 0.014,
};

export const ROSSLER: AttractorSystem = {
  id: 'rossler',
  label: 'Rössler',
  dim: 3,
  dt: 0.012,
  defaults: { a: 0.2, b: 0.2, c: 5.7 },
  paramSpec: [
    { key: 'a', min: 0, max: 0.5, step: 0.001, default: 0.2 },
    { key: 'b', min: 0, max: 2, step: 0.01, default: 0.2 },
    { key: 'c', min: 1, max: 18, step: 0.1, default: 5.7 },
  ],
  deriv: (o, x, p) => {
    o[0] = -(x[1] + x[2]);
    o[1] = x[0] + p.a * x[1];
    o[2] = p.b + x[2] * (x[0] - p.c);
  },
  seedPoint: [0.1, 0, 0],
  sampleInit: (out, off, rng) => {
    out[off] = (rng() * 2 - 1) * 12;
    out[off + 1] = (rng() * 2 - 1) * 12;
    out[off + 2] = rng() * 24;
  },
  scale: 0.1,
  center: [0, 0, 6],
  pointSize: 0.014,
};

export const AIZAWA: AttractorSystem = {
  id: 'aizawa',
  label: 'Aizawa',
  dim: 3,
  dt: 0.008,
  defaults: { a: 0.95, b: 0.7, c: 0.6, d: 3.5, e: 0.25, f: 0.1 },
  paramSpec: [
    { key: 'a', min: 0, max: 2, step: 0.01, default: 0.95 },
    { key: 'b', min: 0, max: 2, step: 0.01, default: 0.7 },
    { key: 'c', min: 0, max: 2, step: 0.01, default: 0.6 },
    { key: 'd', min: 0, max: 6, step: 0.01, default: 3.5 },
    { key: 'e', min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: 'f', min: 0, max: 1, step: 0.01, default: 0.1 },
  ],
  deriv: (o, x, p) => {
    const xx = x[0];
    const yy = x[1];
    const zz = x[2];
    o[0] = (zz - p.b) * xx - p.d * yy;
    o[1] = p.d * xx + (zz - p.b) * yy;
    o[2] = p.c + p.a * zz - (zz * zz * zz) / 3 - (xx * xx + yy * yy) * (1 + p.e * zz) + p.f * zz * xx * xx * xx;
  },
  seedPoint: [0.1, 0, 0],
  sampleInit: (out, off, rng) => {
    out[off] = (rng() * 2 - 1) * 1.2;
    out[off + 1] = (rng() * 2 - 1) * 1.2;
    out[off + 2] = (rng() * 2 - 1) * 1.4;
  },
  scale: 1.3,
  center: [0, 0, 0.4],
  pointSize: 0.012,
};

export const THOMAS: AttractorSystem = {
  id: 'thomas',
  label: 'Thomas',
  dim: 3,
  dt: 0.03,
  defaults: { b: 0.19 },
  paramSpec: [{ key: 'b', min: 0.05, max: 0.4, step: 0.005, default: 0.19 }],
  deriv: (o, x, p) => {
    o[0] = Math.sin(x[1]) - p.b * x[0];
    o[1] = Math.sin(x[2]) - p.b * x[1];
    o[2] = Math.sin(x[0]) - p.b * x[2];
  },
  seedPoint: [0.1, 0, 0],
  sampleInit: (out, off, rng) => {
    out[off] = (rng() * 2 - 1) * 6;
    out[off + 1] = (rng() * 2 - 1) * 6;
    out[off + 2] = (rng() * 2 - 1) * 6;
  },
  scale: 0.32,
  center: [0, 0, 0],
  pointSize: 0.016,
};

// Auto-build a slider spec spanning ±max(|v|,1) around each default — good enough for exploration.
function autoParams(defaults: Record<string, number>): ParamSpec[] {
  return Object.entries(defaults).map(([key, v]) => {
    const span = Math.max(Math.abs(v), 1);
    return { key, label: key, min: +(v - span).toFixed(4), max: +(v + span).toFixed(4), step: +(span / 100).toFixed(4), default: v };
  });
}

const mid = (r: [number, number]): number => (r[0] + r[1]) / 2;

interface FlowSpec {
  id: string;
  label: string;
  defaults: Record<string, number>;
  deriv: Derivative;
  init: number[];
  dt: number;
  bounds: { x: [number, number]; y: [number, number]; z: [number, number] };
  pointSize?: number;
  spread?: number;
}

// Concise builder: derives render scale/center from the attractor's bounds and seeds a tight
// cloud near a known on-attractor point.
function makeFlow(o: FlowSpec): AttractorSystem {
  const range = Math.max(o.bounds.x[1] - o.bounds.x[0], o.bounds.y[1] - o.bounds.y[0], o.bounds.z[1] - o.bounds.z[0]);
  const scale = 3 / range;
  const spread = o.spread ?? 0.6;
  return {
    id: o.id,
    label: o.label,
    dim: 3,
    dt: o.dt,
    defaults: o.defaults,
    paramSpec: autoParams(o.defaults),
    deriv: o.deriv,
    seedPoint: o.init,
    sampleInit: (out, off, rng) => {
      for (let k = 0; k < 3; k++) out[off + k] = o.init[k] + (rng() - 0.5) * spread;
    },
    scale,
    center: [mid(o.bounds.x), mid(o.bounds.y), mid(o.bounds.z)],
    pointSize: o.pointSize ?? 0.012,
  };
}

// 10 more attractor flows (equations + canonical params verified against the literature).
const NEW_FLOWS: AttractorSystem[] = [
  makeFlow({ id: 'halvorsen', label: 'Halvorsen', defaults: { a: 1.4 }, dt: 0.005, init: [-1.48, -1.51, 2.04], bounds: { x: [-9, 5], y: [-9, 5], z: [-9, 5] },
    deriv: (o, x, p) => { o[0] = -p.a * x[0] - 4 * x[1] - 4 * x[2] - x[1] * x[1]; o[1] = -p.a * x[1] - 4 * x[2] - 4 * x[0] - x[2] * x[2]; o[2] = -p.a * x[2] - 4 * x[0] - 4 * x[1] - x[0] * x[0]; } }),
  makeFlow({ id: 'chen', label: 'Chen', defaults: { a: 35, b: 3, c: 28 }, dt: 0.002, init: [-0.1, 0.5, -0.6], bounds: { x: [-30, 30], y: [-35, 35], z: [0, 60] },
    deriv: (o, x, p) => { o[0] = p.a * (x[1] - x[0]); o[1] = (p.c - p.a) * x[0] - x[0] * x[2] + p.c * x[1]; o[2] = x[0] * x[1] - p.b * x[2]; } }),
  makeFlow({ id: 'dadras', label: 'Dadras', defaults: { p: 3, o: 2.7, r: 1.7, c: 2, e: 9 }, dt: 0.008, init: [1.1, 2.1, -2], bounds: { x: [-25, 25], y: [-12, 12], z: [-15, 15] },
    deriv: (out, x, P) => { out[0] = x[1] - P.p * x[0] + P.o * x[1] * x[2]; out[1] = P.r * x[1] - x[0] * x[2] + x[2]; out[2] = P.c * x[0] * x[1] - P.e * x[2]; } }),
  makeFlow({ id: 'lorenz84', label: 'Lorenz-84', defaults: { a: 0.25, b: 4, F: 8, G: 1 }, dt: 0.01, init: [1, 1, 1], bounds: { x: [-1.5, 3], y: [-3, 3], z: [-3, 3] },
    deriv: (o, x, p) => { o[0] = -x[1] * x[1] - x[2] * x[2] - p.a * x[0] + p.a * p.F; o[1] = x[0] * x[1] - p.b * x[0] * x[2] - x[1] + p.G; o[2] = p.b * x[0] * x[1] + x[0] * x[2] - x[2]; } }),
  makeFlow({ id: 'rabinovich-fabrikant', label: 'Rabinovich–Fabrikant', defaults: { a: 1.1, g: 0.87 }, dt: 0.004, init: [-1, 0, 0.5], spread: 0.15, bounds: { x: [-2.5, 2.5], y: [-2.5, 2.5], z: [0, 1.5] },
    deriv: (o, x, p) => { o[0] = x[1] * (x[2] - 1 + x[0] * x[0]) + p.g * x[0]; o[1] = x[0] * (3 * x[2] + 1 - x[0] * x[0]) + p.g * x[1]; o[2] = -2 * x[2] * (p.a + x[0] * x[1]); } }),
  makeFlow({ id: 'sprott-linz-f', label: 'Sprott-Linz F', defaults: { a: 0.5 }, dt: 0.01, init: [0.1, 0, 0], bounds: { x: [-2.5, 3], y: [-3, 3], z: [0, 6] },
    deriv: (o, x, p) => { o[0] = x[1] + x[2]; o[1] = -x[0] + p.a * x[1]; o[2] = x[0] * x[0] - x[2]; } }),
  makeFlow({ id: 'wang-four-wing', label: 'Wang Four-Wing', defaults: { a: 0.2, b: -0.01, c: -0.4, d: -1 }, dt: 0.01, init: [1, 1, 1], bounds: { x: [-15, 15], y: [-15, 15], z: [-8, 30] },
    deriv: (o, x, p) => { o[0] = p.a * x[0] + x[1] * x[2]; o[1] = p.b * x[0] + p.c * x[1] - x[0] * x[2]; o[2] = -x[2] + p.d * x[0] * x[1]; } }),
  makeFlow({ id: 'bouali', label: 'Bouali', defaults: { a: 3, b: 2.2, c: 1, d: 0.001 }, dt: 0.01, init: [1, 0.1, 0.1], bounds: { x: [-3.5, 3.5], y: [-1, 2], z: [-3, 3] },
    deriv: (o, x, p) => { o[0] = p.a * x[0] * (1 - x[1]) - p.b * x[2]; o[1] = -p.c * x[1] * (1 - x[0] * x[0]); o[2] = p.d * x[0]; } }),
  makeFlow({ id: 'nose-hoover', label: 'Nosé–Hoover', defaults: { a: 1 }, dt: 0.01, init: [0, 5, 0], bounds: { x: [-4, 4], y: [-4, 4], z: [-4, 4] },
    deriv: (o, x, p) => { o[0] = x[1]; o[1] = -x[0] + x[1] * x[2]; o[2] = p.a - x[1] * x[1]; } }),
  makeFlow({ id: 'chua', label: 'Chua (cubic)', defaults: { alpha: 10, beta: 14.2857, c0: -1 / 6, c1: 1 / 16 }, dt: 0.01, init: [0.3, 0, 0], bounds: { x: [-3, 3], y: [-0.6, 0.6], z: [-4, 4] },
    deriv: (o, x, p) => { o[0] = p.alpha * (x[1] - x[0] - (p.c1 * x[0] * x[0] * x[0] + p.c0 * x[0])); o[1] = x[0] - x[1] + x[2]; o[2] = -p.beta * x[1]; } }),
  makeFlow({ id: 'lu', label: 'Lü', defaults: { a: 36, b: 3, c: 20 }, dt: 0.004, init: [-5.23, -5.47, 17.84], spread: 0.5, pointSize: 0.012, bounds: { x: [-23, 23], y: [-25, 25], z: [4, 40] },
    deriv: (o, x, p) => { o[0] = p.a * (x[1] - x[0]); o[1] = p.c * x[1] - x[0] * x[2]; o[2] = x[0] * x[1] - p.b * x[2]; } }),
  makeFlow({ id: 'chen-lee', label: 'Chen-Lee', defaults: { a: 5, b: -10, c: -0.38 }, dt: 0.004, init: [1, 1, 1], spread: 0.5, pointSize: 0.012, bounds: { x: [-15, 15], y: [-12.5, 12.5], z: [4, 14.5] },
    deriv: (o, x, p) => { o[0] = p.a * x[0] - x[1] * x[2]; o[1] = p.b * x[1] + x[0] * x[2]; o[2] = p.c * x[2] + (x[0] * x[1]) / 3; } }),
  makeFlow({ id: 'newton-leipnik', label: 'Newton–Leipnik', defaults: { a: 0.4, b: 0.175 }, dt: 0.01, init: [0.349, 0, -0.16], spread: 0.5, pointSize: 0.012, bounds: { x: [-0.85, 0.85], y: [-0.35, 0.35], z: [-0.12, 0.52] },
    deriv: (o, x, p) => { o[0] = -p.a * x[0] + x[1] + 10 * x[1] * x[2]; o[1] = -x[0] - 0.4 * x[1] + 5 * x[0] * x[2]; o[2] = p.b * x[2] - 5 * x[0] * x[1]; } }),
  makeFlow({ id: 'burke-shaw', label: 'Burke-Shaw', defaults: { s: 10, v: 4.272 }, dt: 0.005, init: [1, 0, 0], spread: 0.5, bounds: { x: [-1.75, 1.75], y: [-2.3, 2.3], z: [-1.95, 1.95] },
    deriv: (o, x, p) => { o[0] = -p.s * (x[0] + x[1]); o[1] = -x[1] - p.s * x[0] * x[2]; o[2] = p.s * x[0] * x[1] + p.v; } }),
  makeFlow({ id: 'rikitake', label: 'Rikitake Dynamo', defaults: { mu: 0.5, a: 5 }, dt: 0.01, init: [1, 0, 0], spread: 0.5, pointSize: 0.012, bounds: { x: [-6, 6], y: [-2.2, 2.2], z: [3.1, 7] },
    deriv: (o, x, p) => { o[0] = -p.mu * x[0] + x[2] * x[1]; o[1] = -p.mu * x[1] + (x[2] - p.a) * x[0]; o[2] = 1 - x[0] * x[1]; } }),
  makeFlow({ id: 'shimizu-morioka', label: 'Shimizu–Morioka', defaults: { a: 0.75, b: 0.45 }, dt: 0.01, init: [1.0228588902751727, -0.35319951514739695, 1.762580127299876], spread: 0.5, pointSize: 0.012, bounds: { x: [-1.45, 1.45], y: [-1.0, 1.0], z: [0, 2.3] },
    deriv: (o, x, p) => { o[0] = x[1]; o[1] = x[0] * (1 - x[2]) - p.a * x[1]; o[2] = -p.b * x[2] + x[0] * x[0]; } }),
  makeFlow({ id: 'rucklidge', label: 'Rucklidge', defaults: { k: 2, a: 6.7 }, dt: 0.01, init: [1, 0, 4.5], spread: 0.5, pointSize: 0.012, bounds: { x: [-10.5, 10.5], y: [-6, 6], z: [0, 15.5] },
    deriv: (o, x, p) => { o[0] = -p.k * x[0] + p.a * x[1] - x[1] * x[2]; o[1] = x[0]; o[2] = -x[2] + x[1] * x[1]; } }),
  makeFlow({ id: 'genesio-tesi', label: 'Genesio–Tesi', defaults: { a: 0.44, b: 1.1, c: 1.0 }, dt: 0.01, init: [0.2, 0, 0], spread: 0.3, pointSize: 0.012, bounds: { x: [-0.4916, 1.1918], y: [-0.6184, 0.9167], z: [-0.7572, 0.9078] },
    deriv: (o, x, p) => { o[0] = x[1]; o[1] = x[2]; o[2] = -p.c * x[0] - p.b * x[1] - p.a * x[2] + x[0] * x[0]; } }),
  makeFlow({ id: 'arneodo', label: 'Arneodo', defaults: { a: 5.5, b: 3.5 }, dt: 0.01, init: [2.564, -3.389, -6.501], spread: 0.5, pointSize: 0.012, bounds: { x: [-3.6, 3.6], y: [-6.1, 6.1], z: [-11.5, 11.5] },
    deriv: (o, x, p) => { o[0] = x[1]; o[1] = x[2]; o[2] = p.a * x[0] - p.b * x[1] - x[2] - x[0] * x[0] * x[0]; } }),
  makeFlow({ id: 'finance', label: 'Finance', defaults: { a: 0.001, b: 0.2, c: 1.1 }, dt: 0.02, init: [1.1232, 0.973, -0.5738], spread: 0.5, pointSize: 0.012, bounds: { x: [-3.1, 3.1], y: [-1.9, 3.1], z: [-1.55, 1.55] },
    deriv: (o, x, p) => { o[0] = x[2] + (x[1] - p.a) * x[0]; o[1] = 1 - p.b * x[1] - x[0] * x[0]; o[2] = -x[0] - p.c * x[2]; } }),
  makeFlow({ id: 'sprott-b', label: 'Sprott B', defaults: { s: 1 }, dt: 0.01, init: [0.5, 0.1, 0], spread: 0.5, pointSize: 0.012, bounds: { x: [-7.5, 7], y: [-4, 4], z: [-7.5, 7] },
    deriv: (o, x, p) => { o[0] = p.s * (x[1] * x[2]); o[1] = p.s * (x[0] - x[1]); o[2] = p.s * (1 - x[0] * x[1]); } }),
  makeFlow({ id: 'hindmarsh-rose', label: 'Hindmarsh–Rose', defaults: { a: 1, b: 3, c: 1, d: 5, s: 4, xr: -1.6, r: 0.006, I: 3.2 }, dt: 0.05, init: [-1.1, -5.1, 3.1], spread: 0.5, pointSize: 0.012, bounds: { x: [-1.4, 1.9], y: [-7.2, 0.8], z: [2.8, 3.4] },
    deriv: (o, x, p) => { o[0] = x[1] - p.a * x[0] * x[0] * x[0] + p.b * x[0] * x[0] - x[2] + p.I; o[1] = p.c - p.d * x[0] * x[0] - x[1]; o[2] = p.r * (p.s * (x[0] - p.xr) - x[2]); } }),
  makeFlow({ id: 'sakarya', label: 'Sakarya', defaults: { a: 0.4, b: 0.3 }, dt: 0.01, init: [3.22, 1.54, 4.31], spread: 0.5, pointSize: 0.012, bounds: { x: [-34, 36], y: [-19, 19], z: [-14, 18] },
    deriv: (o, x, p) => { o[0] = -x[0] + x[1] + x[1] * x[2]; o[1] = -x[0] - x[1] + p.a * x[0] * x[2]; o[2] = x[2] - p.b * x[0] * x[1]; } }),
];

// --- Conservative (Hamiltonian) chaos: 4-D phase-space flows that conserve energy and preserve
// phase-space volume, rather than dissipating onto a thin strange-attractor manifold. The
// archetype already integrates `dim` components generically (rk4 MAX_DIM=8); these add a 4th
// component and, for the pendulum, a Cartesian render projection.

// Hénon–Heiles: a star orbiting in a galactic potential. H = ½(px²+py²) + ½(x²+y²) + λ(x²y − ⅓y³).
// Below the escape energy E=1/6 (λ=1) the motion is bounded and mixes regular KAM tori with a
// chaotic sea — "the shape chaos takes before it looks random." Renders (x, y, px).
export const HENON_HEILES: AttractorSystem = {
  id: 'henon-heiles',
  label: 'Hénon–Heiles',
  dim: 4, // [x, y, px, py]
  dt: 0.02,
  defaults: { lambda: 1 },
  paramSpec: [{ key: 'lambda', label: 'λ', min: 0, max: 1.2, step: 0.01, default: 1 }],
  // ẋ=px, ẏ=py, ṗx=−x−2λxy, ṗy=−y−λ(x²−y²)
  deriv: (o, x, p) => {
    o[0] = x[2];
    o[1] = x[3];
    o[2] = -x[0] - 2 * p.lambda * x[0] * x[1];
    o[3] = -x[1] - p.lambda * (x[0] * x[0] - x[1] * x[1]);
  },
  seedPoint: [0, 0, 0, 0],
  // Seed each particle's conserved energy safely below the escape threshold E=1/6≈0.167 (λ=1);
  // above it the equipotential opens three saddle channels and trajectories run to infinity.
  // Verified energy band ≈ [0.002, 0.123], zero escapes over the 800-step smoke test.
  sampleInit: (out, off, rng) => {
    out[off] = (rng() - 0.5) * 0.55; // x
    out[off + 1] = (rng() - 0.5) * 0.55; // y
    out[off + 2] = (rng() - 0.5) * 0.45; // px
    out[off + 3] = (rng() - 0.5) * 0.45; // py
  },
  scale: 3.0, // FIXED, not bounds-derived: an escaping particle must never be allowed to rescale the cloud
  center: [0, 0, 0],
  pointSize: 0.012,
  // The iconic escape equipotential (λ=1): a triangle with vertices (0,1), (±√3/2,−1/2), drawn in
  // the px=0 plane and scaled to match the cloud. Below it the motion is bound; cross it and a
  // trajectory escapes to infinity.
  guides: () => {
    const s = 3.0;
    const r3 = Math.sqrt(3) / 2;
    return [
      {
        points: [
          [0, s, 0],
          [r3 * s, -0.5 * s, 0],
          [-r3 * s, -0.5 * s, 0],
        ],
        color: 0xff7a30,
        closed: true,
      },
    ];
  },
};

// Double pendulum: the iconic chaos demo. A conservative 4-D Hamiltonian (θ1,θ2,ω1,ω2) with equal
// masses & lengths (m=l=1). A tight cloud of almost-identical initial angles diverges to fill the
// energy shell — sensitive dependence on initial conditions made visible.
export const DOUBLE_PENDULUM: AttractorSystem = {
  id: 'double-pendulum',
  label: 'Double Pendulum',
  dim: 4, // [θ1, θ2, ω1, ω2]
  dt: 0.02,
  defaults: { g: 1 },
  paramSpec: [{ key: 'g', label: 'gravity', min: 0.2, max: 3, step: 0.01, default: 1 }],
  // Coupled Euler–Lagrange equations of motion (m₁=m₂=l₁=l₂=1):
  deriv: (o, x, p) => {
    const t1 = x[0], t2 = x[1], w1 = x[2], w2 = x[3];
    const d = t1 - t2;
    const cd = Math.cos(d), sd = Math.sin(d);
    const den = 3 - Math.cos(2 * d);
    o[0] = w1;
    o[1] = w2;
    o[2] = (-3 * p.g * Math.sin(t1) - p.g * Math.sin(t1 - 2 * t2) - 2 * sd * (w2 * w2 + w1 * w1 * cd)) / den;
    o[3] = (2 * sd * (2 * w1 * w1 + 2 * p.g * Math.cos(t1) + w2 * w2 * cd)) / den;
  },
  seedPoint: [2.5, 2.5, 0, 0],
  // A tight ε-cloud around a chaotic regime (≈2.5 rad) — the "812 near-identical pendulums" demo.
  sampleInit: (out, off, rng) => {
    out[off] = 2.5 + (rng() - 0.5) * 0.1; // θ1
    out[off + 1] = 2.5 + (rng() - 0.5) * 0.1; // θ2
    out[off + 2] = (rng() - 0.5) * 0.05; // ω1
    out[off + 3] = (rng() - 0.5) * 0.05; // ω2
  },
  // Render the lower bob's Cartesian position (x₂,y₂) with the upper link's x as depth — bounded by
  // construction, unlike the raw angles which grow without bound when an arm goes over the top.
  project: (s, so, out, po) => {
    const t1 = s[so], t2 = s[so + 1];
    const x1 = Math.sin(t1);
    out[po] = x1 + Math.sin(t2); // x₂
    out[po + 1] = -Math.cos(t1) - Math.cos(t2); // y₂
    out[po + 2] = x1; // depth: upper-link x
  },
  scale: 0.8,
  center: [-0.05, 0.26, 0.11], // recentre the verified render-space mean of the chaotic cloud
  pointSize: 0.012,
  // The lower bob can never get farther than l₁+l₂ = 2 from the pivot — draw that reach boundary as
  // a circle (radius 2 in bob space), scaled/centred to match the cloud.
  guides: () => {
    const s = 0.8;
    const cx = -0.05, cy = 0.26, cz = 0.11;
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i < 72; i++) {
      const t = (i / 72) * Math.PI * 2;
      pts.push([(2 * Math.cos(t) - cx) * s, (2 * Math.sin(t) - cy) * s, (0 - cz) * s]);
    }
    return [{ points: pts, color: 0x16e0c8, closed: true }];
  },
};

// Forced Duffing oscillator: ẍ + δẋ − x + x³ = γ·cos(ωt) — the classic double-well chaotic flow
// (distinct from our discrete `duffing-map`). Made autonomous with a drive-phase state φ=ωt; the
// phase grows without bound so we render (x, v, φ wrapped to [−π,π)) — folding it onto a cylinder.
export const DUFFING: AttractorSystem = {
  id: 'duffing',
  label: 'Duffing (forced)',
  dim: 3, // [x, v, φ]
  dt: 0.02,
  defaults: { delta: 0.15, gamma: 0.3, omega: 1.0 },
  // Explicit spec, NOT autoParams: δ and γ must not go negative (negative damping → energy injection
  // → blow-up). Verified chaotic at the defaults (largest Lyapunov ≈ +0.19).
  paramSpec: [
    { key: 'delta', label: 'δ', min: 0, max: 1, step: 0.005, default: 0.15 },
    { key: 'gamma', label: 'γ', min: 0, max: 1, step: 0.005, default: 0.3 },
    { key: 'omega', label: 'ω', min: 0.2, max: 3, step: 0.01, default: 1.0 },
  ],
  deriv: (o, x, p) => {
    const xx = x[0];
    o[0] = x[1];
    o[1] = -p.delta * x[1] + xx - xx * xx * xx + p.gamma * Math.cos(x[2]);
    o[2] = p.omega;
  },
  seedPoint: [0.5, 0.5, 0],
  sampleInit: (out, off, rng) => {
    out[off] = (rng() * 2 - 1) * 1.0; // x
    out[off + 1] = (rng() * 2 - 1) * 0.6; // v
    out[off + 2] = rng() * Math.PI * 2; // φ over a full drive cycle → the sheet has z-thickness at once
  },
  project: (s, so, out, po) => {
    const tau = Math.PI * 2;
    out[po] = s[so]; // x
    out[po + 1] = s[so + 1]; // v
    out[po + 2] = (((s[so + 2] % tau) + tau) % tau) - Math.PI; // φ wrapped to [−π, π)
  },
  scale: 1.0, // FIXED — never bounds-derived; keeps the φ-cylinder (±π·scale) inside the frame
  center: [0, 0, 0],
  pointSize: 0.012,
};

// Magnetic pendulum: a bob in a plane over 3 magnets at an equilateral triangle, with a central
// gravity-like restoring force, friction, and softened attraction to each magnet. Bobs route into one
// of the three magnets — the famous fractal basin of attraction.
const MAGPEND_R = 1.0;
const MAGPEND_MAGNETS: Array<[number, number]> = [
  [0, MAGPEND_R],
  [MAGPEND_R * Math.cos(-Math.PI / 6), MAGPEND_R * Math.sin(-Math.PI / 6)],
  [MAGPEND_R * Math.cos((7 * Math.PI) / 6), MAGPEND_R * Math.sin((7 * Math.PI) / 6)],
];
export const MAGNETIC_PENDULUM: AttractorSystem = {
  id: 'magnetic-pendulum',
  label: 'Magnetic Pendulum',
  dim: 4, // [x, y, vx, vy]
  dt: 0.04,
  defaults: { k: 0.4, c: 0.35, h: 0.25, strength: 1.0 },
  paramSpec: [
    { key: 'k', label: 'gravity', min: 0.05, max: 1.0, step: 0.01, default: 0.4 },
    { key: 'c', label: 'friction', min: 0.0, max: 0.8, step: 0.01, default: 0.35 },
    // min 0.12 (not lower): below it the well is too sharp for RK4 and the c=0 corner can blow up.
    { key: 'h', label: 'softening', min: 0.12, max: 0.6, step: 0.01, default: 0.25 },
    { key: 'strength', label: 'magnets', min: 0.2, max: 2.0, step: 0.01, default: 1.0 },
  ],
  deriv: (o, x, p) => {
    const px = x[0], py = x[1], vx = x[2], vy = x[3];
    let ax = -p.k * px - p.c * vx;
    let ay = -p.k * py - p.c * vy;
    const h2 = p.h * p.h;
    for (let m = 0; m < 3; m++) {
      const dx = MAGPEND_MAGNETS[m][0] - px;
      const dy = MAGPEND_MAGNETS[m][1] - py;
      const r2 = dx * dx + dy * dy + h2; // softened — no singularity at a magnet
      const inv = p.strength / (r2 * Math.sqrt(r2)); // = strength / r2^1.5, cheaper than Math.pow
      ax += dx * inv;
      ay += dy * inv;
    }
    o[0] = vx;
    o[1] = vy;
    o[2] = ax;
    o[3] = ay;
  },
  seedPoint: [0, MAGPEND_R, 0, 0],
  sampleInit: (out, off, rng) => {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 2.6; // area-uniform disc, wider than the R=1 magnet ring
    out[off] = Math.cos(a) * r;
    out[off + 1] = Math.sin(a) * r;
    out[off + 2] = 0; // released from rest
    out[off + 3] = 0;
  },
  // Render the bob plane (x, y) with speed as depth — moving bobs lift, settled bobs drop to z≈0.
  project: (s, so, out, po) => {
    out[po] = s[so];
    out[po + 1] = s[so + 1];
    const vx = s[so + 2], vy = s[so + 3];
    out[po + 2] = Math.sqrt(vx * vx + vy * vy);
  },
  scale: 0.9, // FIXED
  center: [0, 0, 0],
  pointSize: 0.012,
  // mark the 3 magnet sites as small rings in the z=0 plane (where settled bobs rest)
  guides: () => {
    const sc = 0.9; // must match scale
    return MAGPEND_MAGNETS.map(([mx, my]) => {
      const pts: Array<[number, number, number]> = [];
      for (let i = 0; i < 32; i++) {
        const t = (i / 32) * Math.PI * 2;
        pts.push([(mx + 0.12 * Math.cos(t)) * sc, (my + 0.12 * Math.sin(t)) * sc, 0]);
      }
      return { points: pts, color: 0xff7a30, closed: true };
    });
  },
};

export const SYSTEMS: Record<string, AttractorSystem> = {
  lorenz: LORENZ,
  rossler: ROSSLER,
  aizawa: AIZAWA,
  thomas: THOMAS,
  ...Object.fromEntries(NEW_FLOWS.map((s) => [s.id, s])),
  'henon-heiles': HENON_HEILES,
  'double-pendulum': DOUBLE_PENDULUM,
  duffing: DUFFING,
  'magnetic-pendulum': MAGNETIC_PENDULUM,
};

class StrangeAttractorArchetype implements Archetype {
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  readonly id: string;

  private readonly system: AttractorSystem;
  private readonly dim: number;
  private readonly state: Float64Array; // SoA-by-particle: [p0_x,p0_y,p0_z, p1_x, …]
  private readonly positions: Float32Array; // particleCount*3, render-space
  private readonly colors: Float32Array;

  constructor(system: AttractorSystem, config: ArchetypeConfig) {
    this.system = system;
    this.id = system.id;
    this.dim = system.dim;
    this.particleCount = config.particleCount;

    const n = this.particleCount;
    this.state = new Float64Array(n * this.dim);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);

    const rng = mulberry32(config.seed);
    for (let i = 0; i < n; i++) {
      system.sampleInit(this.state, i * this.dim, rng);
    }
    spectralGradient(n, this.colors);
    this.syncPositions();
  }

  step(dt: number, p: ResolvedParams): void {
    const { state, dim, system } = this;
    const n = this.particleCount;
    for (let i = 0; i < n; i++) {
      const off = i * dim;
      rk4Step(state, off, dim, system.deriv, p, dt);
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const { state, positions, dim, system } = this;
    const [cx, cy, cz] = system.center;
    const s = system.scale;
    const n = this.particleCount;
    const project = system.project;
    for (let i = 0; i < n; i++) {
      const so = i * dim;
      const po = i * 3;
      // Guard against blow-ups (e.g. dt too large): re-seed a stuck particle to the seed point.
      // Reseed all `dim` components so a recovered 4-D particle restarts at a valid phase point.
      if (!Number.isFinite(state[so])) {
        for (let k = 0; k < dim; k++) state[so + k] = system.seedPoint[k] ?? 0;
      }
      if (project) {
        project(state, so, positions, po); // writes the 3 raw render coords
      } else {
        positions[po] = state[so];
        positions[po + 1] = state[so + 1];
        positions[po + 2] = state[so + 2];
      }
      positions[po] = (positions[po] - cx) * s;
      positions[po + 1] = (positions[po + 1] - cy) * s;
      positions[po + 2] = (positions[po + 2] - cz) * s;
    }
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

  loadState(s: Float64Array): void {
    this.state.set(s.subarray(0, this.state.length));
    this.syncPositions();
  }

  getHierarchy(): NodeSpec[] {
    return [
      {
        id: 'root',
        parentId: null,
        label: this.system.label,
        stateOffset: 0,
        stateLength: this.state.length,
        params: { ...this.system.defaults },
      },
    ];
  }

  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: this.system.pointSize };
  }

  dispose(): void {
    /* buffers are GC'd with the instance; nothing external to release in the slice */
  }
}

export function makeAttractorFactory(system: AttractorSystem): ArchetypeFactory {
  return {
    id: system.id,
    label: system.label,
    category: 'Attractor',
    kind: 'flow',
    params: system.paramSpec,
    defaultParticleCount: 100_000,
    defaultDt: system.dt,
    guides: system.guides,
    create: (config) => new StrangeAttractorArchetype(system, config),
  };
}

import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  GuideLine,
  GuideSpec,
  NodeSpec,
  ParamSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';
import { hslToRgb } from '../core/color';

// Dynamical billiard ("Chaos in a Circle"): free-flight point particles bouncing inside a bounded
// 2-D domain (the z=0 plane), reflecting specularly off the wall — v ← v − 2(v·n)n. The dynamics
// are entirely controlled by the BOUNDARY SHAPE:
//   • circle  → INTEGRABLE. Each orbit conserves both energy and angular momentum, so it forever
//     skirts a caustic circle of fixed radius |L|/|v|. Trajectories never fill the disc; a particle
//     traces a fixed annulus → a tidy rosette.
//   • stadium → Bunimovich stadium (two semicircular caps on a rectangle). Provably ergodic /
//     fully chaotic: a single orbit fills the whole region and nearby orbits diverge exponentially.
//   • polygon-N → regular N-gon. Rational-angle polygons are "pseudo-integrable"; in practice an
//     N-gon orbit folds across the whole interior and a tight cloud spreads, the canonical contrast
//     to the circle's frozen rosette.
//
// Geometry is normalised so the domain fits the render frame: the bounding "radius" is R≈1.2 render
// units. The state is genuine pos+vel (like boids/nbody), integrated by free flight with a robust
// wall handler that SUB-STEPS the exact wall crossing so particles never leak through wall or corner
// at the default dt. The trails are the visual — `defaultTrail` is large.

// Discrete boundary selector (UI renders a <select> from `options`). Encoded as an int so it rides
// the numeric ResolvedParams; `rebuild` because changing the wall reshapes the seeded cloud.
const SHAPE_CIRCLE = 0;
const SHAPE_STADIUM = 1;
const SHAPE_TRIANGLE = 2; // regular polygon, 3 sides
const SHAPE_PENTAGON = 3; // regular polygon, 5 sides
const SHAPE_HEXAGON = 4; // regular polygon, 6 sides

// polygon side count per shape id (0 for the non-polygon shapes)
function polygonSides(shape: number): number {
  if (shape === SHAPE_TRIANGLE) return 3;
  if (shape === SHAPE_PENTAGON) return 5;
  if (shape === SHAPE_HEXAGON) return 6;
  return 0;
}

const R = 1.2; // domain "radius": circle radius, polygon circumradius, stadium cap radius
const SPEED = 0.9; // fixed launch speed (|v| is conserved by elastic reflection)
const STADIUM_HALF = 0.7; // half-length of the stadium's straight section (cap centres at ±this)
const DIM = 4; // per-particle state: [x, y, vx, vy]
const EPS = 1e-6; // pull-back margin so a reflected point sits strictly inside the wall
const MAX_BOUNCES = 8; // wall hits resolved per step before giving up (a step rarely needs >1)

const PARAM_SPEC: ParamSpec[] = [
  {
    key: 'shape',
    label: 'boundary',
    min: 0,
    max: 4,
    step: 1,
    default: SHAPE_STADIUM,
    options: { circle: SHAPE_CIRCLE, stadium: SHAPE_STADIUM, triangle: SHAPE_TRIANGLE, pentagon: SHAPE_PENTAGON, hexagon: SHAPE_HEXAGON },
    rebuild: true,
  },
  // The wall is fixed/elastic, but a tiny global drag lets the user damp orbits toward the centre.
  // Default 0 → |v| strictly conserved (the physically pure billiard).
  { key: 'drag', label: 'drag', min: 0, max: 0.05, step: 0.001, default: 0 },
  // Visual: marker size of the moving particle head.
  { key: 'pointSize', label: 'point size', min: 0.004, max: 0.03, step: 0.001, default: 0.01 },
];

// ── Analytic wall geometry ──────────────────────────────────────────────────────────────────────
// For each shape: insideDepth(x,y) ≥ 0 inside, < 0 outside (signed-distance-like, not exact metric
// for the polygon but monotone and zero on the wall), and a wall normal pointing INWARD at a point.

// half-plane normals (inward) and offsets for a regular N-gon with circumradius R, flat side facing
// "down" is irrelevant — we just need a consistent set of inward normals. Each side i lies on the
// line  n_i · p = R·cos(π/N)  (apothem), with n_i the OUTWARD unit normal; inside ⇔ n_i·p ≤ apothem.
function polygonEdges(sides: number): { nx: number; ny: number; off: number }[] {
  const apothem = R * Math.cos(Math.PI / sides);
  const edges: { nx: number; ny: number; off: number }[] = [];
  for (let i = 0; i < sides; i++) {
    // vertices at angle (2π i / N + π/2); edge midpoints (outward normals) sit between vertices.
    const a = (2 * Math.PI * i) / sides + Math.PI / 2 + Math.PI / sides;
    edges.push({ nx: Math.cos(a), ny: Math.sin(a), off: apothem });
  }
  return edges;
}

// signed inside-depth: > 0 strictly inside, = 0 on the wall, < 0 outside.
function insideDepth(shape: number, x: number, y: number): number {
  if (shape === SHAPE_CIRCLE) {
    return R - Math.hypot(x, y);
  }
  if (shape === SHAPE_STADIUM) {
    // distance to the boundary of a stadium: rectangle |x|≤H, |y|≤R capped by two circles of radius
    // R centred at (±H, 0). Clamp x into the straight section, then it's R − dist to that segment.
    const cx = x > STADIUM_HALF ? STADIUM_HALF : x < -STADIUM_HALF ? -STADIUM_HALF : x;
    return R - Math.hypot(x - cx, y);
  }
  // regular polygon: min over edges of (apothem − n·p); inside ⇔ all positive.
  const sides = polygonSides(shape);
  const edges = polygonEdges(sides);
  let d = Infinity;
  for (const e of edges) {
    const gap = e.off - (e.nx * x + e.ny * y);
    if (gap < d) d = gap;
  }
  return d;
}

// INWARD unit normal of the wall nearest to (x,y) — used to reflect velocity. Assumes (x,y) is at
// or just past the wall (the caller resolves the crossing point before asking).
function wallNormal(shape: number, x: number, y: number, out: { nx: number; ny: number }): void {
  if (shape === SHAPE_CIRCLE) {
    const r = Math.hypot(x, y) || 1e-9;
    out.nx = -x / r; // inward = toward centre
    out.ny = -y / r;
    return;
  }
  if (shape === SHAPE_STADIUM) {
    if (x > STADIUM_HALF || x < -STADIUM_HALF) {
      // on a circular cap: inward normal points from the cap centre's OUTWARD radial, negated.
      const cx = x > 0 ? STADIUM_HALF : -STADIUM_HALF;
      const dx = x - cx;
      const r = Math.hypot(dx, y) || 1e-9;
      out.nx = -dx / r;
      out.ny = -y / r;
    } else {
      // on a straight top/bottom edge: inward normal is purely vertical, toward y=0.
      out.nx = 0;
      out.ny = y >= 0 ? -1 : 1;
    }
    return;
  }
  // polygon: the active edge is the one with the smallest gap (most violated). Inward = −outward.
  const sides = polygonSides(shape);
  const edges = polygonEdges(sides);
  let best = -Infinity;
  let bnx = 0;
  let bny = 0;
  for (const e of edges) {
    const signed = e.nx * x + e.ny * y - e.off; // > 0 means outside this edge
    if (signed > best) {
      best = signed;
      bnx = e.nx;
      bny = e.ny;
    }
  }
  out.nx = -bnx;
  out.ny = -bny;
}

// Seed (x,y) strictly inside the chosen domain. Rejection-sample a disc of radius R; cheap because
// every shape contains a comfortable central disc, and we keep a margin off the wall.
function seedInside(shape: number, rng: () => number, out: { x: number; y: number }): void {
  for (let tries = 0; tries < 64; tries++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * R * 0.85; // area-uniform, with margin off the wall
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (insideDepth(shape, x, y) > 0.05) {
      out.x = x;
      out.y = y;
      return;
    }
  }
  out.x = 0; // fallback: the centre is inside every shape
  out.y = 0;
}

class BilliardArchetype implements Archetype {
  readonly id = 'billiard';
  readonly kind = 'flow' as const;
  readonly particleCount: number;

  private readonly state: Float64Array; // [x, y, vx, vy] per particle
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly shape: number;
  private readonly n: { nx: number; ny: number } = { nx: 0, ny: 0 };
  private readonly seed: { x: number; y: number } = { x: 0, y: 0 };

  constructor(config: ArchetypeConfig) {
    this.particleCount = config.particleCount;
    const n = this.particleCount;
    this.shape = Math.round(config.params.shape ?? SHAPE_STADIUM);
    this.state = new Float64Array(n * DIM);
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);

    const rng = mulberry32(config.seed);
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      seedInside(this.shape, rng, this.seed);
      const ang = rng() * Math.PI * 2; // launch direction; fixed speed
      this.state[o] = this.seed.x;
      this.state[o + 1] = this.seed.y;
      this.state[o + 2] = Math.cos(ang) * SPEED;
      this.state[o + 3] = Math.sin(ang) * SPEED;
      // colour by launch angle — bounces preserve the family, so the rosette/chaos is legible.
      hslToRgb((ang / (Math.PI * 2)) * 0.85, 0.85, 0.6, this.colors, i * 3);
    }
    this.syncPositions();
  }

  step(dt: number, p: ResolvedParams): void {
    const st = this.state;
    const n = this.particleCount;
    const shape = this.shape;
    const drag = p.drag ?? 0;
    const damp = drag > 0 ? Math.exp(-drag * dt) : 1; // multiplicative per-step speed decay (optional)
    const nrm = this.n;

    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      let x = st[o];
      let y = st[o + 1];
      let vx = st[o + 2] * damp;
      let vy = st[o + 3] * damp;
      let remaining = dt;

      // Advance by free flight; whenever the straight move would exit the wall, find the crossing
      // fraction, reflect there, and continue the remaining time. Bounded bounce count keeps a
      // grazing corner hit from looping forever.
      for (let b = 0; b < MAX_BOUNCES; b++) {
        const nx = x + vx * remaining;
        const ny = y + vy * remaining;
        if (insideDepth(shape, nx, ny) >= 0) {
          x = nx;
          y = ny;
          remaining = 0;
          break;
        }
        // Bisection on the crossing time t∈[0,remaining]: depth(x+vt) goes + → − across the wall.
        let lo = 0;
        let hi = remaining;
        for (let it = 0; it < 28; it++) {
          const mid = (lo + hi) * 0.5;
          if (insideDepth(shape, x + vx * mid, y + vy * mid) >= 0) lo = mid;
          else hi = mid;
        }
        // advance to just inside the crossing, reflect, spend the consumed time.
        const tcross = lo;
        x += vx * tcross;
        y += vy * tcross;
        wallNormal(shape, x, y, nrm);
        const vdotn = vx * nrm.nx + vy * nrm.ny;
        vx -= 2 * vdotn * nrm.nx;
        vy -= 2 * vdotn * nrm.ny;
        // nudge strictly inside along the inward normal so the next free-flight test starts inside
        // (guards against re-detecting the same wall from a point sitting exactly on it).
        x += nrm.nx * EPS;
        y += nrm.ny * EPS;
        remaining -= tcross;
        if (remaining <= 1e-9) break;
      }

      // Safety net: if a pathological corner still left us outside, project back to the centre ray.
      if (insideDepth(shape, x, y) < 0) {
        const r = Math.hypot(x, y) || 1e-9;
        const pull = (R * 0.98) / r;
        x *= pull;
        y *= pull;
      }

      st[o] = x;
      st[o + 1] = y;
      st[o + 2] = vx;
      st[o + 3] = vy;
    }
    this.syncPositions();
  }

  private syncPositions(): void {
    const st = this.state;
    const pos = this.positions;
    const n = this.particleCount;
    for (let i = 0; i < n; i++) {
      const o = i * DIM;
      const po = i * 3;
      pos[po] = st[o];
      pos[po + 1] = st[o + 1];
      pos[po + 2] = 0; // strictly the z=0 plane
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
    return [{ id: 'root', parentId: null, label: `Billiard (${this.particleCount})`, stateOffset: 0, stateLength: this.state.length, particleStart: 0, particleCount: this.particleCount }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.01 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

// Boundary wall as a closed guide loop (sampled densely enough that sampleGuide's 0.025-unit
// resampling traces a clean curve). Reads the factory's CURRENT shape param default.
function shapeGuide(shape: number): GuideSpec {
  const color = 0x6fb7ff;
  const pts: Array<[number, number, number]> = [];
  if (shape === SHAPE_CIRCLE) {
    for (let i = 0; i < 96; i++) {
      const t = (i / 96) * Math.PI * 2;
      pts.push([Math.cos(t) * R, Math.sin(t) * R, 0]);
    }
    return [{ points: pts, color, closed: true }];
  }
  if (shape === SHAPE_STADIUM) {
    const seg = 48;
    // right cap: angle −π/2 → +π/2 about (+H,0)
    for (let i = 0; i <= seg; i++) {
      const t = -Math.PI / 2 + (i / seg) * Math.PI;
      pts.push([STADIUM_HALF + Math.cos(t) * R, Math.sin(t) * R, 0]);
    }
    // left cap: angle +π/2 → +3π/2 about (−H,0)
    for (let i = 0; i <= seg; i++) {
      const t = Math.PI / 2 + (i / seg) * Math.PI;
      pts.push([-STADIUM_HALF + Math.cos(t) * R, Math.sin(t) * R, 0]);
    }
    return [{ points: pts, color, closed: true }];
  }
  const sides = polygonSides(shape);
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides + Math.PI / 2;
    pts.push([Math.cos(a) * R, Math.sin(a) * R, 0]);
  }
  return [{ points: pts, color, closed: true }];
}

export const billiardFactory: ArchetypeFactory = {
  id: 'billiard',
  label: 'Dynamical Billiard',
  category: 'Billiard',
  kind: 'flow',
  params: PARAM_SPEC,
  defaultParticleCount: 5000, // enough density to glow bright, sparse enough that trajectories texture it
  particleCountOptions: [1500, 5000, 12_000, 30_000],
  defaultDt: 0.02,
  defaultTrail: 160, // the trails ARE the visual — moderate history paints each orbit's recent path
  // Guide reflects the default boundary (stadium). Rebuilds on system switch via bootstrap.
  guides: (): GuideSpec => shapeGuide(SHAPE_STADIUM),
  create: (config) => new BilliardArchetype(config),
};

export { shapeGuide, insideDepth, wallNormal, polygonSides, SHAPE_CIRCLE, SHAPE_STADIUM, SHAPE_TRIANGLE, R, SPEED };
export type { GuideLine };

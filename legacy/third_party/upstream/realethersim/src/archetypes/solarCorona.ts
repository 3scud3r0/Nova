import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Solar Corona. The Sun seen in extreme ultraviolet — the way space telescopes watch it flare. What
// glows are not flames but PLASMA TRAPPED ON MAGNETIC FIELD LINES: each active region is a pair of
// magnetic footpoints (opposite polarity sunspots), and the million-degree coronal loops arc between
// them along the field. We build that structure directly — active regions scattered in the ±latitude
// bands where real sunspots emerge, each a fan of loops rising from its footpoints; a mottled granular
// surface; and near-radial plumes at the poles where the field opens to the solar wind. Lit in the
// teal of the 171 Å channel, footpoints white-hot, the whole disk turning with the ~25-day rotation.
const R = 1.0; // solar radius (render units)
const TAU = Math.PI * 2;

class SolarCoronaArchetype implements Archetype {
  readonly id = 'solarCorona';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly bx: Float64Array; // baked positions (pre-rotation)
  private readonly by: Float64Array;
  private readonly bz: Float64Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private spin = 0.15;
  private erSpeed = 0.28; // eruption cycle rate
  // erupting plasma (prominences + CMEs) — trajectories computed per frame, not baked as static points
  private ejStart = 0; // index where the ejecta block begins
  private ejN = 0;
  private ejAnchor = new Float64Array(0); // unit launch anchor (site + spread)
  private ejTan = new Float64Array(0); // tangential drift direction
  private ejS = new Float64Array(0); // peak height
  private ejEsc = new Uint8Array(0); // 1 = escapes (CME), 0 = rises & falls back (prominence)
  private ejPh = new Float64Array(0); // eruption phase offset
  private t = 0;
  private buildKey = '';
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    this.particleCount = Math.max(1, config.particleCount);
    this.bx = new Float64Array(this.particleCount);
    this.by = new Float64Array(this.particleCount);
    this.bz = new Float64Array(this.particleCount);
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.seed = config.seed;
    this.rebuild(config.params);
  }

  private keyOf(p: ResolvedParams): string {
    return `${Math.round(p.regions ?? 6)},${Math.round((p.loopHeight ?? 0.32) * 100)},${Math.round((p.activity ?? 0.5) * 100)}`;
  }

  private rebuild(p: ResolvedParams): void {
    const regions = Math.max(1, Math.round(p.regions ?? 6));
    const loopH = p.loopHeight ?? 0.32;
    const activity = p.activity ?? 0.5; // fraction of points spent on loops vs surface
    this.spin = p.spin ?? 0.15;
    this.erSpeed = p.eruptions ?? 0.28;
    this.buildKey = this.keyOf(p);
    const rng = mulberry32((this.seed ^ 0x9e3779b9) >>> 0);
    const N = this.particleCount;
    const col = this.colors;

    const nEject = Math.floor(N * 0.09); // erupting plasma (prominences + CMEs)
    const nFlare = Math.floor(N * 0.06); // compact flare kernels (X-class brightening)
    const nLoop = Math.floor(N * clamp01(activity)); // coronal loops
    const nPlume = Math.floor(N * 0.04); // polar plumes
    const nHalo = Math.floor(N * 0.09); // soft corona halo (limb glow + extension)
    const nSurf = N - nLoop - nPlume - nHalo - nEject - nFlare; // granular surface shell

    let idx = 0;
    const put = (x: number, y: number, z: number, r: number, g: number, b: number): void => {
      if (idx >= N) return;
      this.bx[idx] = x; this.by[idx] = y; this.bz[idx] = z;
      col[idx * 3] = r; col[idx * 3 + 1] = g; col[idx * 3 + 2] = b;
      idx++;
    };

    // ── granular surface shell: Fibonacci sphere at r≈R, dim mottled teal (limb brightens by additive
    //    density where the line of sight grazes the shell) ──
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < nSurf; i++) {
      const yk = 1 - 2 * ((i + 0.5) / nSurf);
      const rr = Math.sqrt(Math.max(0, 1 - yk * yk));
      const phi = i * golden;
      const nx = rr * Math.cos(phi), ny = yk, nz = rr * Math.sin(phi);
      const jit = R * 0.006;
      const rad = R + (rng() - 0.5) * jit;
      // granulation: cheap value noise from a few hashed sinusoids
      const gran = 0.5 + 0.5 * Math.sin(nx * 47 + ny * 31) * Math.sin(nz * 53 - ny * 29) * Math.sin(nx * 23 + nz * 41);
      const v = 0.62 + 0.85 * gran * gran;
      put(nx * rad, ny * rad, nz * rad, v * 0.22, v * 0.88, v * 1.1);
    }

    // ── active regions: each a bundle of magnetic loops between two footpoints in the ±[10°,42°] bands ──
    const perRegion = Math.max(1, Math.floor(nLoop / regions));
    const loopsPerRegion = 30;
    const arcPts = Math.max(2, Math.floor(perRegion / loopsPerRegion));
    for (let rgn = 0; rgn < regions; rgn++) {
      // region centre C in a sunspot latitude band, random longitude, random hemisphere
      const lat = (10 + 32 * rng()) * (Math.PI / 180) * (rng() < 0.5 ? 1 : -1);
      const lon = rng() * TAU;
      const cx = Math.cos(lat) * Math.cos(lon), cy = Math.sin(lat), cz = Math.cos(lat) * Math.sin(lon);
      // tangent basis at C
      const [t1x, t1y, t1z, t2x, t2y, t2z] = tangentBasis(cx, cy, cz);
      const baseDirAng = rng() * TAU; // orientation of the footpoint axis in the tangent plane
      const strength = 0.5 + 0.9 * rng(); // region intensity
      for (let l = 0; l < loopsPerRegion; l++) {
        const az = baseDirAng + (rng() - 0.5) * 0.7; // fan spread
        const dx = Math.cos(az) * t1x + Math.sin(az) * t2x;
        const dy = Math.cos(az) * t1y + Math.sin(az) * t2y;
        const dz = Math.cos(az) * t1z + Math.sin(az) * t2z;
        const sep = (0.09 + 0.08 * rng()) * (0.7 + 0.6 * (l / loopsPerRegion)); // footpoint half-separation (rad)
        const cs = Math.cos(sep), sn = Math.sin(sep);
        const fpx = cx * cs + dx * sn, fpy = cy * cs + dy * sn, fpz = cz * cs + dz * sn; // +footpoint
        const fmx = cx * cs - dx * sn, fmy = cy * cs - dy * sn, fmz = cz * cs - dz * sn; // −footpoint
        const H = loopH * (0.2 + 0.7 * rng()) * (0.55 + 0.6 * sep / 0.17); // taller loops for wider feet
        for (let a = 0; a < arcPts; a++) {
          const s = arcPts === 1 ? 0.5 : a / (arcPts - 1);
          const [ux, uy, uz] = slerp(fpx, fpy, fpz, fmx, fmy, fmz, s);
          const rad = R + H * Math.sin(Math.PI * s) + (rng() - 0.5) * 0.004;
          const foot = Math.max(smooth01(s, 0.0, 0.14), smooth01(1 - s, 0.0, 0.14)); // bright near feet
          const b = strength * (0.55 + 0.4 * Math.sin(Math.PI * s)) * 1.05; // brighter along the arc crown
          const r0 = (0.35 + 0.78 * foot) * b; // white-hot footpoints
          const g0 = (0.9 + 0.1 * foot) * b;
          const b0 = 1.1 * b;
          put(ux * rad, uy * rad, uz * rad, r0, g0, b0);
        }
      }
    }

    // ── flare kernels: a couple of active regions host a blindingly bright, compact core — an
    //    X-class flare brightening — ringed by a low, intense post-flare loop crown ──
    const nFlareSites = Math.min(2, regions);
    const perFlare = Math.max(1, Math.floor(nFlare / Math.max(1, nFlareSites)));
    for (let fs = 0; fs < nFlareSites; fs++) {
      const lat = (12 + 28 * rng()) * (Math.PI / 180) * (rng() < 0.5 ? 1 : -1);
      const lon = rng() * TAU;
      const cx = Math.cos(lat) * Math.cos(lon), cy = Math.sin(lat), cz = Math.cos(lat) * Math.sin(lon);
      const [f1x, f1y, f1z, f2x, f2y, f2z] = tangentBasis(cx, cy, cz);
      for (let i = 0; i < perFlare; i++) {
        const kern = rng() < 0.68; // most points pile into the tight white-hot kernel
        const rr = kern ? 0.022 * Math.sqrt(rng()) : 0.05 + 0.06 * rng();
        const aa = rng() * TAU, ca = Math.cos(aa), sa = Math.sin(aa);
        let dx = cx + (f1x * ca + f2x * sa) * rr;
        let dy = cy + (f1y * ca + f2y * sa) * rr;
        let dz = cz + (f1z * ca + f2z * sa) * rr;
        const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
        const rad = R + (kern ? 0.004 : 0.055 * Math.sin(Math.PI * rng()));
        const b = kern ? 2.0 + 1.0 * rng() : 1.1 + 0.5 * rng(); // the kernel blows out to white
        put(dx * rad, dy * rad, dz * rad, b * 0.85, b * 0.95, b * 1.0);
      }
    }

    // ── polar plumes: soft near-radial streamers at high latitude (open field to the solar wind) ──
    for (let i = 0; i < nPlume; i++) {
      const hemi = rng() < 0.5 ? 1 : -1;
      const lat = (56 + 32 * rng()) * (Math.PI / 180) * hemi;
      const lon = rng() * TAU;
      const nx = Math.cos(lat) * Math.cos(lon), ny = Math.sin(lat), nz = Math.cos(lat) * Math.sin(lon);
      const h = Math.pow(rng(), 1.3) * 0.28; // shorter, softer than sharp needles
      const rad = R + h;
      const sway = (rng() - 0.5) * 0.05; // broader spread → streamers not spikes
      const v = (0.3 + 0.4 * (1 - h / 0.28)) * 0.8;
      put(nx * rad + sway, ny * rad, nz * rad + sway, v * 0.2, v * 0.66, v * 0.82);
    }

    // ── corona halo: a faint cyan shell hugging the limb, tapering outward (limb glow + soft extension) ──
    for (let i = 0; i < nHalo; i++) {
      const yk = 1 - 2 * ((i + 0.5) / nHalo);
      const rr = Math.sqrt(Math.max(0, 1 - yk * yk));
      const phi = i * golden * 1.7;
      const nx = rr * Math.cos(phi), ny = yk, nz = rr * Math.sin(phi);
      const h = Math.pow(rng(), 2.2) * 0.35; // dense at the surface, thinning out
      const rad = R + 0.008 + h;
      const v = (1 - h / 0.35) * 0.78; // brightest at the limb
      put(nx * rad, ny * rad, nz * rad, v * 0.2, v * 0.7, v * 0.92);
    }

    // ── erupting plasma: prominences (rise & fall) and CMEs (escape) launched from a few active sites,
    //    each site cycling with a staggered phase. Trajectories are computed live in syncPositions; here
    //    we bake each particle's launch geometry. This block is contiguous at the END of the buffer. ──
    this.ejStart = idx;
    this.ejN = N - idx;
    const M = this.ejN;
    this.ejAnchor = new Float64Array(M * 3);
    this.ejTan = new Float64Array(M * 3);
    this.ejS = new Float64Array(M);
    this.ejEsc = new Uint8Array(M);
    this.ejPh = new Float64Array(M);
    const nSites = 4;
    const sites: number[][] = [];
    for (let s = 0; s < nSites; s++) {
      const lat = (12 + 34 * rng()) * (Math.PI / 180) * (rng() < 0.5 ? 1 : -1);
      const lon = rng() * TAU;
      const cx = Math.cos(lat) * Math.cos(lon), cy = Math.sin(lat), cz = Math.cos(lat) * Math.sin(lon);
      const [t1x, t1y, t1z, t2x, t2y, t2z] = tangentBasis(cx, cy, cz);
      sites.push([cx, cy, cz, t1x, t1y, t1z, t2x, t2y, t2z, s / nSites]); // last = phase offset
    }
    for (let k = 0; k < M; k++) {
      const S = sites[k % nSites];
      const spread = 0.12 * Math.sqrt(rng());
      const sa = rng() * TAU;
      // anchor: site centre nudged by a small tangential spread (the eruption's footprint)
      let ax = S[0] + (S[3] * Math.cos(sa) + S[6] * Math.sin(sa)) * spread;
      let ay = S[1] + (S[4] * Math.cos(sa) + S[7] * Math.sin(sa)) * spread;
      let az = S[2] + (S[5] * Math.cos(sa) + S[8] * Math.sin(sa)) * spread;
      const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
      // tangential drift direction (the arc lean)
      const ta = rng() * TAU;
      this.ejTan[k * 3] = S[3] * Math.cos(ta) + S[6] * Math.sin(ta);
      this.ejTan[k * 3 + 1] = S[4] * Math.cos(ta) + S[7] * Math.sin(ta);
      this.ejTan[k * 3 + 2] = S[5] * Math.cos(ta) + S[8] * Math.sin(ta);
      this.ejAnchor[k * 3] = ax; this.ejAnchor[k * 3 + 1] = ay; this.ejAnchor[k * 3 + 2] = az;
      const esc = rng() < 0.22;
      this.ejEsc[k] = esc ? 1 : 0;
      this.ejS[k] = esc ? 0.5 + 0.6 * rng() : 0.25 + 0.38 * rng(); // CMEs fly higher than confined prominences
      this.ejPh[k] = S[9] + (rng() - 0.5) * 0.12; // share the site's phase (erupt together), slight jitter
      const bri = 0.7 + 0.4 * rng();
      put(ax * R, ay * R, az * R, 0.5 * bri, 0.9 * bri, 1.0 * bri); // hot cyan-white plasma
    }

    // any leftover slots (rounding) → dim surface points at the origin-safe shell
    while (idx < N) put(0, R, 0, 0.02, 0.1, 0.14);
    this.syncPositions();
  }

  private syncPositions(): void {
    const pos = this.positions;
    const t = this.t;
    // solar rotation about a slightly tilted axis
    const th = this.spin * t;
    const ct = Math.cos(th), st = Math.sin(th);
    const tilt = 0.12, ctl = Math.cos(tilt), stl = Math.sin(tilt);
    const place = (i: number, x0: number, y0: number, z0: number): void => {
      const rx = x0 * ct + z0 * st; // rotate about Y (solar rotation)
      const rz = -x0 * st + z0 * ct;
      const o = i * 3;
      pos[o] = rx;
      pos[o + 1] = y0 * ctl - rz * stl; // small fixed tilt about X so the axis leans
      pos[o + 2] = y0 * stl + rz * ctl;
    };
    // static structure (surface shell, coronal loops, plumes, halo)
    for (let i = 0; i < this.ejStart; i++) place(i, this.bx[i], this.by[i], this.bz[i]);
    // erupting plasma: each particle rises along a rise-&-fall (prominence) or escape (CME) height
    // envelope over its eruption phase, drifting tangentially into an arc, then rotates with the Sun
    for (let k = 0; k < this.ejN; k++) {
      const ph = t * this.erSpeed + this.ejPh[k];
      const tau = ph - Math.floor(ph); // eruption phase ∈ [0,1)
      const hEnv = this.ejEsc[k] ? tau : 4 * tau * (1 - tau);
      const h = this.ejS[k] * hEnv;
      const drift = tau * 0.5;
      let dx = this.ejAnchor[k * 3] + this.ejTan[k * 3] * drift;
      let dy = this.ejAnchor[k * 3 + 1] + this.ejTan[k * 3 + 1] * drift;
      let dz = this.ejAnchor[k * 3 + 2] + this.ejTan[k * 3 + 2] * drift;
      const l = Math.hypot(dx, dy, dz) || 1;
      const rad = R + h;
      place(this.ejStart + k, (dx / l) * rad, (dy / l) * rad, (dz / l) * rad);
    }
  }

  step(dt: number, p: ResolvedParams): void {
    const key = this.keyOf(p);
    if (key !== this.buildKey) {
      this.rebuild(p);
      return;
    }
    this.spin = p.spin ?? 0.15;
    this.erSpeed = p.eruptions ?? 0.28;
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return new Float64Array([this.t]);
  }
  loadState(s: Float64Array): void {
    this.t = s[0] ?? 0;
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Solar corona (EUV)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.015 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smooth01(x: number, a: number, b: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// an orthonormal tangent basis (t1, t2) at unit normal n
function tangentBasis(nx: number, ny: number, nz: number): number[] {
  // pick a reference not parallel to n
  let ax = 0, ay = 1, az = 0;
  if (Math.abs(ny) > 0.9) { ax = 1; ay = 0; az = 0; }
  // t1 = normalize(a − (a·n)n)
  const d = ax * nx + ay * ny + az * nz;
  let t1x = ax - d * nx, t1y = ay - d * ny, t1z = az - d * nz;
  const l1 = Math.hypot(t1x, t1y, t1z) || 1;
  t1x /= l1; t1y /= l1; t1z /= l1;
  // t2 = n × t1
  const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;
  return [t1x, t1y, t1z, t2x, t2y, t2z];
}

// spherical linear interpolation between two unit vectors
function slerp(ax: number, ay: number, az: number, bx: number, by: number, bz: number, s: number): number[] {
  let d = ax * bx + ay * by + az * bz;
  d = d < -1 ? -1 : d > 1 ? 1 : d;
  const om = Math.acos(d);
  const so = Math.sin(om);
  if (so < 1e-4) return [ax, ay, az];
  const w1 = Math.sin((1 - s) * om) / so;
  const w2 = Math.sin(s * om) / so;
  return [ax * w1 + bx * w2, ay * w1 + by * w2, az * w1 + bz * w2];
}

export const solarCoronaFactory: ArchetypeFactory = {
  id: 'solarCorona',
  label: 'Solar Corona',
  category: 'Plasma',
  kind: 'flow',
  params: [
    { key: 'regions', label: 'active regions', min: 1, max: 12, step: 1, default: 6, rebuild: true },
    { key: 'loopHeight', label: 'loop height', min: 0.08, max: 0.5, step: 0.02, default: 0.2, rebuild: true },
    { key: 'activity', label: 'activity', min: 0.3, max: 0.8, step: 0.02, default: 0.46, rebuild: true }, // loops vs surface
    { key: 'eruptions', label: 'eruptions', min: 0, max: 0.8, step: 0.02, default: 0.28 }, // prominence/CME cycle rate
    { key: 'spin', label: 'rotation', min: 0, max: 1, step: 0.02, default: 0.15 },
  ],
  defaultParticleCount: 220_000,
  particleCountOptions: [120_000, 220_000, 350_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the corona structure IS the visual
  bloom: 0.55, // flare kernels and limb should bloom
  create: (config) => new SolarCoronaArchetype(config),
};

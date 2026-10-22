import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Lightning. A cloud-to-ground strike is dielectric breakdown, and its shape is Laplacian growth —
// the same family as our DLA: a STEPPED LEADER crackles downward in discrete stochastic steps,
// branching into a fractal tree (the dielectric-breakdown model of Niemeyer–Pietronero–Wiesmann).
// The drama is the event structure: the instant one branch attaches to ground, the RETURN STROKE
// flashes white-hot up the winning channel — the other branches never brighten — then the bolt
// decays and a new, different tree grows. We run that full cycle: colours are baked once (faint
// violet channel, white-hot flash pool, dim cloud + ground), and ALL motion lives in positions —
// unborn points park inside the cloud clump, the leader reveals in birth order, the flash pool
// floods the main channel from the ground up with per-frame crackle, then everything retracts to
// the cloud and the next strike begins from a fresh deterministic seed. Bounded by the domain.
const CLOUD_Y = 1.25; // cloud charge centre height
const GROUND_Y = -1.25; // ground plane height
const STEP = 0.075; // leader step length
const MAX_SEGS = 700; // hard cap on tree size (bounds per-strike work)
const TAU = Math.PI * 2;

interface Seg {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  birth: number; // stepped-leader step index (reveal order)
  parent: number; // index into segs, -1 for root
  len: number;
}

class LightningArchetype implements Archetype {
  readonly id = 'lightning';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // slot layout: [ground][cloud][channel][flash] — fixed at construction, colours baked per block
  private readonly nGround: number;
  private readonly nCloud: number;
  private readonly nChan: number;
  private readonly nFlash: number;
  private readonly gndPos: Float64Array; // static ground strip
  private readonly cldPos: Float64Array; // static cloud clump (also the "unborn" parking lot)
  private readonly chanFinal: Float64Array; // per channel slot: final position on the tree
  private readonly chanBirth: Float64Array; // per channel slot: fractional birth step
  private readonly chanPark: Float64Array; // per channel slot: parking spot inside the cloud
  private readonly flashF: Float64Array; // per flash slot: arc fraction along the main channel, 0 = ground
  private readonly flashPark: Float64Array; // per flash slot: cloud parking spot
  private mainPath: Float64Array = new Float64Array(0); // main-channel polyline (x,y,z triples, cloud→ground)
  private mainCum: Float64Array = new Float64Array(0); // cumulative arc length per polyline vertex
  private mainLen = 1;
  private maxBirth = 1;
  private strikeX = 0; // ground attachment point (flash pool parks here pre-sweep)
  private strikeZ = 0;
  private strike = 0; // strike counter (seeds the next tree)
  private phase = 0; // 0 grow, 1 flash, 2 decay, 3 dark
  private phaseT = 0;
  private frame = 0; // per-frame crackle jitter source
  private speed = 1;
  private branchP = 0.22;
  private wander = 0.7;
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    this.particleCount = Math.max(64, config.particleCount);
    const N = this.particleCount;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.seed = config.seed;
    this.nGround = Math.floor(N * 0.04);
    this.nCloud = Math.floor(N * 0.08);
    this.nFlash = Math.floor(N * 0.24);
    this.nChan = N - this.nGround - this.nCloud - this.nFlash;
    this.gndPos = new Float64Array(this.nGround * 3);
    this.cldPos = new Float64Array(this.nCloud * 3);
    this.chanFinal = new Float64Array(this.nChan * 3);
    this.chanBirth = new Float64Array(this.nChan);
    this.chanPark = new Float64Array(this.nChan * 3);
    this.flashF = new Float64Array(this.nFlash);
    this.flashPark = new Float64Array(this.nFlash * 3);

    // ── bake the static furniture + all colours ONCE (colour re-uploads are a no-op) ──
    const rng = mulberry32((this.seed ^ 0x51ce7ab1) >>> 0);
    const col = this.colors;
    let o = 0;
    for (let i = 0; i < this.nGround; i++) {
      // a thin hazy ground strip (context for the strike point)
      this.gndPos[i * 3] = (rng() * 2 - 1) * 1.6;
      this.gndPos[i * 3 + 1] = GROUND_Y - rng() * 0.04;
      this.gndPos[i * 3 + 2] = (rng() * 2 - 1) * 0.5;
      const v = 0.06 + 0.08 * rng();
      col[o * 3] = v; col[o * 3 + 1] = v * 1.05; col[o * 3 + 2] = v * 1.3;
      o++;
    }
    for (let i = 0; i < this.nCloud; i++) {
      // the charge centre: a flattened clump the bolt is born from
      const a = rng() * TAU;
      const r = Math.sqrt(rng()) * 0.5;
      this.cldPos[i * 3] = Math.cos(a) * r * 1.4;
      this.cldPos[i * 3 + 1] = CLOUD_Y + (rng() - 0.5) * 0.22;
      this.cldPos[i * 3 + 2] = Math.sin(a) * r * 0.6;
      const v = 0.12 + 0.14 * rng();
      col[o * 3] = v * 0.85; col[o * 3 + 1] = v * 0.9; col[o * 3 + 2] = v * 1.25;
      o++;
    }
    for (let i = 0; i < this.nChan; i++) {
      // leader channel: cold violet, a few hotter filaments (bright enough to read beside the flash)
      const hot = rng() < 0.12 ? 1.7 : 1;
      const v = (0.55 + 0.55 * rng()) * hot;
      col[o * 3] = v * 0.72; col[o * 3 + 1] = v * 0.62; col[o * 3 + 2] = v * 1.0;
      // parking spot inside the cloud clump (unborn points add to the cloud glow)
      const a = rng() * TAU;
      const r = Math.sqrt(rng()) * 0.45;
      this.chanPark[i * 3] = Math.cos(a) * r * 1.4;
      this.chanPark[i * 3 + 1] = CLOUD_Y + (rng() - 0.5) * 0.2;
      this.chanPark[i * 3 + 2] = Math.sin(a) * r * 0.6;
      o++;
    }
    for (let i = 0; i < this.nFlash; i++) {
      // return-stroke pool: white-hot (mild HDR overdrive — the bloom pass loves it)
      const v = 1.05 + 0.35 * rng();
      col[o * 3] = v * 0.96; col[o * 3 + 1] = v * 0.97; col[o * 3 + 2] = v * 1.08;
      this.flashF[i] = rng(); // arc fraction along the main channel (0 = ground, 1 = cloud)
      const a = rng() * TAU;
      const r = Math.sqrt(rng()) * 0.4;
      this.flashPark[i * 3] = Math.cos(a) * r * 1.4;
      this.flashPark[i * 3 + 1] = CLOUD_Y + (rng() - 0.5) * 0.18;
      this.flashPark[i * 3 + 2] = Math.sin(a) * r * 0.6;
      o++;
    }

    this.readParams(config.params);
    // Start 1.25s into the first GROW: the live view opens with a leader already crackling down, and
    // the offline thumbnail capture (~3.2 sim-seconds of development) lands mid-FLASH — the money shot.
    this.phaseT = 1.25;
    this.growTree();
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.speed = p.speed ?? 1;
    this.branchP = p.branchiness ?? 0.22;
    this.wander = p.wander ?? 0.7;
  }

  // ── grow one strike's stepped-leader tree (deterministic per strike; reads live params) ──
  private growTree(): void {
    const rng = mulberry32((this.seed ^ Math.imul(this.strike + 1, 2654435761)) >>> 0);
    const segs: Seg[] = [];
    // walker stack: [x, y, z, dx, dy, dz, parentIdx, birth]
    const stack: number[][] = [[(rng() - 0.5) * 0.4, CLOUD_Y, (rng() - 0.5) * 0.2, 0, -1, 0, -1, 0]];
    let grounded = -1;
    while (stack.length > 0 && segs.length < MAX_SEGS) {
      const w = stack.pop() as number[];
      let [x, y, z, dx, dy, dz] = w;
      let parent = w[6];
      let birth = w[7];
      // walk this branch until it grounds, dies, or the tree fills up
      for (let s = 0; s < 220 && segs.length < MAX_SEGS; s++) {
        // new direction: light momentum + downward pull + strong lateral wander → jagged kinks
        let ndx = dx * 0.42 + (rng() - 0.5) * this.wander * 1.35;
        let ndy = dy * 0.42 - (0.38 + 0.42 * rng());
        let ndz = dz * 0.42 + (rng() - 0.5) * this.wander * 0.4; // shallower in z: bolt stays face-on
        const il = 1 / (Math.hypot(ndx, ndy, ndz) || 1);
        ndx *= il; ndy *= il; ndz *= il;
        let nx = x + ndx * STEP;
        let ny = y + ndy * STEP;
        let nz = z + ndz * STEP;
        nx = Math.max(-1.55, Math.min(1.55, nx));
        nz = Math.max(-0.7, Math.min(0.7, nz));
        let hit = false;
        if (ny <= GROUND_Y) { ny = GROUND_Y; hit = true; }
        segs.push({ ax: x, ay: y, az: z, bx: nx, by: ny, bz: nz, birth, parent, len: Math.hypot(nx - x, ny - y, nz - z) });
        parent = segs.length - 1;
        birth += 1;
        if (hit) {
          if (grounded < 0) grounded = parent; // first branch to attach wins the return stroke
          break;
        }
        // stochastic side branch (branchiness), forked off the current tip
        if (rng() < this.branchP && stack.length < 40) {
          const sgn = rng() < 0.5 ? -1 : 1;
          stack.push([nx, ny, nz, ndx * 0.3 + sgn * (0.5 + 0.4 * rng()), ndy * 0.6, ndz * 0.3 + (rng() - 0.5) * 0.4, parent, birth]);
        }
        x = nx; y = ny; z = nz; dx = ndx; dy = ndy; dz = ndz;
      }
    }
    // guarantee an attachment: if wander kept every branch airborne, drop the lowest tip straight down
    if (grounded < 0) {
      let low = 0;
      for (let i = 1; i < segs.length; i++) if (segs[i].by < segs[low].by) low = i;
      const t = segs[low];
      segs.push({ ax: t.bx, ay: t.by, az: t.bz, bx: t.bx, by: GROUND_Y, bz: t.bz, birth: t.birth + 1, parent: low, len: t.by - GROUND_Y });
      grounded = segs.length - 1;
    }
    // main channel polyline: walk parents from the grounded tip to the root (then reverse → cloud→ground)
    const chain: number[] = [];
    for (let i = grounded; i >= 0; i = segs[i].parent) chain.push(i);
    chain.reverse();
    this.mainPath = new Float64Array((chain.length + 1) * 3);
    this.mainCum = new Float64Array(chain.length + 1);
    const first = segs[chain[0]];
    this.mainPath[0] = first.ax; this.mainPath[1] = first.ay; this.mainPath[2] = first.az;
    let cum = 0;
    for (let k = 0; k < chain.length; k++) {
      const sg = segs[chain[k]];
      cum += sg.len;
      this.mainPath[(k + 1) * 3] = sg.bx; this.mainPath[(k + 1) * 3 + 1] = sg.by; this.mainPath[(k + 1) * 3 + 2] = sg.bz;
      this.mainCum[k + 1] = cum;
    }
    this.mainLen = Math.max(cum, 1e-6);
    this.strikeX = segs[grounded].bx;
    this.strikeZ = segs[grounded].bz;
    // distribute the channel slots over the tree, ∝ segment length, with a fine jitter
    let total = 0;
    for (const sg of segs) total += sg.len;
    this.maxBirth = 1;
    for (const sg of segs) this.maxBirth = Math.max(this.maxBirth, sg.birth + 1);
    const perLen = this.nChan / Math.max(total, 1e-6);
    let slot = 0;
    for (const sg of segs) {
      let want = sg.len * perLen;
      while (want > 0 && slot < this.nChan) {
        if (want < 1 && rng() > want) break;
        const u = rng();
        this.chanFinal[slot * 3] = sg.ax + (sg.bx - sg.ax) * u + (rng() - 0.5) * 0.006;
        this.chanFinal[slot * 3 + 1] = sg.ay + (sg.by - sg.ay) * u + (rng() - 0.5) * 0.006;
        this.chanFinal[slot * 3 + 2] = sg.az + (sg.bz - sg.az) * u + (rng() - 0.5) * 0.006;
        this.chanBirth[slot] = sg.birth + u;
        slot++;
        want -= 1;
      }
    }
    for (; slot < this.nChan; slot++) {
      // leftovers thicken the main channel core
      const f = rng();
      const [px, py, pz] = this.pointOnMain(f);
      this.chanFinal[slot * 3] = px + (rng() - 0.5) * 0.01;
      this.chanFinal[slot * 3 + 1] = py;
      this.chanFinal[slot * 3 + 2] = pz + (rng() - 0.5) * 0.01;
      this.chanBirth[slot] = f * this.maxBirth;
    }
  }

  // position at arc fraction g along the main channel, measured FROM THE GROUND (g=0 → strike point)
  private pointOnMain(g: number): [number, number, number] {
    const target = (1 - g) * this.mainLen; // cumulative length from the cloud end
    const cum = this.mainCum;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid; else hi = mid;
    }
    const span = Math.max(cum[hi] - cum[lo], 1e-9);
    const u = (target - cum[lo]) / span;
    const p = this.mainPath;
    return [
      p[lo * 3] + (p[hi * 3] - p[lo * 3]) * u,
      p[lo * 3 + 1] + (p[hi * 3 + 1] - p[lo * 3 + 1]) * u,
      p[lo * 3 + 2] + (p[hi * 3 + 2] - p[lo * 3 + 2]) * u,
    ];
  }

  private syncPositions(): void {
    const pos = this.positions;
    const growDur = 1.5, flashDur = 0.4, decayDur = 0.55; // seconds at speed 1 (dark pause lives in step())
    let off = 0;
    for (let i = 0; i < this.nGround; i++, off++) {
      pos[off * 3] = this.gndPos[i * 3]; pos[off * 3 + 1] = this.gndPos[i * 3 + 1]; pos[off * 3 + 2] = this.gndPos[i * 3 + 2];
    }
    for (let i = 0; i < this.nCloud; i++, off++) {
      pos[off * 3] = this.cldPos[i * 3]; pos[off * 3 + 1] = this.cldPos[i * 3 + 1]; pos[off * 3 + 2] = this.cldPos[i * 3 + 2];
    }
    // channel: reveal by birth order during GROW; full during FLASH; retract during DECAY; parked in DARK
    const reveal = this.phase === 0 ? (this.phaseT / growDur) * this.maxBirth : this.phase === 1 ? Infinity : 0;
    const retract = this.phase === 2 ? Math.min(1, this.phaseT / decayDur) : this.phase === 3 ? 1 : 0;
    for (let i = 0; i < this.nChan; i++, off++) {
      const born = this.chanBirth[i] <= reveal;
      let x: number, y: number, z: number;
      if (this.phase === 2) {
        const e = retract * retract; // ease-in retraction back to the cloud
        x = this.chanFinal[i * 3] + (this.chanPark[i * 3] - this.chanFinal[i * 3]) * e;
        y = this.chanFinal[i * 3 + 1] + (this.chanPark[i * 3 + 1] - this.chanFinal[i * 3 + 1]) * e;
        z = this.chanFinal[i * 3 + 2] + (this.chanPark[i * 3 + 2] - this.chanFinal[i * 3 + 2]) * e;
      } else if (born && this.phase !== 3) {
        x = this.chanFinal[i * 3]; y = this.chanFinal[i * 3 + 1]; z = this.chanFinal[i * 3 + 2];
      } else {
        x = this.chanPark[i * 3]; y = this.chanPark[i * 3 + 1]; z = this.chanPark[i * 3 + 2];
      }
      pos[off * 3] = x; pos[off * 3 + 1] = y; pos[off * 3 + 2] = z;
    }
    // flash pool: parked in the cloud until attachment; sweeps up the main channel during FLASH
    const flashProg = this.phase === 1 ? Math.min(1, this.phaseT / (flashDur * 0.45)) : 0; // stroke front races up
    for (let i = 0; i < this.nFlash; i++, off++) {
      let x: number, y: number, z: number;
      if (this.phase === 1) {
        const f = this.flashF[i];
        if (f <= flashProg) {
          const [px, py, pz] = this.pointOnMain(f);
          // per-frame crackle: cheap deterministic jitter that changes every frame
          const h1 = Math.sin(i * 12.9898 + this.frame * 78.233) * 43758.5453;
          const h2 = Math.sin(i * 39.346 + this.frame * 11.135) * 24634.6345;
          x = px + ((h1 - Math.floor(h1)) - 0.5) * 0.022;
          y = py;
          z = pz + ((h2 - Math.floor(h2)) - 0.5) * 0.022;
        } else {
          x = this.strikeX; y = GROUND_Y + 0.01; z = this.strikeZ; // pooled at the attachment point
        }
      } else if (this.phase === 2) {
        const e = Math.min(1, this.phaseT / (decayDur * 0.6));
        const f = this.flashF[i];
        const [px, py, pz] = this.pointOnMain(f);
        x = px + (this.flashPark[i * 3] - px) * e;
        y = py + (this.flashPark[i * 3 + 1] - py) * e;
        z = pz + (this.flashPark[i * 3 + 2] - pz) * e;
      } else {
        x = this.flashPark[i * 3]; y = this.flashPark[i * 3 + 1]; z = this.flashPark[i * 3 + 2];
      }
      pos[off * 3] = x; pos[off * 3 + 1] = y; pos[off * 3 + 2] = z;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.phaseT += dt * this.speed;
    this.frame++;
    const growDur = 1.5, flashDur = 0.4, decayDur = 0.55, darkDur = 0.3;
    const durs = [growDur, flashDur, decayDur, darkDur];
    while (this.phaseT >= durs[this.phase]) {
      this.phaseT -= durs[this.phase];
      this.phase = (this.phase + 1) % 4;
      if (this.phase === 0) {
        this.strike++;
        this.growTree(); // a fresh bolt, with the CURRENT branchiness/wander
      }
    }
    this.syncPositions();
  }

  readPositions(): Float32Array {
    return this.positions;
  }
  readColors(): Float32Array {
    return this.colors;
  }
  readState(): Float64Array {
    return new Float64Array([this.strike, this.phase, this.phaseT]);
  }
  loadState(s: Float64Array): void {
    this.strike = s[0] ?? 0;
    this.phase = s[1] ?? 0;
    this.phaseT = s[2] ?? 0;
    this.growTree();
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Lightning (dielectric breakdown)', stateOffset: 0, stateLength: 3 }];
  }
  renderHint(): RenderHint {
    return { geometry: 'points', pointSize: 0.008 };
  }
  dispose(): void {
    /* buffers GC with the instance */
  }
}

export const lightningFactory: ArchetypeFactory = {
  id: 'lightning',
  label: 'Lightning',
  category: 'Plasma',
  kind: 'flow',
  params: [
    { key: 'branchiness', label: 'branchiness', min: 0.02, max: 0.4, step: 0.01, default: 0.22 }, // side-branch probability (next strike)
    { key: 'wander', label: 'wander', min: 0.15, max: 1.2, step: 0.05, default: 0.7 }, // lateral randomness of the leader
    { key: 'speed', label: 'strike rate', min: 0.2, max: 3, step: 0.05, default: 1 }, // cycle speed
  ],
  defaultParticleCount: 60_000,
  particleCountOptions: [30_000, 60_000, 120_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the bolt IS the visual
  bloom: 0.55, // dark sky + white-hot return stroke → let it blaze
  create: (config) => new LightningArchetype(config),
};

import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Fly Brain Cascade — a whole-brain spiking network shaped like a Drosophila brain. The 2024 result
// that startled neuroscience (Shiu et al., Nature): take the complete fly connectome and drop the
// SIMPLEST neuron model there is — leaky integrate-and-fire — onto its wiring, with no tuning at all,
// and it predicts real behaviour: stimulate the sugar-taste neurons and the proboscis motor neurons
// fire, just as in a living fly. The wiring does the computing. We can't ship 50 million synapses,
// so this is the same experiment on a STATISTICAL connectome: neurons are laid out by neuropil
// (paired optic lobes, antennal lobes, mushroom bodies, lateral horns, the central complex, the
// subesophageal zone) and wired by the known pathways between them — antennal lobe → mushroom-body
// calyx & lateral horn, calyx → lobes, optic lobe → central brain — with log-normal synaptic weights
// and ~10% inhibitory cells, the statistics the real connectome shows. Every neuron is a leaky
// integrator; a spike launches packets of light down its axons, which arrive after a distance-
// dependent delay and depolarise their targets. Choose a sensory input, and watch the activity
// cascade through the brain. Bounded (membrane clamps, refractory period, adaptation).
const NEURON_FRAC = 0.25; // share of the particle budget that are neurons; the rest is the packet pool
const K_OUT = 20; // out-synapses per neuron
const D_SLOTS = 48; // synaptic delay line length (steps)
const PARK = -44; // idle packets park here, off-frame
const TAU = 11; // membrane time constant (steps)
const REFR = 3; // refractory period (steps)
const VIS_AXON = 8; // packets launched per spike (first 8 synapses) + 1 soma flash
const INHIB_FRAC = 0.1;
const PULSE_T = 170; // stimulus breathing period (steps)

// Neuropil layout — front view: x lateral, y dorsal (up), z anterior (toward the camera).
// `group` is the connectivity class; `side` ±1 for paired structures, 0 on the midline.
interface Neuropil {
  key: string; group: string; side: -1 | 0 | 1;
  c: [number, number, number]; r: [number, number, number];
  frac: number; color: [number, number, number];
}
const OL: [number, number, number] = [0.22, 0.42, 0.44]; // teal
const AL: [number, number, number] = [0.2, 0.46, 0.2]; // green
const MB: [number, number, number] = [0.5, 0.18, 0.4]; // rose
const LH: [number, number, number] = [0.5, 0.36, 0.12]; // amber
const CX: [number, number, number] = [0.55, 0.42, 0.1]; // gold
const SEZ: [number, number, number] = [0.3, 0.22, 0.55]; // violet
const HULL: [number, number, number] = [0.2, 0.22, 0.32]; // grey-blue
const NEUROPILS: Neuropil[] = [
  { key: 'OL_L', group: 'OL', side: -1, c: [-1.55, 0.05, -0.1], r: [0.55, 0.7, 0.55], frac: 0.21, color: OL },
  { key: 'OL_R', group: 'OL', side: 1, c: [1.55, 0.05, -0.1], r: [0.55, 0.7, 0.55], frac: 0.21, color: OL },
  { key: 'AL_L', group: 'AL', side: -1, c: [-0.42, -0.42, 0.55], r: [0.2, 0.2, 0.2], frac: 0.03, color: AL },
  { key: 'AL_R', group: 'AL', side: 1, c: [0.42, -0.42, 0.55], r: [0.2, 0.2, 0.2], frac: 0.03, color: AL },
  { key: 'CA_L', group: 'CA', side: -1, c: [-0.62, 0.42, -0.45], r: [0.2, 0.18, 0.18], frac: 0.05, color: MB },
  { key: 'CA_R', group: 'CA', side: 1, c: [0.62, 0.42, -0.45], r: [0.2, 0.18, 0.18], frac: 0.05, color: MB },
  { key: 'VL_L', group: 'MBL', side: -1, c: [-0.48, 0.55, 0.25], r: [0.08, 0.28, 0.08], frac: 0.015, color: MB },
  { key: 'VL_R', group: 'MBL', side: 1, c: [0.48, 0.55, 0.25], r: [0.08, 0.28, 0.08], frac: 0.015, color: MB },
  { key: 'ML_L', group: 'MBL', side: -1, c: [-0.28, 0.25, 0.3], r: [0.25, 0.08, 0.08], frac: 0.015, color: MB },
  { key: 'ML_R', group: 'MBL', side: 1, c: [0.28, 0.25, 0.3], r: [0.25, 0.08, 0.08], frac: 0.015, color: MB },
  { key: 'LH_L', group: 'LH', side: -1, c: [-0.9, 0.35, 0.15], r: [0.18, 0.16, 0.16], frac: 0.02, color: LH },
  { key: 'LH_R', group: 'LH', side: 1, c: [0.9, 0.35, 0.15], r: [0.18, 0.16, 0.16], frac: 0.02, color: LH },
  { key: 'FB', group: 'CX', side: 0, c: [0, 0.2, -0.05], r: [0.42, 0.16, 0.14], frac: 0.04, color: CX },
  { key: 'EB', group: 'CX', side: 0, c: [0, 0.05, 0.25], r: [0.16, 0.16, 0.08], frac: 0.015, color: CX },
  { key: 'PB', group: 'CX', side: 0, c: [0, 0.48, -0.35], r: [0.5, 0.06, 0.06], frac: 0.015, color: CX },
  { key: 'SEZ', group: 'SEZ', side: 0, c: [0, -0.8, 0.15], r: [0.42, 0.3, 0.28], frac: 0.06, color: SEZ },
  { key: 'HULL', group: 'HULL', side: 0, c: [0, 0.05, 0], r: [1.0, 0.65, 0.55], frac: 0, color: HULL }, // gets the remainder
];
// Pathway table: for each source group, where its axons go (relative weights). Paired targets go
// ipsilateral 85% of the time. These are the textbook fly pathways, not measured counts.
const PATHWAYS: Record<string, Array<[string, number]>> = {
  OL: [['OL', 0.72], ['LH', 0.05], ['CX', 0.05], ['HULL', 0.15], ['OLX', 0.03]],
  AL: [['AL', 0.35], ['CA', 0.3], ['LH', 0.3], ['HULL', 0.05]],
  CA: [['MBL', 0.8], ['CA', 0.1], ['HULL', 0.1]],
  MBL: [['HULL', 0.4], ['LH', 0.2], ['CX', 0.15], ['MBL', 0.15], ['SEZ', 0.1]],
  LH: [['HULL', 0.5], ['LH', 0.2], ['CX', 0.15], ['SEZ', 0.15]],
  CX: [['CX', 0.6], ['HULL', 0.3], ['SEZ', 0.1]],
  SEZ: [['SEZ', 0.5], ['HULL', 0.3], ['CX', 0.1], ['AL', 0.1]],
  HULL: [['HULL', 0.5], ['CX', 0.15], ['SEZ', 0.1], ['MBL', 0.05], ['LH', 0.05], ['OL', 0.05], ['AL', 0.05], ['CA', 0.05]],
};
const STIM_GROUP = ['AL', 'OL', 'SEZ', '']; // stimulus option → target group ('' = spontaneous only)

class FlyBrainArchetype implements Archetype {
  readonly id = 'flyBrain';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly N: number; // neurons
  private readonly M: number; // packet pool
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // structure
  private readonly nx: Float32Array; private readonly ny: Float32Array; private readonly nz: Float32Array;
  private readonly group: Uint8Array; // neuropil index per neuron
  private readonly inhib: Uint8Array;
  private readonly synTarget: Int32Array; // N*K_OUT
  private readonly synWeight: Float32Array;
  private readonly synDelay: Uint8Array;
  private readonly rangeStart: Int32Array; private readonly rangeLen: Int32Array; // per neuropil
  // dynamics
  private readonly v: Float64Array; private readonly adapt: Float64Array;
  private readonly refr: Uint8Array;
  private readonly delayLine: Float32Array; // D_SLOTS * N
  private slot = 0;
  private t = 0;
  private readonly rng: () => number;
  private readonly stateBuf: Float64Array;
  // packets
  private readonly pkSrc: Int32Array; private readonly pkDst: Int32Array;
  private readonly pkT0: Float32Array; private readonly pkDur: Float32Array;
  private readonly exStart = 0; private readonly exLen: number; private exCur = 0;
  private readonly inStart: number; private readonly inLen: number; private inCur = 0;
  // params
  private stimulus = 0; private drive = 1; private gain = 1; private balance = 1; private rate = 1;
  private spikeCount = 0;
  readonly spikesByGroup = new Int32Array(NEUROPILS.length); // per-neuropil spike count this step

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    const N = Math.max(64, Math.round(P * NEURON_FRAC));
    const M = P - N;
    this.N = N; this.M = M;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    this.nx = new Float32Array(N); this.ny = new Float32Array(N); this.nz = new Float32Array(N);
    this.group = new Uint8Array(N);
    this.inhib = new Uint8Array(N);
    this.synTarget = new Int32Array(N * K_OUT);
    this.synWeight = new Float32Array(N * K_OUT);
    this.synDelay = new Uint8Array(N * K_OUT);
    this.v = new Float64Array(N); this.adapt = new Float64Array(N);
    this.refr = new Uint8Array(N);
    this.delayLine = new Float32Array(D_SLOTS * N);
    this.stateBuf = new Float64Array(2 * N + 1);
    this.pkSrc = new Int32Array(M); this.pkDst = new Int32Array(M);
    this.pkT0 = new Float32Array(M).fill(-1e9); this.pkDur = new Float32Array(M).fill(1);
    this.inLen = Math.max(1, Math.floor(M * 0.12)); this.exLen = M - this.inLen; this.inStart = this.exLen;
    const rng = mulberry32(config.seed);
    this.rng = rng;

    // --- allocate neurons to neuropils (contiguous ranges; every neuropil gets at least one) ---
    const G = NEUROPILS.length;
    this.rangeStart = new Int32Array(G); this.rangeLen = new Int32Array(G);
    let used = 0;
    for (let g = 0; g < G - 1; g++) { this.rangeLen[g] = Math.max(1, Math.floor(NEUROPILS[g].frac * N)); used += this.rangeLen[g]; }
    this.rangeLen[G - 1] = Math.max(1, N - used);
    // if rounding overflowed N on tiny networks, trim the largest ranges
    let total = 0; for (let g = 0; g < G; g++) total += this.rangeLen[g];
    while (total > N) { let big = 0; for (let g = 1; g < G; g++) if (this.rangeLen[g] > this.rangeLen[big]) big = g; this.rangeLen[big]--; total--; }
    let acc = 0;
    for (let g = 0; g < G; g++) { this.rangeStart[g] = acc; acc += this.rangeLen[g]; }
    for (let g = 0; g < G; g++) {
      const np = NEUROPILS[g];
      for (let k = 0; k < this.rangeLen[g]; k++) {
        const i = this.rangeStart[g] + k;
        // uniform in the ellipsoid
        let x = 0, y = 0, z = 0, l = 0;
        do { x = rng() * 2 - 1; y = rng() * 2 - 1; z = rng() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-6);
        this.nx[i] = np.c[0] + x * np.r[0];
        this.ny[i] = np.c[1] + y * np.r[1];
        this.nz[i] = np.c[2] + z * np.r[2];
        this.group[i] = g;
        this.inhib[i] = rng() < INHIB_FRAC ? 1 : 0;
        // structural colour: the dim ghost of the brain, tinted by neuropil
        const o = i * 3;
        this.colors[o] = np.color[0] * 0.55; this.colors[o + 1] = np.color[1] * 0.55; this.colors[o + 2] = np.color[2] * 0.55;
      }
    }
    // --- wire the synapses by pathway ---
    const groupIdx = new Map<string, number[]>(); // connectivity group → neuropil indices (by side)
    for (let g = 0; g < G; g++) { const arr = groupIdx.get(NEUROPILS[g].group) ?? []; arr.push(g); groupIdx.set(NEUROPILS[g].group, arr); }
    const pickNeuropil = (targetGroup: string, side: number): number => {
      let grp = targetGroup, wantSide = side;
      if (grp === 'OLX') { grp = 'OL'; wantSide = -side; } // contralateral optic lobe
      const cands = groupIdx.get(grp)!;
      if (cands.length === 1) return cands[0];
      // paired: ipsilateral 85%
      const s = side === 0 ? (rng() < 0.5 ? -1 : 1) : (rng() < 0.85 ? wantSide : -wantSide);
      const sameSide = cands.filter((g) => NEUROPILS[g].side === s);
      const pool = sameSide.length ? sameSide : cands;
      return pool[Math.floor(rng() * pool.length)];
    };
    for (let i = 0; i < N; i++) {
      const gi = this.group[i];
      const paths = PATHWAYS[NEUROPILS[gi].group];
      for (let k = 0; k < K_OUT; k++) {
        // choose a target group by weight
        let u = rng(); let tg = paths[paths.length - 1][0];
        for (const [name, w] of paths) { u -= w; if (u <= 0) { tg = name; break; } }
        const g = pickNeuropil(tg, NEUROPILS[gi].side);
        const j = this.rangeStart[g] + Math.floor(rng() * this.rangeLen[g]);
        const s = i * K_OUT + k;
        this.synTarget[s] = j;
        // log-normal weight, mean 1 (σ=1: a heavy tail of strong synapses, as measured)
        const gauss = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-9))) * Math.cos(6.283185307 * rng());
        this.synWeight[s] = Math.exp(gauss - 0.5);
        const dx = this.nx[j] - this.nx[i], dy = this.ny[j] - this.ny[i], dz = this.nz[j] - this.nz[i];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        this.synDelay[s] = Math.min(D_SLOTS - 1, Math.max(2, Math.round(3 + dist * 9)));
      }
    }
    // packet pool colours: excitatory = warm ember-white, inhibitory = cold blue
    for (let m = 0; m < M; m++) {
      const o = (N + m) * 3;
      if (m < this.exLen) { this.colors[o] = 3.2; this.colors[o + 1] = 2.2; this.colors[o + 2] = 1.1; }
      else { this.colors[o] = 0.9; this.colors[o + 1] = 1.6; this.colors[o + 2] = 3.2; }
    }
    // resting membrane: a spread of initial potentials so the first stimulus doesn't fire in lockstep
    for (let i = 0; i < N; i++) this.v[i] = rng() * 0.5;
    this.readParams(config.params);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.stimulus = Math.round(p.stimulus ?? 0);
    this.drive = p.drive ?? 1;
    this.gain = p.gain ?? 1;
    this.balance = p.balance ?? 1;
    this.rate = Math.max(1, Math.round(p.rate ?? 1));
  }

  private launch(src: number, dst: number, dur: number, inhib: boolean): void {
    let m: number;
    if (inhib) { m = this.inStart + this.inCur; this.inCur = (this.inCur + 1) % this.inLen; }
    else { m = this.exStart + this.exCur; this.exCur = (this.exCur + 1) % this.exLen; }
    this.pkSrc[m] = src; this.pkDst[m] = dst; this.pkT0[m] = this.t; this.pkDur[m] = dur;
  }

  private advance(): void {
    const N = this.N, v = this.v, a = this.adapt, refr = this.refr, rng = this.rng;
    const decay = Math.exp(-1 / TAU);
    const line = this.delayLine, slot = this.slot, base = slot * N;
    // gain 1 sits just below the cascade's critical point (measured: ~1.6× is the seizure edge)
    const wE = 0.34 * this.gain, wI = 0.34 * this.gain * this.balance * 2.2;
    // stimulus: a breathing Poisson drive into the chosen sensory neuropil(s)
    const stimGroup = STIM_GROUP[this.stimulus] ?? '';
    const pulse = 0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(6.283185307 * this.t / PULSE_T)), 2);
    const pStim = 0.08 * this.drive * pulse;
    let spikes = 0;
    this.spikesByGroup.fill(0);
    for (let i = 0; i < N; i++) {
      // synaptic input arriving now (consume the slot)
      let I = line[base + i]; line[base + i] = 0;
      // background spontaneous noise
      if (rng() < 0.0025) I += 0.45;
      const gi = this.group[i];
      if (stimGroup !== '' && NEUROPILS[gi].group === stimGroup && rng() < pStim) I += 0.6;
      let vi = v[i] * decay + I - a[i] * 0.3;
      a[i] *= 0.96;
      if (refr[i] > 0) { refr[i]--; vi = Math.min(vi, 0.3); }
      else if (vi >= 1) {
        // spike: reset, refractory, adapt, and deliver to targets down the delay line
        vi = 0; refr[i] = REFR; a[i] += 1; spikes++; this.spikesByGroup[gi]++;
        const inh = this.inhib[i] === 1;
        const w = inh ? -wI : wE;
        const s0 = i * K_OUT;
        for (let k = 0; k < K_OUT; k++) {
          const s = s0 + k;
          const j = this.synTarget[s];
          const d = this.synDelay[s];
          line[((slot + d) % D_SLOTS) * N + j] += w * this.synWeight[s];
          if (k < VIS_AXON) this.launch(i, j, d, inh);
        }
        this.launch(i, i, 10, inh); // soma flash
      }
      v[i] = vi < -3 ? -3 : vi > 3 ? 3 : vi;
    }
    this.spikeCount = spikes;
    this.slot = (slot + 1) % D_SLOTS;
    this.t += 1;
  }

  private syncPositions(): void {
    const pos = this.positions, N = this.N, M = this.M, t = this.t;
    for (let i = 0; i < N; i++) { const o = i * 3; pos[o] = this.nx[i]; pos[o + 1] = this.ny[i]; pos[o + 2] = this.nz[i]; }
    for (let m = 0; m < M; m++) {
      const o = (N + m) * 3;
      const u = (t - this.pkT0[m]) / this.pkDur[m];
      if (u < 0 || u >= 1) { pos[o] = 0; pos[o + 1] = PARK; pos[o + 2] = 0; continue; }
      const s = this.pkSrc[m], d = this.pkDst[m];
      const e = u * u * (3 - 2 * u); // ease along the axon
      pos[o] = this.nx[s] + (this.nx[d] - this.nx[s]) * e;
      pos[o + 1] = this.ny[s] + (this.ny[d] - this.ny[s]) * e;
      pos[o + 2] = this.nz[s] + (this.nz[d] - this.nz[s]) * e;
    }
  }

  step(_dt: number, p: ResolvedParams): void {
    this.readParams(p);
    for (let r = 0; r < this.rate; r++) this.advance();
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array {
    const N = this.N, s = this.stateBuf;
    s.set(this.v, 0); s.set(this.adapt, N); s[2 * N] = this.t;
    return s;
  }
  loadState(s: Float64Array): void {
    const N = this.N;
    if (s.length >= 2 * N + 1) { this.v.set(s.subarray(0, N)); this.adapt.set(s.subarray(N, 2 * N)); this.t = s[2 * N]; }
    this.delayLine.fill(0); this.pkT0.fill(-1e9);
    this.syncPositions();
  }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `fly brain · ${this.N} LIF neurons · ${this.N * K_OUT} synapses`, stateOffset: 0, stateLength: 2 * this.N + 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.006 }; }
  dispose(): void { /* buffers GC with the instance */ }
  // diagnostics (tuning script)
  get lastSpikes(): number { return this.spikeCount; }
  get neuronCount(): number { return this.N; }
}

export const flyBrainFactory: ArchetypeFactory = {
  id: 'flyBrain',
  label: 'Fly Brain Cascade',
  category: 'Neural',
  kind: 'flow',
  params: [
    { key: 'stimulus', label: 'stimulus', min: 0, max: 3, step: 1, default: 0, options: { 'olfactory (antennal lobes)': 0, 'visual (optic lobes)': 1, 'taste (subesophageal)': 2, 'spontaneous only': 3 } },
    { key: 'drive', label: 'drive', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'gain', label: 'synaptic gain', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'balance', label: 'inhibition', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'rate', label: 'steps / frame', min: 1, max: 4, step: 1, default: 1 },
  ],
  defaultParticleCount: 240_000,
  particleCountOptions: [120_000, 240_000, 360_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.6,
  create: (config) => new FlyBrainArchetype(config),
};

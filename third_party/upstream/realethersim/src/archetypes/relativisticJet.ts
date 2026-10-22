import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { mulberry32 } from '../state/rng';

// Relativistic Jet. Accreting black holes don't only swallow — they launch: twin beams of plasma
// collimated by twisted magnetic fields, fired along the spin axis at nearly the speed of light
// (M87's jet, imaged by Hubble and the EHT, reaches thousands of light-years). Two real features
// give jets their look, and both are here honestly. (1) HELICAL FIELD: the rotation of the disk and
// hole winds the magnetic field into a spiral around the jet spine — plasma streams along those
// helical field strands. (2) THE KINK INSTABILITY: a current-carrying magnetized column is unstable
// to a helical (m=1) displacement whose amplitude GROWS downstream — the whole jet wiggles like a
// firehose, exactly the wobble seen in real jet simulations and in M87. Add bright KNOTS — blobs of
// plasma (internal shocks, like M87's HST-1) racing outward — and a white-hot central engine.
// Colours bake once (inferno palette: white spine → orange → purple sheath); every motion is an
// analytic phase along the strands. Bounded (fixed jet length; streams phase-cycle).
const JL = 1.9; // jet half-length along ±x
const TAU = Math.PI * 2;

class RelativisticJetArchetype implements Archetype {
  readonly id = 'relativisticJet';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private nCore = 0;
  private nStrand = 0;
  private nKnot = 0;
  private coreL: Float64Array = new Float64Array(0);
  private stSide: Float64Array = new Float64Array(0); // ±1: which jet
  private stF: Float64Array = new Float64Array(0); // baked axial phase (streams via +t)
  private stPhi: Float64Array = new Float64Array(0); // strand azimuth
  private stR: Float64Array = new Float64Array(0); // strand radius class 0..1 (0 = spine, 1 = sheath)
  private knSide: Float64Array = new Float64Array(0);
  private knGroup: Float64Array = new Float64Array(0); // which knot this point belongs to
  private knOff: Float64Array = new Float64Array(0); // gaussian offset within the knot (x,y,z)
  private kink = 0.55;
  private twist = 1.4;
  private speed = 1;
  private t = 0;
  private readonly seed: number;

  constructor(config: ArchetypeConfig) {
    const N = Math.max(64, config.particleCount);
    this.particleCount = N;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.seed = config.seed;
    const rng = mulberry32((this.seed ^ 0x38d01377) >>> 0);
    this.nCore = Math.floor(N * 0.05);
    this.nKnot = Math.floor(N * 0.12);
    this.nStrand = N - this.nCore - this.nKnot;
    this.coreL = new Float64Array(this.nCore * 3);
    this.stSide = new Float64Array(this.nStrand);
    this.stF = new Float64Array(this.nStrand);
    this.stPhi = new Float64Array(this.nStrand);
    this.stR = new Float64Array(this.nStrand);
    this.knSide = new Float64Array(this.nKnot);
    this.knGroup = new Float64Array(this.nKnot);
    this.knOff = new Float64Array(this.nKnot * 3);
    const col = this.colors;
    let o = 0;
    // ── central engine: a tiny white-hot accretion blob ──
    for (let i = 0; i < this.nCore; i++) {
      const u = rng() * 2 - 1, az = rng() * TAU;
      const sr = Math.sqrt(Math.max(0, 1 - u * u));
      const r = 0.07 * Math.cbrt(rng());
      this.coreL[i * 3] = r * sr * Math.cos(az) * 1.6; // slightly flattened disk-ish blob
      this.coreL[i * 3 + 1] = r * u * 0.6;
      this.coreL[i * 3 + 2] = r * sr * Math.sin(az) * 1.6;
      const v = 1.2 + 0.6 * rng();
      col[o * 3] = v * 1.05; col[o * 3 + 1] = v * 0.85; col[o * 3 + 2] = v * 0.6;
      o++;
    }
    // ── helical strands: plasma threaded on the wound-up field, spine hot → sheath purple ──
    for (let i = 0; i < this.nStrand; i++) {
      this.stSide[i] = i % 2 === 0 ? 1 : -1;
      this.stF[i] = rng();
      this.stPhi[i] = rng() * TAU;
      const rc = Math.pow(rng(), 1.05); // spine-weighted, but with a real sheath population
      this.stR[i] = rc;
      // inferno: white-yellow spine → orange mid → purple sheath (matches synchrotron-map palettes)
      const v = 1 - 0.2 * rc;
      const r0 = (1.05 - 0.35 * rc) * v;
      const g0 = (0.75 - 0.62 * rc) * v;
      const b0 = (0.2 + 0.95 * rc) * v; // sheath goes properly violet
      const bri = 0.75 + 0.65 * rng();
      col[o * 3] = r0 * bri; col[o * 3 + 1] = Math.max(0.05, g0) * bri; col[o * 3 + 2] = b0 * bri;
      o++;
    }
    // ── knots: bright shock blobs racing down each jet (M87's HST-1 and friends) ──
    for (let i = 0; i < this.nKnot; i++) {
      this.knSide[i] = i % 2 === 0 ? 1 : -1;
      this.knGroup[i] = Math.floor(rng() * 4) / 4; // 4 knots per jet, staggered quarters
      const u = rng() * 2 - 1, az = rng() * TAU;
      const sr = Math.sqrt(Math.max(0, 1 - u * u));
      const r = 0.075 * Math.cbrt(rng());
      this.knOff[i * 3] = r * sr * Math.cos(az) * 1.5; // slightly elongated along the jet
      this.knOff[i * 3 + 1] = r * u;
      this.knOff[i * 3 + 2] = r * sr * Math.sin(az);
      const v = 1.1 + 0.6 * rng();
      col[o * 3] = v * 1.05; col[o * 3 + 1] = v * 0.95; col[o * 3 + 2] = v * 0.8; // white-hot knots
      o++;
    }
    this.readParams(config.params);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.kink = p.kink ?? 0.55;
    this.twist = p.twist ?? 1.4;
    this.speed = p.speed ?? 1;
  }

  // helical kink displacement of the jet AXIS at axial distance a (0..1), growing downstream
  private kinkOff(a: number, side: number, t: number): [number, number] {
    const amp = this.kink * 0.34 * Math.pow(a, 1.5);
    const ph = a * JL * 3.1 - t * 0.9 * this.speed + (side > 0 ? 0 : 2.1); // the wave rides outward
    return [amp * Math.cos(ph), amp * Math.sin(ph)];
  }

  private syncPositions(): void {
    const pos = this.positions;
    const t = this.t;
    let o = 0;
    for (let i = 0; i < this.nCore; i++, o++) {
      pos[o * 3] = this.coreL[i * 3]; pos[o * 3 + 1] = this.coreL[i * 3 + 1]; pos[o * 3 + 2] = this.coreL[i * 3 + 2];
    }
    // strands: stream outward along the kinked axis, wound into a helix that opens downstream
    for (let i = 0; i < this.nStrand; i++, o++) {
      const side = this.stSide[i];
      const a = (this.stF[i] + t * 0.11 * this.speed) % 1; // axial fraction (streams)
      const x = side * (0.08 + a * JL);
      const [ky, kz] = this.kinkOff(a, side, t);
      const rh = (0.04 + 0.24 * a) * (0.3 + 0.95 * this.stR[i]); // helix radius opens downstream (full-bodied)
      const hph = this.stPhi[i] + side * (this.twist * (0.08 + a * JL) * 3.2) + t * 0.7 * this.speed;
      pos[o * 3] = x;
      pos[o * 3 + 1] = ky + rh * Math.cos(hph);
      pos[o * 3 + 2] = kz + rh * Math.sin(hph);
    }
    // knots: coherent blobs riding the same kinked axis, faster than the strand drift
    for (let i = 0; i < this.nKnot; i++, o++) {
      const side = this.knSide[i];
      const a = (this.knGroup[i] + t * 0.16 * this.speed) % 1;
      const x = side * (0.08 + a * JL);
      const [ky, kz] = this.kinkOff(a, side, t);
      const swell = 1 + 0.8 * a; // knots expand as they travel out
      pos[o * 3] = x + this.knOff[i * 3] * swell;
      pos[o * 3 + 1] = ky + this.knOff[i * 3 + 1] * swell;
      pos[o * 3 + 2] = kz + this.knOff[i * 3 + 2] * swell;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: 'Relativistic jet (kink instability)', stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.0075 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const relativisticJetFactory: ArchetypeFactory = {
  id: 'relativisticJet',
  label: 'Relativistic Jet',
  category: 'Plasma',
  kind: 'flow',
  params: [
    { key: 'kink', label: 'kink', min: 0, max: 1.5, step: 0.05, default: 0.55 }, // m=1 instability amplitude
    { key: 'twist', label: 'field twist', min: 0.2, max: 3, step: 0.05, default: 1.4 }, // helical winding
    { key: 'speed', label: 'flow speed', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 90_000,
  particleCountOptions: [40_000, 90_000, 160_000],
  defaultDt: 0.016,
  defaultTrail: 0, // the streaming helical jet IS the visual
  create: (config) => new RelativisticJetArchetype(config),
};

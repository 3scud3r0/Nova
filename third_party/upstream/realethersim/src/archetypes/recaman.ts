import type {
  Archetype,
  ArchetypeConfig,
  ArchetypeFactory,
  NodeSpec,
  RenderHint,
  ResolvedParams,
} from '../core/archetype';
import { hslToRgb } from '../core/color';

// Recamán Arcs — a sequence with a one-line rule that draws a cathedral. Start at 0. On step n, jump
// BACKWARD by n if that lands on a positive number you haven't visited; otherwise jump FORWARD by n.
// (Bernardo Recamán Santos, 1991; OEIS A005132.) It begins 0, 1, 3, 6, 2, 7, 13, 20, 12, 21, 11, 22, …
// The classic way to see it — popularised by Numberphile — is an ARC DIAGRAM: lay the numbers on a line
// and draw each jump as a semicircle, alternating above and below the line. Backward jumps nest inside
// forward ones, and the picture fills with interlocking arches whose rhythm nobody can predict: it is
// conjectured (unproven) that every positive integer is eventually visited. Arcs are coloured by step
// (blue → magenta → gold), and a slow ripple runs through them in the order they were jumped, each arch
// swelling as the wave passes, so you can read the sequence's order in the finished picture. The arcs below
// the line are tilted out of the plane so the diagram has depth when you orbit it.
const HALF_W = 2.5; // half-width of the number line in render units

export function recamanSequence(steps: number): number[] {
  const a = [0];
  const seen = new Set<number>([0]);
  for (let n = 1; n <= steps; n++) {
    const prev = a[n - 1];
    const back = prev - n;
    const next = back > 0 && !seen.has(back) ? back : prev + n;
    a.push(next);
    seen.add(next);
  }
  return a;
}

class RecamanArchetype implements Archetype {
  readonly id = 'recaman';
  readonly kind = 'flow' as const;
  readonly particleCount: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly S: number;
  private readonly cx: Float32Array; private readonly rad: Float32Array; private readonly dir: Int8Array; // arc centre, radius, sweep direction
  private readonly side: Int8Array; // +1 above the line, −1 below
  private readonly arcOf: Int32Array; private readonly uOf: Float32Array; // point → (arc, fraction along it)
  private tilt = 0.5;
  private wave = 0.25;
  private speed = 1;
  private t = 0;

  constructor(config: ArchetypeConfig) {
    const P = config.particleCount;
    this.particleCount = P;
    this.positions = new Float32Array(P * 3);
    this.colors = new Float32Array(P * 3);
    const S = Math.max(8, Math.round(config.params.steps ?? 64));
    this.S = S;
    const seq = recamanSequence(S);
    const maxA = Math.max(...seq);
    const sc = (2 * HALF_W) / maxA;
    const X = (v: number): number => v * sc - HALF_W;

    this.cx = new Float32Array(S); this.rad = new Float32Array(S); this.dir = new Int8Array(S); this.side = new Int8Array(S);
    let Ltot = 0;
    for (let k = 0; k < S; k++) {
      const a = X(seq[k]), b = X(seq[k + 1]);
      this.cx[k] = (a + b) / 2;
      this.rad[k] = Math.abs(b - a) / 2;
      this.dir[k] = b > a ? 1 : -1;
      this.side[k] = k % 2 === 0 ? 1 : -1;
      Ltot += Math.PI * this.rad[k];
    }
    this.arcOf = new Int32Array(P); this.uOf = new Float32Array(P);
    let p = 0;
    for (let k = 0; k < S && p < P; k++) {
      const n = k === S - 1 ? P - p : Math.max(8, Math.round((P * Math.PI * this.rad[k]) / Ltot));
      hslToRgb((0.6 + (0.52 * k) / Math.max(1, S - 1)) % 1, 0.85, 0.56, this.colors, p * 3); // blue → magenta → gold
      const r = this.colors[p * 3], g = this.colors[p * 3 + 1], b = this.colors[p * 3 + 2];
      for (let s = 0; s < n && p < P; s++, p++) {
        this.arcOf[p] = k; this.uOf[p] = n > 1 ? s / (n - 1) : 0;
        this.colors[p * 3] = r; this.colors[p * 3 + 1] = g; this.colors[p * 3 + 2] = b;
      }
    }
    this.readParams(config.params);
    this.syncPositions();
  }

  private readParams(p: ResolvedParams): void {
    this.tilt = p.tilt ?? 0.5;
    this.wave = p.wave ?? 0.25;
    this.speed = p.speed ?? 1;
  }

  private syncPositions(): void {
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    // the ripple: a bump travelling along the step index, ~one pass every 10 s (scaled by speed)
    const front = ((this.t / 10) % 1) * (this.S + 16) - 8;
    const pos = this.positions;
    for (let p = 0; p < this.particleCount; p++) {
      const k = this.arcOf[p], u = this.uOf[p];
      const d = k - front;
      const swell = 1 + this.wave * Math.exp(-(d * d) / 18);
      // the arc runs from its start (angle π or 0) over the top (or bottom) to its end
      const startAng = this.dir[k] > 0 ? Math.PI : 0;
      const ang = startAng - this.dir[k] * Math.PI * u;
      const x = this.cx[k] + this.rad[k] * Math.cos(ang);
      const h = this.rad[k] * Math.sin(Math.PI * u) * this.side[k] * swell; // height off the line
      // above-arcs stand in the plane; below-arcs lean out of it by the tilt angle
      const o = p * 3;
      pos[o] = x;
      pos[o + 1] = h >= 0 ? h : h * ct;
      pos[o + 2] = h >= 0 ? 0 : -h * st;
    }
  }

  step(dt: number, p: ResolvedParams): void {
    this.readParams(p);
    this.t += dt * this.speed;
    this.syncPositions();
  }

  readPositions(): Float32Array { return this.positions; }
  readColors(): Float32Array { return this.colors; }
  readState(): Float64Array { return new Float64Array([this.t]); }
  loadState(s: Float64Array): void { this.t = s[0] ?? 0; this.syncPositions(); }
  getHierarchy(): NodeSpec[] {
    return [{ id: 'root', parentId: null, label: `Recamán's sequence, ${this.S} steps`, stateOffset: 0, stateLength: 1 }];
  }
  renderHint(): RenderHint { return { geometry: 'points', pointSize: 0.005 }; }
  dispose(): void { /* buffers GC with the instance */ }
}

export const recamanFactory: ArchetypeFactory = {
  id: 'recaman',
  label: 'Recamán Arcs',
  category: 'Number',
  kind: 'flow',
  params: [
    { key: 'steps', label: 'steps', min: 12, max: 200, step: 1, default: 64, rebuild: true },
    { key: 'wave', label: 'ripple', min: 0, max: 0.8, step: 0.01, default: 0.25 },
    { key: 'tilt', label: 'tilt of the lower arcs', min: 0, max: 1.57, step: 0.01, default: 0.5 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  defaultParticleCount: 140_000,
  particleCountOptions: [60_000, 140_000, 220_000],
  defaultDt: 0.016,
  defaultTrail: 0,
  bloom: 0.45,
  create: (config) => new RecamanArchetype(config),
};

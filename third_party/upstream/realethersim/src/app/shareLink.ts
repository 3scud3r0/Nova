import type { Snapshot } from '../state/schema';
import { defaultParams } from '../core/archetype';
import { getFactory } from '../core/registry';
import { $archetypeId, $engine, $global, $params, selectArchetype } from '../ui/store';

// Deep-linkable share state. A shared PNG embeds the full snapshot, but social platforms strip
// that metadata — so we also encode the *settings* (system id, params, dt, particle count, trail,
// camera) into the URL. Opening the link reconstructs the same view without any server round-trip.
//
// Two forms:
//   ?s=<base64url>   full settings (what the Share button generates)
//   ?sim=<id>        human-friendly id-only ("just load this system with its defaults")
//
// Only the fields importSnapshot actually consumes are carried — no heavy live state — so the
// payload stays small enough to always fit in a URL.

interface SharePayload {
  v: 1;
  id: string;
  p: Record<string, number>; // archetype params
  dt: number;
  n: number; // particle count
  tl: number; // trail length
  cam: number[]; // [posX, posY, posZ, targetX, targetY, targetZ]
}

export interface ParsedShareState {
  id: string;
  p?: Record<string, number>;
  dt?: number;
  n?: number;
  tl?: number;
  cam?: number[];
}

function b64urlEncode(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Encode a snapshot's settings into the compact base64url payload used by `?s=`.
export function encodeShareState(snap: Snapshot): string {
  const r4 = (x: number): number => Math.round(x * 1e4) / 1e4; // trim camera floats to keep it short
  const payload: SharePayload = {
    v: 1,
    id: snap.archetypeId,
    p: snap.archetypeParams,
    dt: snap.global.dt,
    n: snap.particleCount,
    tl: snap.global.trailLength ?? 0,
    cam: [...snap.camera.position.map(r4), ...snap.camera.target.map(r4)],
  };
  return b64urlEncode(JSON.stringify(payload));
}

// Build a full shareable URL to the *currently running app* (index.html in prod, / in dev), with
// the snapshot's settings encoded. location.pathname excludes any existing query, so the base is clean.
export function buildShareUrl(snap: Snapshot): string {
  return `${location.origin}${location.pathname}?s=${encodeShareState(snap)}`;
}

// Parse a URL's `?s=` / `?sim=` into share state. Pure (takes the URL string) so it's unit-testable.
// Returns null for absent/malformed links — callers fall back to the default system.
export function parseShareUrl(url: string): ParsedShareState | null {
  try {
    const q = new URL(url).searchParams;
    const s = q.get('s');
    if (s) {
      const obj = JSON.parse(b64urlDecode(s)) as Partial<SharePayload>;
      if (!obj || obj.v !== 1 || typeof obj.id !== 'string') return null;
      const p = obj.p && typeof obj.p === 'object' ? (obj.p as Record<string, number>) : undefined;
      const cam = Array.isArray(obj.cam) && obj.cam.length === 6 && obj.cam.every((x) => Number.isFinite(x)) ? obj.cam : undefined;
      return {
        id: obj.id,
        p,
        dt: typeof obj.dt === 'number' ? obj.dt : undefined,
        n: typeof obj.n === 'number' ? obj.n : undefined,
        tl: typeof obj.tl === 'number' ? obj.tl : undefined,
        cam,
      };
    }
    const sim = q.get('sim');
    if (sim) return { id: sim };
    return null;
  } catch {
    return null; // malformed base64 / JSON / URL → ignore, keep the default system
  }
}

// Keep only params that the target system actually defines and that are finite numbers.
function sanitizeParams(raw: Record<string, number>, spec: ReturnType<typeof getFactory>['params']): Record<string, number> {
  const known = new Set(spec.map((s) => s.key));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (known.has(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

// Read the current page URL and, if it carries a share link, load that system + settings. Called
// once at startup BEFORE the engine boots (so it starts on the right system — no default-sim flash).
// Camera is applied a beat later, once the engine exists.
export function applyUrlState(): void {
  const parsed = parseShareUrl(location.href);
  if (!parsed) return;

  let factory: ReturnType<typeof getFactory>;
  try {
    factory = getFactory(parsed.id); // unknown / renamed system → bail, keep default
  } catch {
    return;
  }

  // Adopt the system (this resets to its defaults), then overlay the shared settings.
  selectArchetype(parsed.id);
  $archetypeId.set(parsed.id); // selectArchetype no-ops if already current; force-set to be safe
  if (parsed.p) $params.set({ ...defaultParams(factory.params), ...sanitizeParams(parsed.p, factory.params) });
  if (typeof parsed.dt === 'number' && parsed.dt > 0) $global.setKey('dt', parsed.dt);
  if (typeof parsed.n === 'number' && parsed.n > 0) $global.setKey('particleCount', Math.round(parsed.n));
  if (typeof parsed.tl === 'number' && parsed.tl >= 0) $global.setKey('trailLength', Math.round(parsed.tl));

  // Camera needs the engine; apply it once $engine is set, then stop listening.
  const cam = parsed.cam;
  if (cam && cam.length === 6) {
    const unsub = $engine.subscribe((e) => {
      if (!e) return;
      e.setCamera([cam[0], cam[1], cam[2]], [cam[3], cam[4], cam[5]]);
      unsub();
    });
  }
}

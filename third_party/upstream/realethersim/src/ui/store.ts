import { atom, map } from 'nanostores';
import type { Engine } from '../app/engine';
import { defaultParams, type NodeSpec, type ParamSpec } from '../core/archetype';
import { DEFAULT_GLOBAL, type GlobalParams } from '../core/params';
import { getFactory, listFactories } from '../core/registry';
import { registerArchetypes } from '../archetypes';

// Ensure the registry is populated before deriving initial params from it.
registerArchetypes();

const INITIAL_ARCHETYPE = 'lorenz';

// Shared reactive state. The engine subscribes to these (sim side) and writes $telemetry;
// Lit components bind via @nanostores/lit StoreController.
export const $archetypeId = atom<string>(INITIAL_ARCHETYPE);
export const $global = map<GlobalParams>({ ...DEFAULT_GLOBAL });
export const $params = map<Record<string, number>>({ ...defaultParams(getFactory(INITIAL_ARCHETYPE).params) });

export function setParam(key: string, value: number): void {
  $params.setKey(key, value);
}

export function setGlobal<K extends keyof GlobalParams>(key: K, value: GlobalParams[K]): void {
  $global.setKey(key, value);
}

// Switch archetype (FR-3.1): adopt the new factory's default params, particle count, and dt
// (each system has its own stable integration step).
export function selectArchetype(id: string): void {
  if (id === $archetypeId.get()) return;
  const factory = getFactory(id);
  $params.set({ ...defaultParams(factory.params) });
  $global.setKey('particleCount', factory.defaultParticleCount);
  $global.setKey('dt', factory.defaultDt);
  $global.setKey('trailLength', factory.defaultTrail ?? DEFAULT_GLOBAL.trailLength);
  $archetypeId.set(id);
}

// Re-apply the current factory's factory defaults (params + particle count + dt + trail) without
// switching systems — the "reset to defaults" action.
export function resetCurrent(): void {
  const factory = getFactory($archetypeId.get());
  $params.set({ ...defaultParams(factory.params) });
  $global.setKey('particleCount', factory.defaultParticleCount);
  $global.setKey('dt', factory.defaultDt);
  $global.setKey('trailLength', factory.defaultTrail ?? DEFAULT_GLOBAL.trailLength);
}

// Jump to a uniformly-random different system.
export function selectRandom(): void {
  const ids = listFactories().map((f) => f.id);
  const cur = $archetypeId.get();
  const others = ids.filter((id) => id !== cur);
  if (others.length === 0) return;
  selectArchetype(others[Math.floor(Math.random() * others.length)]);
}

// Demo mode: auto-cycle to a random system on a timer (a hands-off "screensaver"). The interval
// lives at module scope so it survives component re-renders.
// - $demoPaused: the demo auto-advance is HELD ("P" key) — stay on the current system; sim runs.
// - $paused:     the SIMULATION is frozen ("Space"; set by the engine). This ALSO halts the
//                auto-advance (you wouldn't want it to switch while frozen, e.g. before a screenshot).
// - $demoDetails: show the current system's about + formulae as a bottom overlay (still in demo).
export const $demoMode = atom<boolean>(false);
export const $demoPaused = atom<boolean>(false);
export const $demoDetails = atom<boolean>(false);
export const $paused = atom<boolean>(false);
export const $demoInterval = atom<number>(30); // seconds between auto-advances (20s … 20min, slider)
let demoTimer: ReturnType<typeof setInterval> | null = null;

// Demo history (← / →): the systems shown this session, with a cursor, so the user can step back to
// a previous one or skip ahead. New randoms append at the end; back/forward walk the list.
let demoHistory: string[] = [];
let demoPos = -1;
let navInProgress = false; // true while ←/→ drives the change, so we don't re-record a nav step

// The auto-advance runs only while demo is on, not explicitly held (P), and the sim isn't frozen.
function updateDemoTimer(): void {
  const run = $demoMode.get() && !$demoPaused.get() && !$paused.get();
  if (run && !demoTimer) demoTimer = setInterval(demoNext, $demoInterval.get() * 1000);
  else if (!run && demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
}
// Freezing the simulation (Space) implies holding the demo; resuming releases it.
$paused.subscribe(() => updateDemoTimer());
// Changing the interval restarts a running timer so the new cadence takes effect immediately.
$demoInterval.subscribe(() => {
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
    updateDemoTimer();
  }
});
export function setDemoInterval(sec: number): void {
  $demoInterval.set(Math.min(1200, Math.max(20, Math.round(sec))));
}

export function setDemoMode(on: boolean): void {
  if (on === $demoMode.get()) return;
  $demoMode.set(on);
  demoHistory = [];
  demoPos = -1;
  if (on) {
    $demoPaused.set(false);
    selectRandom(); // recorded as the first history entry by the subscription below
  } else {
    $demoPaused.set(false);
    $demoDetails.set(false);
  }
  updateDemoTimer();
}

// "P": hold/release the auto-advance only (the simulation keeps animating).
export function toggleDemoPause(): void {
  if (!$demoMode.get()) return;
  $demoPaused.set(!$demoPaused.get());
  updateDemoTimer();
}

// Toggle the bottom about/formula overlay without leaving demo mode.
export function toggleDemoDetails(): void {
  if (!$demoMode.get()) return;
  $demoDetails.set(!$demoDetails.get());
}

// Primary interactive knob: the first slider of the current system. Driven from the keyboard in
// demo mode (+/− nudges, 1-9 jump across the range) so the full-screen view stays playable and the
// equation values visibly update.
export function primaryParam(): ParamSpec | null {
  const specs = getFactory($archetypeId.get()).params;
  return specs.length ? specs[0] : null;
}
function applyPrimary(spec: ParamSpec, value: number): void {
  setParam(spec.key, Math.min(spec.max, Math.max(spec.min, value)));
}
export function nudgePrimaryParam(dir: number): void {
  const spec = primaryParam();
  if (!spec) return;
  const cur = $params.get()[spec.key] ?? spec.default;
  const step = Math.max(spec.step ?? 0, (spec.max - spec.min) / 50); // perceptible even when step is tiny
  applyPrimary(spec, cur + dir * step);
}
export function setPrimaryParamDecile(d: number): void {
  const spec = primaryParam();
  if (!spec) return;
  const frac = Math.min(1, Math.max(0, (d - 1) / 8)); // 1 → min, 5 → middle, 9 → max
  applyPrimary(spec, spec.min + frac * (spec.max - spec.min));
}

// Record fresh visits (auto-random or a manual search-jump) while in demo; ←/→ steps are skipped.
$archetypeId.subscribe((id) => {
  if (!$demoMode.get() || navInProgress) return;
  demoHistory = demoHistory.slice(0, demoPos + 1); // drop forward history on a new branch
  if (demoHistory[demoPos] !== id) {
    demoHistory.push(id);
    demoPos = demoHistory.length - 1;
  }
});

export function demoCanPrev(): boolean {
  return $demoMode.get() && demoPos > 0;
}
// "←": step back to the previously-shown system.
export function demoPrev(): void {
  if (!$demoMode.get() || demoPos <= 0) return;
  navInProgress = true;
  demoPos--;
  selectArchetype(demoHistory[demoPos]);
  navInProgress = false;
}
// "→" / auto-advance: re-show the next already-seen system, or (at the end) pick a fresh random.
export function demoNext(): void {
  if (!$demoMode.get()) return;
  if (demoPos < demoHistory.length - 1) {
    navInProgress = true;
    demoPos++;
    selectArchetype(demoHistory[demoPos]);
    navInProgress = false;
  } else {
    selectRandom();
  }
}

// Static guide-geometry overlay (equipotential boundaries, reach circles, …) — a global show/hide.
export const $guides = atom<boolean>(true);
export function toggleGuides(): void {
  $guides.set(!$guides.get());
}

// Control-UI visibility (panel + learn box). An immersive show/hide so the visualization can go
// full-screen — defaults open on wide screens, collapsed on phones where the panel would dominate.
export const $panelOpen = atom<boolean>(typeof window !== 'undefined' ? window.innerWidth > 640 : true);
export function setPanelOpen(on: boolean): void {
  $panelOpen.set(on);
}

export interface Telemetry {
  fps: number;
  particles: number;
  substeps: number;
  backend: string;
  lle: number;
  camPos: [number, number, number]; // camera world position (so a view is reproducible)
  camTarget: [number, number, number]; // orbit target
  simTime: string; // physical sim-clock display (e.g. "T + 4.3 Gyr"); '' when the system declares no clock
}

export const $telemetry = map<Telemetry>({
  fps: 0,
  particles: 0,
  substeps: 0,
  backend: '…',
  lle: NaN,
  camPos: [0, 0, 0],
  camTarget: [0, 0, 0],
  simTime: '',
});

export const $engine = atom<Engine | null>(null);

// Active archetype's hierarchy (FR-3.2) + the currently selected node id.
export const $hierarchy = atom<NodeSpec[]>([]);
export const $selectedNode = atom<string | null>(null);

export { listFactories };

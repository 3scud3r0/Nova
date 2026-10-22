import type { ArchetypeFactory } from './archetype';

// Archetype registry. Factories self-register via side-effect import (see archetypes/index.ts),
// which keeps the Manager decoupled and makes archetypes code-splittable.
const registry = new Map<string, ArchetypeFactory>();

export function register(factory: ArchetypeFactory): void {
  registry.set(factory.id, factory);
}

export function getFactory(id: string): ArchetypeFactory {
  const f = registry.get(id);
  if (!f) throw new Error(`Unknown archetype "${id}". Registered: ${[...registry.keys()].join(', ') || '(none)'}`);
  return f;
}

export function listFactories(): ArchetypeFactory[] {
  return [...registry.values()];
}

// True for sphere-traced fractal archetypes (Mandelbulb, etc.): they render via a full-screen
// raymarch pass, not the point/worker pipeline. bootstrap uses this to route them to the
// raymarch renderer and an inert NullDriver (so the sim worker never instantiates one).
export function isRaymarch(id: string): boolean {
  const f = registry.get(id);
  return !!f && f.kind === 'raymarch';
}

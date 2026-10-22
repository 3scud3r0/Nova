import type { GpuFactory, GpuSim } from './types';
import { GPU_SYSTEMS, makeGpuAttractor } from './gpuAttractor';
import { GPU_MAPS, makeGpuMap } from './gpuMap';
import { makeGpuIfs } from './gpuFractalIFS';
import { IFS_SYSTEMS } from '../archetypes/fractalIFS';
import { makeGpuEscape } from './gpuEscapeFractal';
import { ESCAPE_SYSTEMS } from '../archetypes/escapeFractal';
import { gpuLenia } from './gpuLenia';
import { gpuHyperOscillator } from './gpuHyperOscillator';
import { gpuNbody } from './gpuNbody';
import { gpuFoam } from './gpuFoam';
import { gpuParticleLife } from './gpuParticleLife';
import { gpuBoids } from './gpuBoids';
import { gpuSlimeMold } from './gpuSlimeMold';
import { gpuPointVortices } from './gpuPointVortices';
import { gpuExcitableMedium } from './gpuExcitableMedium';
import { gpuGrayScottField } from './gpuGrayScottField';
import { gpuKuramoto } from './gpuKuramoto';
import { gpuChimera } from './gpuChimera';
import { gpuKarman } from './gpuKarman';
// import { gpuGalaxyCollision } from './gpuGalaxyCollision'; // WIP GPU twin — renders black (silent WGSL
//   compile issue not yet cracked); galaxyCollision runs on the working CPU archetype until it's fixed.

// Registry of GPU-compute factories by archetype id (parallel to the CPU archetype registry).
const GPU_FACTORIES: Record<string, GpuFactory> = {
  hyperOscillator: gpuHyperOscillator,
  nbody: gpuNbody,
  quantumFoam: gpuFoam,
  lenia: gpuLenia,
  // dla: runs CPU-only — its pre-grown frontier-launch dendrite + bright palette live in the CPU archetype
  // polynomialRoots: CPU-only — one-shot Durand–Kerner root cloud computed at build (no GPU twin)
  // cymatics: CPU-only — Faraday Bessel-mode superposition evaluated per mode-change (no GPU twin)
  particleLife: gpuParticleLife,
  boids: gpuBoids,
  slimeMold: gpuSlimeMold,
  pointVortices: gpuPointVortices,
  excitableMedium: gpuExcitableMedium,
  grayScottField: gpuGrayScottField,
  kuramoto: gpuKuramoto,
  chimera: gpuChimera,
  karman: gpuKarman,
};
for (const id of Object.keys(GPU_SYSTEMS)) GPU_FACTORIES[id] = makeGpuAttractor(id);
for (const id of Object.keys(GPU_MAPS)) GPU_FACTORIES[id] = makeGpuMap(id);
for (const id of Object.keys(IFS_SYSTEMS)) GPU_FACTORIES[id] = makeGpuIfs(id);
for (const id of Object.keys(ESCAPE_SYSTEMS)) GPU_FACTORIES[id] = makeGpuEscape(id);

export function hasGpu(id: string): boolean {
  return id in GPU_FACTORIES;
}

export function createGpu(id: string, count: number, dt: number, params: Record<string, number>): GpuSim {
  const sim = GPU_FACTORIES[id](count, dt, params);
  sim.setParams({ ...params, dt });
  return sim;
}

export type { GpuSim } from './types';

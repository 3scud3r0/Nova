import { describe, expect, it } from 'vitest';
import { Snapshot } from '../src/state/schema';
import { migrate } from '../src/state/migrations';

function validSnapshot(): Snapshot {
  return {
    schemaVersion: 3,
    archetypeId: 'lorenz',
    particleCount: 100_000,
    global: { dt: 0.005 },
    archetypeParams: { sigma: 10, rho: 28, beta: 8 / 3 },
    hierarchy: [
      { id: 'root', parentId: null, label: 'Lorenz', stateOffset: 0, stateLength: 300_000 },
    ],
    matrices: {},
    initVectors: {},
    camera: { position: [0, 0, 6], target: [0, 0, 0], zoomDecade: 0, fov: 55, logarithmicDepth: false },
    rng: { seed: 1 },
    frameIndex: 0,
  };
}

describe('Snapshot schema', () => {
  it('round-trips through JSON without loss', () => {
    const snap = validSnapshot();
    const parsed = Snapshot.parse(JSON.parse(JSON.stringify(snap)));
    expect(parsed).toEqual(snap);
  });

  it('rejects a malformed snapshot', () => {
    const bad = { ...validSnapshot(), global: { dt: 'fast' } } as unknown;
    expect(() => Snapshot.parse(bad)).toThrow();
  });

  it('migrates a v1 document through the chain to v3', () => {
    const v1 = {
      schemaVersion: 1,
      archetypeId: 'lorenz',
      global: { eps: 0, gamma: 0, freqScale: 1, ampScale: 1, dt: 0.005 },
      hierarchy: [
        { id: 'root', parentId: null, label: 'Lorenz', stateOffset: 0, stateLength: 300_000, params: { sigma: 10, rho: 28, beta: 8 / 3 } },
      ],
      matrices: {},
      initVectors: {},
      camera: { position: [0, 0, 6], target: [0, 0, 0], zoom: 2.5, fov: 55 },
      rng: { seed: 1 },
      frameIndex: 0,
    };
    const upgraded = migrate(v1);
    expect(upgraded.schemaVersion).toBe(3);
    expect(upgraded.camera.zoomDecade).toBe(2.5); // v1 -> v2: zoom -> zoomDecade
    expect(upgraded.camera.logarithmicDepth).toBe(false);
    expect(upgraded.global.dt).toBe(0.005);
    expect(upgraded.archetypeParams.sigma).toBe(10); // v2 -> v3: root params -> archetypeParams
    expect(upgraded.particleCount).toBe(100_000); // derived from stateLength/3
  });
});

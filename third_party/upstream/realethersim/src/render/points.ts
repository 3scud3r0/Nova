import * as THREE from 'three';
import type { RenderHint } from '../core/archetype';

export interface PointCloud {
  points: THREE.Points;
  posAttr: THREE.BufferAttribute;
  // Highlight a contiguous particle range by dimming the rest (recolours the color attribute,
  // no shader). Pass null to clear. Used by the hierarchy tree to spotlight a selected cluster.
  highlight(start: number | null, count: number): void;
  dispose(): void;
}

const DIM_FACTOR = 0.14; // brightness of non-selected particles

// Single THREE.Points fed directly from the simulation's f32 position buffer. The attribute
// array IS the sim buffer (zero copy); each frame we flag needsUpdate to re-upload. With the
// floating-origin anchor at 0 (P1) no rebase copy is needed.
export function createPointCloud(
  positions: Float32Array,
  colors: Float32Array | null,
  hint: RenderHint,
): PointCloud {
  const geom = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', posAttr);

  // Separate immutable base colors from the mutable display colors so highlight is reversible.
  const base = colors;
  let displayAttr: THREE.BufferAttribute | null = null;
  if (base) {
    const display = base.slice();
    displayAttr = new THREE.BufferAttribute(display, 3);
    displayAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('color', displayAttr);
  }

  // Skip bounding-sphere culling: positions update every frame and may briefly be large.
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

  const material = new THREE.PointsMaterial({
    size: hint.pointSize ?? 0.02,
    sizeAttenuation: true,
    vertexColors: !!base,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;

  return {
    points,
    posAttr,
    highlight(start: number | null, count: number): void {
      if (!base || !displayAttr) return;
      const display = displayAttr.array as Float32Array;
      const n = display.length / 3;
      if (start === null) {
        display.set(base); // restore full brightness
      } else {
        const end = start + count;
        for (let i = 0; i < n; i++) {
          const f = i >= start && i < end ? 1 : DIM_FACTOR;
          const o = i * 3;
          display[o] = base[o] * f;
          display[o + 1] = base[o + 1] * f;
          display[o + 2] = base[o + 2] * f;
        }
      }
      displayAttr.needsUpdate = true;
    },
    dispose(): void {
      geom.dispose();
      material.dispose();
    },
  };
}

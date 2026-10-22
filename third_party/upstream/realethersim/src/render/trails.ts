import * as THREE from 'three';

export interface TrailCloud {
  group: THREE.Group;
  update(head: number): void; // upload the newly written slot + refade when the head advances
  refreshAll(): void; // mark every slot for upload (after a seed)
  setVisible(v: boolean): void;
  dispose(): void;
}

const MAX_OPACITY = 0.5;

// Renders the trail ring as K point clouds, one per slot, each reading a fixed subarray of the
// ring (world-space → correct under camera orbit, unlike a screen-space afterimage). Per-cloud
// opacity fades with the slot's age relative to the head, so the trail dims into the past. Only
// the slot that just changed is re-uploaded per capture, and only K opacities are recomputed —
// O(K), never O(K·N). Additive blending makes overlapping history glow.
export function createTrailCloud(
  ring: Float32Array,
  particleCount: number,
  slots: number,
  colors: Float32Array | null,
  pointSize: number,
): TrailCloud {
  const group = new THREE.Group();
  const span = particleCount * 3;
  const posAttrs: THREE.BufferAttribute[] = [];
  const mats: THREE.PointsMaterial[] = [];

  for (let s = 0; s < slots; s++) {
    const geom = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(ring.subarray(s * span, (s + 1) * span), 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', pa);
    if (colors) geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    const mat = new THREE.PointsMaterial({
      size: pointSize * 0.85,
      sizeAttenuation: true,
      vertexColors: !!colors,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geom, mat);
    pts.frustumCulled = false;
    group.add(pts);
    posAttrs.push(pa);
    mats.push(mat);
  }

  let lastHead = -1;

  function refade(head: number): void {
    for (let s = 0; s < slots; s++) {
      const age = (head - s + slots) % slots; // 0 = newest behind the live edge
      const t = 1 - age / (slots - 1);
      mats[s].opacity = MAX_OPACITY * t * t; // quadratic falloff
    }
  }

  return {
    group,
    update(head: number): void {
      if (head === lastHead) return;
      posAttrs[head].needsUpdate = true; // the worker just wrote this slot
      refade(head);
      lastHead = head;
    },
    refreshAll(): void {
      for (const pa of posAttrs) pa.needsUpdate = true;
      lastHead = -1;
    },
    setVisible(v: boolean): void {
      group.visible = v;
    },
    dispose(): void {
      for (const pts of group.children as THREE.Points[]) pts.geometry.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

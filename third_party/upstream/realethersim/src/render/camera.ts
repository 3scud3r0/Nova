import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface CameraHandle {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}

// Standard pointer interactions (NFR-2.1): orbit (left-drag), pan (right-drag), zoom (wheel).
// Extreme near/far range (paired with the renderer's logarithmic depth buffer) + wide
// min/max dolly distance support deep zoom across many decades (NFR-2.2); OrbitControls' dolly
// is already multiplicative, so wheel zoom is perceptually logarithmic.
export function createCamera(canvas: HTMLCanvasElement): CameraHandle {
  const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
  const camera = new THREE.PerspectiveCamera(55, aspect, 1e-3, 1e6);
  camera.position.set(2.4, 1.5, 4.4);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1e-3;
  controls.maxDistance = 1e5;
  controls.zoomToCursor = true;
  controls.target.set(0, 0, 0);
  controls.update();

  return { camera, controls };
}

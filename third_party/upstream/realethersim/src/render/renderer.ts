import { WebGPURenderer } from 'three/webgpu';

export interface RendererHandle {
  renderer: WebGPURenderer;
  backend: 'webgpu' | 'webgl2';
}

// WebGPU-first (per project decision): WebGPURenderer initialises a WebGPU backend when
// available and transparently falls back to WebGL2 otherwise. logarithmicDepthBuffer keeps the
// depth buffer precise across the extreme near/far range needed for deep log-zoom (NFR-2.2).
export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererHandle> {
  const renderer = new WebGPURenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x05070d, 1);

  const b = renderer.backend as unknown as { isWebGPUBackend?: boolean };
  const backend: 'webgpu' | 'webgl2' = b?.isWebGPUBackend ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}

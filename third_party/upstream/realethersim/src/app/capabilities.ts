export interface Capabilities {
  webgpu: boolean;
  crossOriginIsolated: boolean; // SharedArrayBuffer available (COOP/COEP headers present)
}

export async function detectCapabilities(): Promise<Capabilities> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  let webgpu = false;
  if (gpu) {
    try {
      webgpu = !!(await gpu.requestAdapter());
    } catch {
      webgpu = false;
    }
  }
  return {
    webgpu,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
  };
}

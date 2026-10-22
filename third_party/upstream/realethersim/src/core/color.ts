// hsl -> rgb (h,s,l in [0,1]) writing into out[off..off+3). Pure util shared by archetypes for
// per-particle coloring; lives in core so Physics never reaches into the render layer.
export function hslToRgb(h: number, s: number, l: number, out: Float32Array, off: number): void {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  out[off] = f(0);
  out[off + 1] = f(8);
  out[off + 2] = f(4);
}

// Fill a particleCount*3 color buffer with a spectral gradient by index.
export function spectralGradient(count: number, out: Float32Array, spread = 0.85, sat = 0.85, light = 0.6): void {
  for (let i = 0; i < count; i++) hslToRgb((i / count) * spread, sat, light, out, i * 3);
}

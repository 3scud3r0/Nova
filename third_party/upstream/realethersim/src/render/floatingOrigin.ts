// Floating-origin / RTE rebase hook (NFR-2.2 extreme zoom).
//
// In the Phase-1 slice the anchor is pinned to the world origin (identity), because the
// attractor's render coordinates are already small (~[-2, 2]) where absolute f32 is exact.
// The hook exists from day one so Phase 2 can turn it into camera-relative rebasing backed by
// an f64 anchor (+ a logarithmic depth buffer) WITHOUT restructuring the upload path —
// retrofitting floating-origin onto an absolute-f32 pipeline late is invasive.
export class FloatingOrigin {
  readonly anchor = { x: 0, y: 0, z: 0 };

  isIdentity(): boolean {
    return this.anchor.x === 0 && this.anchor.y === 0 && this.anchor.z === 0;
  }

  // Phase 2: subtract the f64 anchor from src world positions into dst render positions.
  rebase(src: Float32Array, dst: Float32Array): void {
    const { x, y, z } = this.anchor;
    for (let i = 0; i < src.length; i += 3) {
      dst[i] = src[i] - x;
      dst[i + 1] = src[i + 1] - y;
      dst[i + 2] = src[i + 2] - z;
    }
  }
}

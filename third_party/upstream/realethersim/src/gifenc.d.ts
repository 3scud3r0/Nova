// Minimal ambient types for `gifenc` (mattdesl) — the package ships no .d.ts. Covers only the
// functions ETHERSIM uses for the clip-export GIF encoder (see src/app/bootstrap.ts captureClip).
declare module 'gifenc' {
  type RGBPalette = number[][];

  interface WriteFrameOptions {
    palette?: RGBPalette;
    delay?: number; // ms between frames
    repeat?: number; // 0 = loop forever (default)
    transparent?: boolean;
    dispose?: number;
  }

  interface GifEncoder {
    writeFrame(index: Uint8Array | Uint8ClampedArray, width: number, height: number, opts?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifEncoder;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number },
  ): RGBPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: RGBPalette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array;
}

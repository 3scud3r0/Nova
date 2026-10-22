import type { Snapshot } from '../state/schema';

// Imperative handle the Lit UI talks to. Keeps the render loop and Three scene out of any
// reactive/vDOM tree (NFR-1.2): the UI calls methods, it never drives the canvas.
export interface Engine {
  readonly backend: string;
  exportSnapshot(): Snapshot;
  importSnapshot(snap: Snapshot): void;
  // Render a PNG of the current view with a branded overlay + the full snapshot embedded as
  // metadata, then download it. The image alone can recreate the simulation.
  exportImage(): Promise<void>;
  // The same branded, metadata-embedded PNG as exportImage() but returned as a Blob (for sharing).
  captureImageBlob(): Promise<Blob>;
  // Record a short looping clip of the live view and download it as WebM (+ animated GIF) — a
  // motion-faithful share asset (a still can't convey the 3D animation). onStatus reports progress.
  captureClip(onStatus?: (msg: string) => void): Promise<void>;
  // A clean, downscaled thumbnail of the current view (no overlay, no metadata) as a WebP data URL.
  // DEV-ONLY: attached to the engine only under import.meta.env.DEV (the offline thumbnail-capture
  // pass), so the readback/encode body tree-shakes out of the production bundle. Optional at the type
  // level for that reason — guard with `engine.captureThumbnail?.(…)`.
  captureThumbnail?(maxW?: number): Promise<string>;
  togglePause(): boolean; // returns the new paused state
  // Pan the view (camera + orbit target) without rotating; dx/dy are screen directions in [-1,1].
  panView(dx: number, dy: number): void;
  // Place the camera + orbit target directly (used to restore a shared deep-link view).
  setCamera(position: [number, number, number], target: [number, number, number]): void;
  reset(): void;
  // Highlight a contiguous particle range (hierarchy-tree selection). Pass null to clear.
  highlightParticles(start: number | null, count: number): void;
  // Smoothly fly the camera to frame a particle group (macro→micro focus, NFR-2.2).
  focusNode(start: number | null, count: number): void;
}

import { z } from 'zod';

// Versioned snapshot schema (FR-3.3). Extends the PRD schema (matrices, init vectors, camera)
// and is the single source of truth: runtime validation + inferred TS types + migration target.
// Trails are excluded — they regenerate. rngSeed + fixed dt = bit-reproducible replay.
//
// v3: archetype params are generic (archetypeParams) so any archetype round-trips, and global
// carries only cross-archetype controls (dt). particleCount is captured for full restore.

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

const Matrix = z.object({
  rows: z.number().int(),
  cols: z.number().int(),
  data: z.array(z.number()), // flat, explicit dims
});

const Node = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  label: z.string(),
  stateOffset: z.number().int(),
  stateLength: z.number().int(),
  params: z.record(z.string(), z.number()).optional(),
  particleStart: z.number().int().optional(),
  particleCount: z.number().int().optional(),
});

const Camera = z.object({
  position: Vec3,
  target: Vec3,
  zoomDecade: z.number(), // log-zoom level (NFR-2.2)
  fov: z.number(),
  logarithmicDepth: z.boolean(),
});

export const CURRENT_SCHEMA_VERSION = 3 as const;

export const Snapshot = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  archetypeId: z.string(),
  particleCount: z.number().int(),
  global: z.object({ dt: z.number(), trailLength: z.number().optional() }),
  archetypeParams: z.record(z.string(), z.number()),
  hierarchy: z.array(Node),
  matrices: z.record(z.string(), Matrix),
  initVectors: z.record(z.string(), z.array(z.number())),
  camera: Camera,
  rng: z.object({ seed: z.number(), stream: z.number().optional() }),
  frameIndex: z.number().int(),
});

export type Snapshot = z.infer<typeof Snapshot>;
export type SnapshotNode = z.infer<typeof Node>;
export type SnapshotCamera = z.infer<typeof Camera>;

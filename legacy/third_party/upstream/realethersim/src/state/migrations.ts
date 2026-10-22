import { CURRENT_SCHEMA_VERSION, Snapshot } from './schema';

// Forward migration chain. Each entry upgrades a document from version N to N+1.
// On import: run migrations until current, then validate with Snapshot.parse.
type AnyDoc = Record<string, unknown>;

const migrations: Record<number, (d: AnyDoc) => AnyDoc> = {
  // v1 -> v2: camera.zoom (linear) became camera.zoomDecade (log); add logarithmicDepth flag.
  1: (d) => {
    const cam = (d.camera ?? {}) as AnyDoc;
    return {
      ...d,
      schemaVersion: 2,
      camera: {
        ...cam,
        zoomDecade: typeof cam.zoom === 'number' ? cam.zoom : (cam.zoomDecade ?? 0),
        logarithmicDepth: cam.logarithmicDepth ?? false,
      },
    };
  },
  // v2 -> v3: split rigid global fields into generic archetypeParams; capture particleCount.
  2: (d) => {
    const global = (d.global ?? {}) as AnyDoc;
    const hierarchy = (d.hierarchy ?? []) as Array<AnyDoc>;
    const rootParams = (hierarchy[0]?.params ?? {}) as Record<string, number>;
    const rootLen = typeof hierarchy[0]?.stateLength === 'number' ? (hierarchy[0].stateLength as number) : 0;
    return {
      ...d,
      schemaVersion: 3,
      global: { dt: typeof global.dt === 'number' ? global.dt : 0.005 },
      archetypeParams: { ...rootParams },
      particleCount: rootLen > 0 ? Math.round(rootLen / 3) : 100_000,
    };
  },
};

export function migrate(raw: unknown): Snapshot {
  let doc = raw as AnyDoc;
  let version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) throw new Error(`No migration from schema version ${version}`);
    doc = step(doc);
    version = doc.schemaVersion as number;
  }
  return Snapshot.parse(doc);
}

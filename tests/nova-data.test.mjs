import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseNovaFile, extractPoints } from "../bridge/nova-data.mjs";
const data = s => new TextEncoder().encode(s);

test("RLE decodes a glider and rejects missing termination", async () => {
  const g = await parseNovaFile("glider.rle", data("x = 3, y = 3, rule = B3/S23\nbob$2bo$3o!\n"));
  assert.equal(g.kind, "grid");
  assert.equal(g.population, 5);
  assert.deepEqual(Array.from(g.cells), [0,1,0,0,0,1,1,1,1]);
  await assert.rejects(parseNovaFile("bad.rle", data("x = 3, y = 3\n3o")), /terminador/);
});
test("CSV parsing and spatial coordinates", async () => {
  const csv = await parseNovaFile("trajectories.csv", data('x,y,tag\n1.5,2.5,"a,b"\n3,4,c\n'));
  assert.equal(csv.rows[0].tag, "a,b");
  assert.deepEqual(extractPoints(csv), [[1.5,2.5],[3,4]]);
});
test("JSONL accepts arrays of position", async () => {
  const j = await parseNovaFile("positions.jsonl", data('{"position":[1,2,3]}\n{"position":[5,6,7]}\n'));
  assert.deepEqual(extractPoints(j), [[1,2],[5,6]]);
});
test("NCA verifies the binary grid checksum", async () => {
  const cells = new Uint8Array([1,0,1,0]);
  const sha256 = createHash("sha256").update(cells).digest("hex");
  const header = data(JSON.stringify({schema:"NOVA-CA-v1",shape:[2,2,1],tick:7,sha256})+"\n");
  const bytes = new Uint8Array(header.length + cells.length);
  bytes.set(header); bytes.set(cells,header.length);
  const nca = await parseNovaFile("state.nca",bytes);
  assert.equal(nca.tick,7);
  assert.equal(nca.population,2);
  bytes[bytes.length-1] = 1;
  await assert.rejects(parseNovaFile("state.nca", bytes), /checksum/);
});
test("rejects unsupported file types and unsafe sizes", async () => {
  await assert.rejects(parseNovaFile("raw.arrow",data("data")), /binário/);
  await assert.rejects(parseNovaFile("large.csv",new Uint8Array(33*1024*1024)), /32 MiB/);
});

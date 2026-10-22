/* NOVA browser data bridge. No dependencies; never executes imported content.
 * AGPL-3.0-or-later. Parse small native NCA/RLE and CSV/JSON/JSONL exports.
 */
const LIMIT = 32 * 1024 * 1024;
const MAX_CELLS = 4_194_304;
const decoder = new TextDecoder("utf-8", { fatal: true });
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const validShape = (width, height) => Number.isSafeInteger(width) && Number.isSafeInteger(height)
  && width > 0 && height > 0 && width * height <= MAX_CELLS;

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(v => v.trim() !== "")) rows.push(row);
      row = []; cell = "";
    } else cell += ch;
  }
  if (quoted) throw new Error("CSV: aspas não fechadas");
  row.push(cell);
  if (row.some(v => v.trim() !== "")) rows.push(row);
  if (!rows.length) throw new Error("CSV vazio");
  const head = rows.shift();
  const data = rows.map(fields => Object.fromEntries(head.map((name, i) => [name, fields[i] ?? ""])));
  return { format: "CSV", kind: "rows", total: data.length, rows: data, columns: head };
}

function parseRle(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith("#"));
  const header = lines.shift() || "";
  const dimensions = /x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/i.exec(header);
  if (!dimensions) throw new Error("RLE sem cabeçalho x/y");
  const width = Number(dimensions[1]), height = Number(dimensions[2]);
  if (!validShape(width, height)) throw new Error("RLE excede o limite de 4 milhões de células");
  const cells = new Uint8Array(width * height);
  const body = lines.join("").replace(/\s+/g, "");
  let x = 0, y = 0, count = "", ended = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (/\d/.test(ch)) { count += ch; if (count.length > 9) throw new Error("RLE: repetição excessiva"); continue; }
    const n = count ? Number(count) : 1;
    count = "";
    if (ch === "!") { ended = true; break; }
    if (!["o", "b", "$"].includes(ch) || n <= 0) throw new Error("RLE: token inválido");
    if (ch === "$") { y += n; x = 0; if (y > height) throw new Error("RLE fora da grade"); continue; }
    if (y >= height || x + n > width) throw new Error("RLE fora da grade");
    if (ch === "o") cells.fill(1, y * width + x, y * width + x + n);
    x += n;
  }
  if (!ended) throw new Error("RLE sem terminador !");
  return { format: "RLE", kind: "grid", width, height, population: cells.reduce((a,b) => a+b,0), cells };
}

async function parseNca(bytes) {
  const cut = bytes.indexOf(10);
  if (cut < 0 || cut > 4096) throw new Error("NCA: cabeçalho inválido");
  const header = JSON.parse(decoder.decode(bytes.subarray(0, cut)));
  const [width, height, depth] = header.shape || [];
  if (header.schema !== "NOVA-CA-v1" || depth !== 1 || !validShape(width, height))
    throw new Error("NCA: versão ou dimensões 2D incompatíveis");
  const cells = bytes.subarray(cut + 1);
  if (cells.length !== width * height || cells.some(x => x > 1))
    throw new Error("NCA: células inválidas");
  const digest = await crypto.subtle.digest("SHA-256", cells);
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  if (hex !== header.sha256) throw new Error("NCA: checksum SHA-256 não confere");
  return { format: "NCA", kind: "grid", width, height,
    population: cells.reduce((a,b) => a+b,0), tick: header.tick, cells: new Uint8Array(cells) };
}

export async function parseNovaFile(filename, input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > LIMIT) throw new Error("Arquivo acima do limite de 32 MiB");
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "nca") return parseNca(bytes);
  if (["arrow", "parquet", "zarr", "npz"].includes(ext))
    throw new Error("Este formato binário ainda não é lido no navegador; exporte CSV ou JSONL.");
  const text = decoder.decode(bytes);
  if (ext === "rle") return parseRle(text);
  if (ext === "csv") return parseCsv(text);
  if (ext === "jsonl") {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length > 100000) throw new Error("JSONL excede 100 mil registros");
    const rows = lines.map((s, i) => { try { return JSON.parse(s); }
      catch { throw new Error("JSONL inválido na linha " + (i+1)); } });
    return { format: "JSONL", kind: "rows", total: rows.length, rows, columns: Object.keys(rows[0] || {}) };
  }
  if (ext === "json") {
    const value = JSON.parse(text);
    return { format: "JSON", kind: "metadata", value };
  }
  throw new Error("Formato não aceito. Use .nca, .rle, .csv, .jsonl ou .json.");
}

export function extractPoints(result, max = 30000) {
  if (result.kind !== "rows") return [];
  const points = [];
  for (const row of result.rows) {
    let pos = row.position;
    if (typeof pos === "string") { try { pos = JSON.parse(pos); } catch { /* leave */ } }
    const x = number(row.x ?? row.pos_x ?? (Array.isArray(pos) && pos[0]));
    const y = number(row.y ?? row.pos_y ?? (Array.isArray(pos) && pos[1]));
    if (x !== null && y !== null) points.push([x, y]);
    if (points.length >= max) break;
  }
  return points;
}

// Read/write a PNG `tEXt` metadata chunk — used to embed the ETHERSIM snapshot JSON inside an
// exported image so the picture itself can recreate the simulation. Pure, dependency-free byte
// work; everything stays client-side. Defensive on read (bounded walk, signature check) since
// imported files are untrusted; the extracted text is still zod-validated by the caller.

// CRC-32 (PNG/zlib polynomial), table-based.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const TYPE = 'tEXt';

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const readU32 = (b: Uint8Array, i: number): number => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const latin1 = (s: string): number[] => {
  const o: number[] = [];
  for (let i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 255);
  return o;
};
const fromLatin1 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

// Insert a `keyword\0text` tEXt chunk right before IEND; returns a new PNG byte array.
export function embedText(png: Uint8Array, keyword: string, text: string): Uint8Array {
  const data = [...latin1(keyword), 0, ...latin1(text)];
  const typeAndData = [...latin1(TYPE), ...data];
  const chunk = [...u32(data.length), ...typeAndData, ...u32(crc32(new Uint8Array(typeAndData)))];

  let pos = 8; // skip signature
  let iend = -1;
  while (pos + 12 <= png.length) {
    const len = readU32(png, pos);
    const type = fromLatin1(png.subarray(pos + 4, pos + 8));
    if (type === 'IEND') {
      iend = pos;
      break;
    }
    pos += 12 + len;
  }
  if (iend < 0) return png; // malformed — leave untouched

  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, iend), 0);
  out.set(new Uint8Array(chunk), iend);
  out.set(png.subarray(iend), iend + chunk.length);
  return out;
}

// Return the text of the first tEXt chunk with `keyword`, or null. Bounded + signature-checked.
export function extractText(png: Uint8Array, keyword: string): string | null {
  if (png.length < 8) return null;
  for (let i = 0; i < 8; i++) if (png[i] !== PNG_SIG[i]) return null; // not a PNG
  let pos = 8;
  let guard = 0;
  while (pos + 12 <= png.length && guard++ < 100000) {
    const len = readU32(png, pos);
    if (pos + 12 + len > png.length) break; // truncated chunk
    const type = fromLatin1(png.subarray(pos + 4, pos + 8));
    if (type === TYPE) {
      const data = png.subarray(pos + 8, pos + 8 + len);
      const nul = data.indexOf(0);
      if (nul >= 0 && fromLatin1(data.subarray(0, nul)) === keyword) {
        return fromLatin1(data.subarray(nul + 1));
      }
    }
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  return null;
}

import type { ImportedPlan } from "../index";

/**
 * Native decoder for the Tajima ternary record family: DST (512-byte header +
 * records) and T01 (records only). The exact inverse of the encoder's bit
 * table in dst.ts. This makes DST/T01 import fully native — no Pyodide
 * download — and doubles as an independent check that our own writers are
 * read back correctly.
 *
 * DST/T01 carry no thread colors, so blocks get a deterministic placeholder
 * palette (distinct, editable after import) — same information a machine has.
 */

export interface TernaryStitch {
  x: number; // 1/10 mm, absolute (screen-down y)
  y: number;
  jump: boolean;
  colorChange: boolean;
}

/** Backstop against corrupt/hostile files: real designs are ≤ ~100k records. */
const MAX_RECORDS = 500_000;

/** Distinct placeholder colors for formats that store none. */
const PLACEHOLDER_RGB = [
  0x173a7a, // press blue
  0xb23a2e, // stamp red
  0x288a46, // kelly green
  0xd8a830, // gold
  0x8054b2, // violet
  0x1c8a8a, // teal
  0x6c1a28, // burgundy
  0x37393e, // charcoal
];

const ternDigit = (plus: boolean, minus: boolean) => (plus ? 1 : minus ? -1 : 0);

/** Decode one 3-byte record into its relative move + flags. */
export function decodeRecord(
  b0: number,
  b1: number,
  b2: number,
): { dx: number; dyUp: number; jump: boolean; colorChange: boolean; eof: boolean } {
  const dx =
    ternDigit(!!(b0 & 0x01), !!(b0 & 0x02)) +
    3 * ternDigit(!!(b1 & 0x01), !!(b1 & 0x02)) +
    9 * ternDigit(!!(b0 & 0x04), !!(b0 & 0x08)) +
    27 * ternDigit(!!(b1 & 0x04), !!(b1 & 0x08)) +
    81 * ternDigit(!!(b2 & 0x04), !!(b2 & 0x08));
  const dyUp =
    ternDigit(!!(b0 & 0x80), !!(b0 & 0x40)) +
    3 * ternDigit(!!(b1 & 0x80), !!(b1 & 0x40)) +
    9 * ternDigit(!!(b0 & 0x20), !!(b0 & 0x10)) +
    27 * ternDigit(!!(b1 & 0x20), !!(b1 & 0x10)) +
    81 * ternDigit(!!(b2 & 0x20), !!(b2 & 0x10));
  const eof = b2 === 0xf3;
  const colorChange = !eof && (b2 & 0xc0) === 0xc0;
  const jump = !eof && !colorChange && (b2 & 0x80) !== 0;
  return { dx, dyUp, jump, colorChange, eof };
}

/** True when the buffer opens with a DST text header ("LA:" label field). */
export function hasDstHeader(buf: Uint8Array): boolean {
  return buf.length >= 515 && buf[0] === 0x4c && buf[1] === 0x41 && buf[2] === 0x3a; // "LA:"
}

/** Decode a DST or T01 byte stream into absolute stitches (1/10 mm). */
export function decodeTernaryStitches(buf: Uint8Array): TernaryStitch[] {
  const start = hasDstHeader(buf) ? 512 : 0;
  if (buf.length - start < 3) throw new Error("This file is too short to contain stitches.");
  const out: TernaryStitch[] = [];
  let x = 0;
  let y = 0;
  for (let p = start, n = 0; p + 2 < buf.length; p += 3) {
    if (++n > MAX_RECORDS)
      throw new Error(`This file decodes to over ${MAX_RECORDS.toLocaleString()} records — it may be corrupt.`);
    const { dx, dyUp, jump, colorChange, eof } = decodeRecord(buf[p], buf[p + 1], buf[p + 2]);
    if (eof) break;
    x += dx;
    y -= dyUp; // DST y points up; internal y points down
    out.push({ x, y, jump, colorChange });
  }
  return out;
}

/**
 * Decode DST/T01 bytes into the {@link ImportedPlan} shape the importer
 * consumes: color blocks of contiguous stitch runs, split at jumps and color
 * changes — the exact contract of the Python import path.
 */
export function decodeTernaryPlan(buf: Uint8Array): ImportedPlan {
  const stitches = decodeTernaryStitches(buf);
  const blocks: ImportedPlan["blocks"] = [];
  let colorIdx = 0;
  let cur: ImportedPlan["blocks"][number] = { rgb: PLACEHOLDER_RGB[0], runs: [] };
  let run: [number, number][] = [];

  const flush = () => {
    if (run.length >= 2) cur.runs.push(run);
    run = [];
  };

  for (const s of stitches) {
    if (s.colorChange) {
      flush();
      if (cur.runs.length > 0) blocks.push(cur);
      colorIdx++;
      cur = { rgb: PLACEHOLDER_RGB[colorIdx % PLACEHOLDER_RGB.length], runs: [] };
    } else if (s.jump) {
      flush();
    } else {
      run.push([s.x, s.y]);
    }
  }
  flush();
  if (cur.runs.length > 0) blocks.push(cur);
  return { blocks };
}

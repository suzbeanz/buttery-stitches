import type { StitchPlan } from "../index";

/**
 * Native Tajima DST writer — pure TypeScript, no Pyodide/Python runtime.
 *
 * DST is the universal embroidery format (virtually every machine reads it) and
 * the simplest to encode: a 512-byte ASCII header followed by 3-byte stitch
 * records. Each record encodes a relative (dx, dy) move in 1/10 mm via balanced
 * ternary (digit weights 1, 3, 9, 27, 81 → range ±121) plus jump/color-change
 * flag bits. The {@linkcode StitchPlan} coordinates are already in 1/10 mm; DST's
 * Y axis points up, so we negate dy.
 *
 * Validated FUNCTIONALLY EQUIVALENT to pyembroidery's `write_dst` (the oracle,
 * scripts/oracle-dst.ts): the gate compares decoded stitch penetrations + thread
 * colors, not raw bytes (headers may differ cosmetically). The machine sews the
 * same design the Python path produced, without the 10 MB runtime download.
 */

const HEADER_SIZE = 512;
/** Max delta per record (sum of the ternary weights). Caller must pre-split. */
export const DST_MAX_DELTA = 121;

/** Balanced-ternary digits of v (weights 1,3,9,27,81), each in {-1,0,1}. */
function ternary(v: number): [number, number, number, number, number] {
  const d: number[] = [0, 0, 0, 0, 0];
  let n = v;
  for (let i = 0; i < 5; i++) {
    let r = ((n % 3) + 3) % 3; // 0,1,2
    if (r === 2) r = -1;
    d[i] = r;
    n = Math.round((n - r) / 3);
  }
  return d as [number, number, number, number, number];
}

/** Encode one relative move into a 3-byte DST record. dy is screen-down; DST is
 *  up, so the caller passes the already-negated value. */
function record(dx: number, dyUp: number, jump: boolean, colorChange: boolean): [number, number, number] {
  const X = ternary(dx);
  const Y = ternary(dyUp);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  // X axis
  if (X[0] === 1) b0 |= 0x01; else if (X[0] === -1) b0 |= 0x02; // ±1
  if (X[1] === 1) b1 |= 0x01; else if (X[1] === -1) b1 |= 0x02; // ±3
  if (X[2] === 1) b0 |= 0x04; else if (X[2] === -1) b0 |= 0x08; // ±9
  if (X[3] === 1) b1 |= 0x04; else if (X[3] === -1) b1 |= 0x08; // ±27
  if (X[4] === 1) b2 |= 0x04; else if (X[4] === -1) b2 |= 0x08; // ±81
  // Y axis
  if (Y[0] === 1) b0 |= 0x80; else if (Y[0] === -1) b0 |= 0x40; // ±1
  if (Y[1] === 1) b1 |= 0x80; else if (Y[1] === -1) b1 |= 0x40; // ±3
  if (Y[2] === 1) b0 |= 0x20; else if (Y[2] === -1) b0 |= 0x10; // ±9
  if (Y[3] === 1) b1 |= 0x20; else if (Y[3] === -1) b1 |= 0x10; // ±27
  if (Y[4] === 1) b2 |= 0x20; else if (Y[4] === -1) b2 |= 0x10; // ±81
  b2 |= 0x03; // the two low bits are always set on a real record
  if (jump) b2 |= 0x80;
  if (colorChange) b2 |= 0xc0;
  return [b0, b1, b2];
}

function writeHeaderField(buf: Uint8Array, offset: number, text: string): number {
  for (let i = 0; i < text.length; i++) buf[offset + i] = text.charCodeAt(i) & 0xff;
  return offset + text.length;
}

export interface DstHeaderInfo {
  label?: string;
}

interface TernaryStreamResult {
  /** the 3-byte records incl. the EOF record. */
  records: number[];
  stitchCount: number;
  colorChanges: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** final needle position. */
  px: number;
  py: number;
}

/** Build the Tajima ternary record stream for a plan. Mirrors pyembroidery's
 *  write_dst: every move from the current needle position is split by its
 *  larger axis into ≤121-unit segments; reaching a STITCH, the intermediate
 *  segments are JUMPs and the final segment is the stitch (the lead-in); a
 *  JUMP is all JUMPs. Between color blocks we emit TRIM + COLOR_CHANGE.
 *  `stopAsColorChange` maps a machine STOP to a color-change record — the
 *  DST-family pause convention (what pyembroidery's own DST writer does) —
 *  instead of throwing. */
function encodeTernaryStream(plan: StitchPlan, stopAsColorChange: boolean): TernaryStreamResult {
  const records: number[] = [];
  let cx = 0;
  let cy = 0;
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  let stitchCount = 0;
  let colorChanges = 0;

  let lastTrim = false;
  const push = (dx: number, dyUp: number, jump: boolean, colorChange: boolean) => {
    const [b0, b1, b2] = record(dx, dyUp, jump, colorChange);
    records.push(b0, b1, b2);
    lastTrim = false;
  };
  // TRIM sentinel — the exact 3 jump records pyembroidery writes for a trim. They
  // net to zero displacement (+2,-2 / -4,+4 / +2,-2), and pyembroidery's reader
  // collapses the pattern into a single TRIM. Position does not change.
  const emitTrim = () => {
    records.push(0x82, 0x41, 0x83, 0x82, 0x82, 0x83, 0x82, 0x41, 0x83);
    lastTrim = true;
  };
  // A zero-delta color-change record at the current position.
  const colorChangeRec = () => push(0, 0, false, true);

  // Move to (tx,ty), splitting by the larger axis into ≤DST_MAX_DELTA segments.
  // `finalStitch` true ⇒ the last segment is a stitch (intermediates are jumps);
  // false ⇒ every segment is a jump.
  const moveTo = (tx: number, ty: number, finalStitch: boolean) => {
    const x0 = cx;
    const y0 = cy;
    const dx = Math.round(tx) - x0;
    const dy = Math.round(ty) - y0;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / DST_MAX_DELTA));
    // pyembroidery rounds split points half AWAY from zero (JS Math.round is half-up).
    const rnd = (v: number) => (v < 0 ? -Math.round(-v) : Math.round(v));
    for (let i = 1; i <= n; i++) {
      const sx = x0 + rnd((dx * i) / n); // off the FIXED start, not the running pos
      const sy = y0 + rnd((dy * i) / n);
      const ddx = sx - cx;
      const ddy = sy - cy;
      const isStitch = finalStitch && i === n;
      push(ddx, -ddy, !isStitch, false); // DST Y points up → negate
      cx = sx;
      cy = sy;
      if (isStitch) {
        stitchCount++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
      }
    }
  };

  plan.blocks.forEach((block, bi) => {
    if (bi > 0) {
      if (!lastTrim) emitTrim(); // pyembroidery trims before every color change
      colorChangeRec();
      colorChanges++;
    }
    for (const cmd of block.cmds) {
      if (cmd[0] === "t") {
        if (!lastTrim) emitTrim();
        continue;
      }
      if (cmd[0] === "stop") {
        if (stopAsColorChange) {
          // The DST family has no STOP opcode; a color-change record is the
          // native pause (the machine halts for the operator either way).
          if (!lastTrim) emitTrim();
          colorChangeRec();
          colorChanges++;
          continue;
        }
        // Callers route STOP-bearing plans through the Python path. Guard,
        // don't guess.
        throw new Error("native DST: STOP command not supported");
      }
      moveTo(cmd[1], cmd[2], cmd[0] === "s");
    }
  });
  // End-of-file record.
  records.push(0x00, 0x00, 0xf3);
  return { records, stitchCount, colorChanges, minX, maxX, minY, maxY, px: cx, py: cy };
}

/** Encode a stitch plan as DST file bytes (512-byte header + ternary records). */
export function encodeDst(plan: StitchPlan, info: DstHeaderInfo = {}): Uint8Array {
  const { records, stitchCount, colorChanges, minX, maxX, minY, maxY, px, py } =
    encodeTernaryStream(plan, false);

  // Header (512 bytes, space-padded). Field formats mirror pyembroidery/Tajima.
  const header = new Uint8Array(HEADER_SIZE).fill(0x20);
  const pad = (n: number, width: number) => String(n).padStart(width, " ");
  const padSigned = (n: number, width: number) => (n >= 0 ? "+" : "-") + String(Math.abs(n)).padStart(width, " ");
  const label = (info.label ?? "Untitled").slice(0, 16).padEnd(16, " ");
  let o = 0;
  o = writeHeaderField(header, o, `LA:${label}\r`);
  o = writeHeaderField(header, o, `ST:${pad(stitchCount, 7)}\r`);
  o = writeHeaderField(header, o, `CO:${pad(colorChanges, 3)}\r`);
  o = writeHeaderField(header, o, `+X:${pad(maxX, 5)}\r`);
  o = writeHeaderField(header, o, `-X:${pad(-minX, 5)}\r`);
  o = writeHeaderField(header, o, `+Y:${pad(maxY, 5)}\r`);
  o = writeHeaderField(header, o, `-Y:${pad(-minY, 5)}\r`);
  o = writeHeaderField(header, o, `AX:${padSigned(px, 5)}\r`);
  o = writeHeaderField(header, o, `AY:${padSigned(-py, 5)}\r`);
  o = writeHeaderField(header, o, `MX:${padSigned(0, 5)}\r`);
  o = writeHeaderField(header, o, `MY:${padSigned(0, 5)}\r`);
  o = writeHeaderField(header, o, `PD:******\r`);
  header[o] = 0x1a; // EOF marker; remainder stays as spaces

  const out = new Uint8Array(HEADER_SIZE + records.length);
  out.set(header, 0);
  out.set(Uint8Array.from(records), HEADER_SIZE);
  return out;
}

/**
 * Encode a stitch plan as Tajima/Pfaff T01 bytes. T01 is the DST stitch
 * section WITHOUT the 512-byte text header — the same balanced-ternary 3-byte
 * records ending in the same EOF record. Machine STOPs (appliqué pauses) are
 * encoded as color-change records, the DST-family pause convention, so
 * appliqué designs export natively too.
 */
export function encodeT01(plan: StitchPlan): Uint8Array {
  const { records } = encodeTernaryStream(plan, true);
  return Uint8Array.from(records);
}

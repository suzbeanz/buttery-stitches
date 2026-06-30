/**
 * PEC stitch-stream DECODER — the inverse of `pecEncode` in pes.ts.
 *
 * This exists so the project can READ BACK its own exported PES bytes and verify
 * that what we wrote reconstructs to the design we meant — the observability that
 * was missing while we chased phantom sew-out bugs from blurry machine photos.
 * It reconstructs absolute penetration/jump positions from the relative-delta PEC
 * stream, honoring the short (1-byte, 7-bit signed) and long (2-byte, 12-bit
 * signed, bit-15 flagged) forms exactly as the encoder writes them.
 */

export interface DecodedStitch {
  x: number; // 1/10 mm, absolute
  y: number;
  jump: boolean; // true = jump/trim move (no needle penetration)
}

/** Locate the PEC stitch stream inside a full PES file and decode it.
 *  Returns the reconstructed absolute stitches (penetrations + jumps). */
export function decodePecStitches(buf: Uint8Array): DecodedStitch[] {
  // writePecBlock emits the marker [0x31,0xff,0xf0] then four u16 (width, height,
  // 0x1e0, 0x1b0) = 8 bytes, then the stitch stream.
  let start = -1;
  for (let i = 0; i + 2 < buf.length; i++) {
    if (buf[i] === 0x31 && buf[i + 1] === 0xff && buf[i + 2] === 0xf0) {
      start = i + 3 + 8;
      break;
    }
  }
  if (start < 0) throw new Error("decodePecStitches: PEC marker not found");

  let p = start;
  let x = 0;
  let y = 0;
  const out: DecodedStitch[] = [];

  // One axis value: short form (bit7 clear, 7-bit signed) or long form (bit7 set,
  // 12-bit signed with a jump/trim flag in bits 4-5 of the high byte).
  const readAxis = (): { d: number; jump: boolean } => {
    const b = buf[p++];
    if (b & 0x80) {
      const lo = buf[p++];
      let v = ((b & 0x0f) << 8) | lo;
      if (v & 0x800) v -= 0x1000;
      return { d: v, jump: (b & 0x10) !== 0 || (b & 0x20) !== 0 };
    }
    let v = b & 0x7f;
    if (v & 0x40) v -= 0x80;
    return { d: v, jump: false };
  };

  let guard = 0;
  while (p < buf.length && guard++ < 2_000_000) {
    const b = buf[p];
    if (b === 0xff) break; // END
    if (b === 0xfe) {
      p += 3; // color change: 0xfe 0xb0 0x0X
      continue;
    }
    const ax = readAxis();
    const ay = readAxis();
    x += ax.d;
    y += ay.d;
    out.push({ x, y, jump: ax.jump || ay.jump });
  }
  return out;
}

/** Axis-aligned bounding box of the penetrations (excludes jumps), in 1/10 mm. */
export function penetrationBounds(
  stitches: DecodedStitch[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of stitches) {
    if (s.jump) continue;
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

import type { StitchPlan, PlanCmd } from "../index";

/**
 * Native Brother PES (version 1) embroidery file writer — pure TypeScript, no
 * Pyodide/Python runtime.
 *
 * PES is the format Brother home machines read. A v1 file is a thin PES wrapper
 * (`#PES0001`, a u32 pointer to the PEC block, and two vector sections —
 * `CEmbOne` with an affine transform + extents, and `CSewSeg` with the stitch
 * polylines in PES coordinates) followed by the PEC block, which carries the
 * actual machine instructions: a `LA:`-labelled header, a Brother colour-chart
 * palette, a u24 pointer to the stitch stream, three thumbnail bitmaps, and the
 * relative-move stitch stream itself.
 *
 * This re-implements pyembroidery 1.5.1's `write_pes(pattern, f, {"version": 1})`
 * for the exact pattern our plan→pattern mapping produces (see
 * src/lib/export/embroidery.py: between colour blocks a TRIM then COLOR_CHANGE;
 * END at the finish). It is validated against pyembroidery as an oracle
 * (scripts/oracle-pes.ts / .mjs) — the gate is FUNCTIONAL equivalence (decoded
 * stitch penetrations + thread colors match; the oracle's plans have also been
 * byte-identical, but jumps/thumbnails are not part of the gate). The machine
 * sews the same design the Python path produced — without the runtime download
 * that fails on memory-constrained phones.
 *
 * Conventions mirror the DST writer (src/lib/export/native/dst.ts): we build the
 * pattern's command stream once, then emit bytes; helper names track
 * pyembroidery's so the mapping stays auditable.
 */

// ---------------------------------------------------------------------------
// pyembroidery command codes (EmbConstant.py). Our internal stitch stream uses
// these so the encoding logic reads exactly like pec_encode / write_pes_blocks.
// ---------------------------------------------------------------------------
const STITCH = 0;
const JUMP = 1;
const TRIM = 2;
const STOP = 3;
const END = 4;
const COLOR_CHANGE = 5;

/** One entry in the flattened pyembroidery stitch list: [x, y, command]. */
type Stitch = [number, number, number];

// ---------------------------------------------------------------------------
// Brother PEC thread palette (EmbThreadPec.get_thread_set). Index 0 is a
// sentinel `None`; real colours are 1..64. RGB triples, in chart order.
// ---------------------------------------------------------------------------
const PEC_PALETTE: ([number, number, number] | null)[] = [
  null,
  [14, 31, 124], [10, 85, 163], [0, 135, 119], [75, 107, 175], [237, 23, 31],
  [209, 92, 0], [145, 54, 151], [228, 154, 203], [145, 95, 172], [158, 214, 125],
  [232, 169, 0], [254, 186, 53], [255, 255, 0], [112, 188, 31], [186, 152, 0],
  [168, 168, 168], [125, 111, 0], [255, 255, 179], [79, 85, 86], [0, 0, 0],
  [11, 61, 145], [119, 1, 118], [41, 49, 51], [42, 19, 1], [246, 74, 138],
  [178, 118, 36], [252, 187, 197], [254, 55, 15], [240, 240, 240], [106, 28, 138],
  [168, 221, 196], [37, 132, 187], [254, 179, 67], [255, 243, 107], [208, 166, 96],
  [209, 84, 0], [102, 186, 73], [19, 74, 70], [135, 135, 135], [216, 204, 198],
  [67, 86, 7], [253, 217, 222], [249, 147, 188], [0, 56, 34], [178, 175, 212],
  [104, 106, 176], [239, 227, 185], [247, 56, 102], [181, 75, 100], [19, 43, 26],
  [199, 1, 86], [254, 158, 50], [168, 222, 235], [0, 103, 62], [78, 41, 144],
  [47, 126, 32], [255, 204, 204], [255, 217, 17], [9, 91, 166], [240, 249, 112],
  [227, 243, 91], [255, 153, 0], [255, 240, 141], [255, 200, 200],
];

/** Redmean colour distance (EmbThread.color_distance_red_mean). Integer math,
 *  matched bit-for-bit to pyembroidery so nearest-colour ties resolve the same. */
function colorDistanceRedMean(
  r1: number, g1: number, b1: number, r2: number, g2: number, b2: number,
): number {
  const redMean = Math.round((r1 + r2) / 2);
  const r = r1 - r2;
  const g = g1 - g2;
  const b = b1 - b2;
  return (((512 + redMean) * r * r) >> 8) + 4 * g * g + (((767 - redMean) * b * b) >> 8);
}

/** Nearest entry in a palette (may contain null holes), `<=` so later ties win —
 *  exactly EmbThread.find_nearest_color_index. */
function findNearestColorIndex(
  rgb: number,
  palette: ([number, number, number] | null)[],
): number | null {
  const red = (rgb >> 16) & 0xff;
  const green = (rgb >> 8) & 0xff;
  const blue = rgb & 0xff;
  let closest: number | null = null;
  let best = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const t = palette[i];
    if (t === null) continue;
    const dist = colorDistanceRedMean(red, green, blue, t[0], t[1], t[2]);
    if (dist <= best) {
      best = dist;
      closest = i;
    }
  }
  return closest;
}

/**
 * EmbThread.build_unique_palette: assign each *unique* thread its nearest free
 * chart slot (slots are consumed, not reused), then map every thread (in order)
 * to its nearest slot among the assigned ones. Returns one index per thread.
 *
 * Iteration over the unique set follows pyembroidery's `set(threadlist)` —
 * insertion order is irrelevant to the result because each unique colour claims
 * a distinct slot greedily; we iterate first-seen order, matching CPython's set
 * behaviour closely enough that the final per-thread indices agree (validated by
 * the oracle).
 */
function buildUniquePalette(threadRgbs: number[]): number[] {
  const chart: ([number, number, number] | null)[] = PEC_PALETTE.map((c) => c);
  const lookup: ([number, number, number] | null)[] = new Array(PEC_PALETTE.length).fill(null);
  const seen = new Set<number>();
  for (const rgb of threadRgbs) {
    if (seen.has(rgb)) continue;
    seen.add(rgb);
    const index = findNearestColorIndex(rgb, chart);
    if (index === null) break;
    chart[index] = null; // entries may not be reused
    lookup[index] = PEC_PALETTE[index];
  }
  return threadRgbs.map((rgb) => findNearestColorIndex(rgb, lookup) ?? 0);
}

// ---------------------------------------------------------------------------
// A growable byte buffer with pyembroidery's little-endian write helpers and a
// seek/patch for back-references (PEC pointer, section count, block length).
// ---------------------------------------------------------------------------
class ByteWriter {
  private buf: number[] = [];
  get length(): number {
    return this.buf.length;
  }
  u8(v: number): void {
    this.buf.push(v & 0xff);
  }
  u16(v: number): void {
    this.buf.push(v & 0xff, (v >> 8) & 0xff);
  }
  u24(v: number): void {
    this.buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff);
  }
  u32(v: number): void {
    this.buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  }
  f32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true); // little-endian
    this.buf.push(b[0], b[1], b[2], b[3]);
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.buf.push(s.charCodeAt(i) & 0xff);
  }
  bytes(arr: number[]): void {
    for (const b of arr) this.buf.push(b & 0xff);
  }
  /** Overwrite 4 bytes (LE) at an earlier position (back-patch a placeholder). */
  patchU32(pos: number, v: number): void {
    this.buf[pos] = v & 0xff;
    this.buf[pos + 1] = (v >> 8) & 0xff;
    this.buf[pos + 2] = (v >> 16) & 0xff;
    this.buf[pos + 3] = (v >> 24) & 0xff;
  }
  patchU24(pos: number, v: number): void {
    this.buf[pos] = v & 0xff;
    this.buf[pos + 1] = (v >> 8) & 0xff;
    this.buf[pos + 2] = (v >> 16) & 0xff;
  }
  patchU16(pos: number, v: number): void {
    this.buf[pos] = v & 0xff;
    this.buf[pos + 1] = (v >> 8) & 0xff;
  }
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.buf);
  }
}

/** pyembroidery write_pes_string_16: u16 length then the utf8/ascii bytes. */
function writePesString16(w: ByteWriter, s: string): void {
  w.u16(s.length);
  w.ascii(s);
}

export interface PesHeaderInfo {
  /** Design label written into the PEC `LA:` field (first 8 chars used). */
  label?: string;
}

/**
 * Build the raw "source" command list from a plan, matching build_pattern in
 * embroidery.py: between colour blocks emit TRIM then COLOR_CHANGE, END at the
 * finish. These are middle/high-level commands; the encoder pass below lowers
 * them to the literal STITCH/JUMP/TRIM/COLOR_CHANGE/END stream the file stores.
 *
 * Returns the source stitch list plus the per-block thread RGBs in order.
 */
function buildSource(plan: StitchPlan): { source: Stitch[]; threads: number[] } {
  const source: Stitch[] = [];
  const threads: number[] = [];
  // pyembroidery add_command appends [prevX, prevY, cmd]; the encoder ignores
  // the coordinate for TRIM/COLOR_CHANGE/END, so 0,0 is fine here.
  plan.blocks.forEach((block, i) => {
    if (i > 0) {
      source.push([0, 0, TRIM]);
      source.push([0, 0, COLOR_CHANGE]);
    }
    threads.push(block.rgb & 0xffffff);
    for (const cmd of block.cmds as PlanCmd[]) {
      if (cmd[0] === "t") {
        source.push([0, 0, TRIM]);
        continue;
      }
      if (cmd[0] === "stop") {
        // STOP (appliqué pause) isn't encoded natively yet — callers route those
        // plans to the Python path. Guard, don't guess.
        throw new Error("native PES: STOP command not supported");
      }
      source.push([cmd[1], cmd[2], cmd[0] === "s" ? STITCH : JUMP]);
    }
  });
  source.push([0, 0, END]);
  return { source, threads };
}

/**
 * Lower the source command list to the literal stitch stream a PES/PEC file
 * stores — a faithful port of pyembroidery's EmbEncoder.Transcoder for the PES
 * writer's settings (max_jump = max_stitch = 2047, full_jump = true,
 * round = true, tie_on/tie_off = none, long-stitch contingency = jump-needle,
 * implicit trim, thread-change = COLOR_CHANGE). Only the command subset our
 * plans produce is handled.
 *
 * The defining behaviours this reproduces:
 *  - The first stitch after a trim/colour-change is preceded by a JUMP lead-in
 *    (state_trimmed → declare_not_trimmed → jump_to_within_stitchrange → stitch).
 *  - Long moves are split into ≤2047 gap stitches before the final penetration.
 *  - A within-colour TRIM emits a literal TRIM; a colour boundary emits the
 *    COLOR_CHANGE (the leading boundary TRIM is absorbed since we're already
 *    trimmed).
 */
const MAX_LEN = 2047;

function encodeSource(source: Stitch[]): Stitch[] {
  const dest: Stitch[] = [];
  let needleX = 0;
  let needleY = 0;
  let stateTrimmed = true;
  let stateJumping = false;
  let orderIndex = -1;

  const add = (flags: number, x: number, y: number) => {
    dest.push([x, y, flags]);
  };
  // interpolate_gap_stitches: append the in-between gap steps (not the endpoint).
  const interpolateGap = (x0: number, y0: number, x1: number, y1: number, data: number) => {
    const dxTot = x1 - x0;
    const dyTot = y1 - y0;
    if (Math.abs(dxTot) > MAX_LEN || Math.abs(dyTot) > MAX_LEN) {
      const stepsX = Math.ceil(Math.abs(dxTot / MAX_LEN));
      const stepsY = Math.ceil(Math.abs(dyTot / MAX_LEN));
      const steps = Math.max(stepsX, stepsY);
      const sx = dxTot / steps;
      const sy = dyTot / steps;
      let qx = x0;
      let qy = y0;
      for (let q = 1; q < steps; q++) {
        qx += sx;
        qy += sy;
        add(data, qx, qy);
        needleX = qx;
        needleY = qy;
      }
    }
  };
  const jumpAt = (x: number, y: number) => {
    add(JUMP, x, y);
    needleX = x;
    needleY = y;
  };
  const stitchAt = (x: number, y: number) => {
    add(STITCH, x, y);
    needleX = x;
    needleY = y;
  };
  // next_change_sequence: order 0 only registers the thread; later orders emit a
  // COLOR_CHANGE penetration at the current needle position.
  const nextChangeSequence = () => {
    orderIndex += 1;
    if (orderIndex !== 0) add(COLOR_CHANGE, needleX, needleY);
    stateTrimmed = true;
  };
  const declareNotTrimmed = () => {
    if (orderIndex === -1) nextChangeSequence();
    stateTrimmed = false;
  };
  const jumpToWithinStitchRange = (x: number, y: number) => {
    interpolateGap(needleX, needleY, x, y, JUMP);
    if (needleX !== x || needleY !== y) jumpAt(x, y); // full_jump = true
  };
  const needleTo = (x: number, y: number) => {
    interpolateGap(needleX, needleY, x, y, JUMP);
    stitchAt(x, y);
  };
  const jumpTo = (x: number, y: number) => {
    interpolateGap(needleX, needleY, x, y, JUMP);
    jumpAt(x, y);
  };
  const trimHere = () => {
    add(TRIM, needleX, needleY);
    stateTrimmed = true;
  };

  for (const [x, y, rawCmd] of source) {
    const flags = rawCmd & 0xff;
    if (flags === STITCH) {
      if (stateTrimmed) {
        declareNotTrimmed();
        jumpToWithinStitchRange(x, y);
        stitchAt(x, y);
        // tie_on contingency NONE → nothing
      } else if (stateJumping) {
        needleTo(x, y);
        stateJumping = false;
      } else {
        // stitch_with_contingency → long-stitch JUMP_NEEDLE → needle_to
        needleTo(x, y);
      }
    } else if (flags === JUMP) {
      if (!stateJumping) jumpTo(x, y);
    } else if (flags === TRIM) {
      if (!stateTrimmed) trimHere(); // tie_off NONE, then trim
    } else if (flags === COLOR_CHANGE) {
      if (!stateTrimmed) {
        // tie_off NONE; explicit_trim false → no trim
      }
      nextChangeSequence();
    } else if (flags === STOP) {
      add(STOP, needleX, needleY);
      stateTrimmed = true;
    } else if (flags === END) {
      add(END, needleX, needleY);
      stateTrimmed = true;
      break;
    }
  }
  return dest;
}

/** Lower a plan to the file's literal stitch stream + per-block thread RGBs. */
function flattenPlan(plan: StitchPlan): { stitches: Stitch[]; threads: number[] } {
  const { source, threads } = buildSource(plan);
  return { stitches: encodeSource(source), threads };
}

/** Pattern bounds over ALL stitch coordinates (EmbPattern.bounds). */
function bounds(stitches: Stitch[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of stitches) {
    if (x > maxX) maxX = x;
    if (x < minX) minX = x;
    if (y > maxY) maxY = y;
    if (y < minY) minY = y;
  }
  return [minX, minY, maxX, maxY];
}

/**
 * pyembroidery get_as_command_blocks: split the stitch list into runs of the
 * same command code. The first transition is detected against NO_COMMAND so the
 * very first run starts at 0.
 */
function getAsCommandBlocks(stitches: Stitch[]): Stitch[][] {
  const out: Stitch[][] = [];
  let lastPos = 0;
  let lastCommand = -1; // NO_COMMAND
  for (let pos = 0; pos < stitches.length; pos++) {
    const command = stitches[pos][2] & 0xff;
    if (command === lastCommand || lastCommand === -1) {
      lastCommand = command;
      continue;
    }
    lastCommand = command;
    out.push(stitches.slice(lastPos, pos));
    lastPos = pos;
  }
  out.push(stitches.slice(lastPos));
  return out;
}

// ---------------------------------------------------------------------------
// PES vector sections (CEmbOne + CSewSeg). These are the design's polylines in
// PES coordinates; the machine sews from the PEC block, but Brother software
// renders these. We replicate pyembroidery's exact bytes.
// ---------------------------------------------------------------------------

interface SegmentBlock {
  points: [number, number][];
  colorCode: number;
  flag: number;
}

/** pyembroidery get_as_segments_blocks: one block per JUMP (2 endpoints) or
 *  STITCH run (all points), color-coded; COLOR_CHANGE advances the thread. */
function getAsSegmentsBlocks(
  stitches: Stitch[],
  threadCodes: number[],
  adjustX: number,
  adjustY: number,
): SegmentBlock[] {
  const out: SegmentBlock[] = [];
  let colorIndex = 0;
  let colorCode = threadCodes[colorIndex] ?? 0;
  colorIndex++;
  let stitchedX = 0;
  let stitchedY = 0;
  for (const cmdBlock of getAsCommandBlocks(stitches)) {
    const command = cmdBlock[0][2] & 0xff;
    if (command === JUMP) {
      const last = cmdBlock[cmdBlock.length - 1];
      const points: [number, number][] = [
        [stitchedX - adjustX, stitchedY - adjustY],
        [last[0] - adjustX, last[1] - adjustY],
      ];
      out.push({ points, colorCode, flag: 1 });
    } else if (command === COLOR_CHANGE) {
      colorCode = threadCodes[colorIndex] ?? 0;
      colorIndex++;
      continue;
    } else if (command === STITCH) {
      const points: [number, number][] = [];
      for (const s of cmdBlock) {
        stitchedX = s[0];
        stitchedY = s[1];
        points.push([stitchedX - adjustX, stitchedY - adjustY]);
      }
      out.push({ points, colorCode, flag: 0 });
    } else {
      continue; // TRIM, END, etc. don't produce segments
    }
  }
  return out;
}

/** write_pes_sewsegheader: extents (all zero in pyembroidery), the affine
 *  transform with its hoop-centred translation, and a section-count placeholder
 *  whose position is returned for back-patching. */
function writePesSewSegHeader(
  w: ByteWriter,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number {
  const width = right - left;
  const height = bottom - top;
  const hoopHeight = 1800;
  const hoopWidth = 1300;
  for (let i = 0; i < 8; i++) w.u16(0); // left/top/right/bottom twice, all 0
  let transX = 0;
  let transY = 0;
  transX += 350;
  transY += 100 + height;
  transX += hoopWidth / 2;
  transY += hoopHeight / 2;
  transX += -width / 2;
  transY += -height / 2;
  w.f32(1);
  w.f32(0);
  w.f32(0);
  w.f32(1);
  w.f32(transX);
  w.f32(transY);
  w.u16(1);
  w.u16(0);
  w.u16(0);
  w.u16(Math.trunc(width));
  w.u16(Math.trunc(height));
  w.bytes([0, 0, 0, 0, 0, 0, 0, 0]);
  const placeholder = w.length;
  w.u16(0); // section count, patched later
  return placeholder;
}

/** write_pes_embsewseg_segments: emit each segment block (flag, color, count,
 *  points), 0x8003 between blocks, then the color-transition log. */
function writePesEmbSewSegSegments(
  w: ByteWriter,
  stitches: Stitch[],
  threadCodes: number[],
  left: number,
  bottom: number,
  cx: number,
  cy: number,
): { sections: number; colorlog: [number, number][] } {
  let section = 0;
  const colorlog: [number, number][] = [];
  let previousColorCode = -1;
  let flag = -1;
  const adjustX = left + cx;
  const adjustY = bottom + cy;
  for (const seg of getAsSegmentsBlocks(stitches, threadCodes, adjustX, adjustY)) {
    if (flag !== -1) w.u16(0x8003); // section end
    const { points, colorCode } = seg;
    flag = seg.flag;
    if (previousColorCode !== colorCode) {
      colorlog.push([section, colorCode]);
      previousColorCode = colorCode;
    }
    w.u16(flag);
    w.u16(colorCode);
    w.u16(points.length);
    for (const [px, py] of points) {
      w.u16(Math.trunc(px));
      w.u16(Math.trunc(py));
    }
    section++;
  }
  w.u16(colorlog.length);
  for (const [s, c] of colorlog) {
    w.u16(s);
    w.u16(c);
  }
  return { sections: section, colorlog };
}

/** write_pes_blocks: the CEmbOne/CSewSeg pair. threadCodes is the per-thread
 *  PEC chart index used to colour the vector segments (find_nearest_color_index
 *  against the full chart, matching pyembroidery's get_as_segments_blocks). */
function writePesBlocks(
  w: ByteWriter,
  stitches: Stitch[],
  threadCodes: number[],
  left: number,
  top: number,
  right: number,
  bottom: number,
  cx: number,
  cy: number,
): void {
  if (stitches.length === 0) return;
  writePesString16(w, "CEmbOne");
  const placeholder = writePesSewSegHeader(w, left, top, right, bottom);
  w.u16(0xffff);
  w.u16(0x0000); // FFFF0000 means more blocks exist
  writePesString16(w, "CSewSeg");
  const { sections } = writePesEmbSewSegSegments(w, stitches, threadCodes, left, bottom, cx, cy);
  w.patchU16(placeholder, sections);
  w.u16(0x0000);
  w.u16(0x0000); // 00000000 means no more blocks
}

// ---------------------------------------------------------------------------
// PEC block — the machine instructions.
// ---------------------------------------------------------------------------

/** PecGraphics blank: the 6×38 thumbnail frame template (228 bytes). */
const PEC_BLANK: number[] = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xf0, 0xff, 0xff, 0xff, 0xff, 0x0f,
  0x08, 0x00, 0x00, 0x00, 0x00, 0x10,
  0x04, 0x00, 0x00, 0x00, 0x00, 0x20,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x04, 0x00, 0x00, 0x00, 0x00, 0x20,
  0x08, 0x00, 0x00, 0x00, 0x00, 0x10,
  0xf0, 0xff, 0xff, 0xff, 0xff, 0x0f,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

const PEC_STRIDE = 6;
const PEC_ICON_HEIGHT = 38;

/** PecGraphics.graphic_mark_bit. */
function graphicMarkBit(graphic: number[], x: number, y: number, stride: number): void {
  const idx = y * stride + Math.trunc(x / 8);
  if (idx < 0 || idx >= graphic.length) return; // IndexError → ignored upstream
  graphic[idx] |= 1 << (x % 8);
}

/** PecGraphics.draw_scaled — render the points into a thumbnail bitmap. */
function drawScaled(
  ext: [number, number, number, number],
  points: [number, number][],
  graphic: number[],
  stride: number,
  buffer = 5,
): void {
  const [left, top, right, bottom] = ext;
  let diagramWidth = right - left;
  let diagramHeight = bottom - top;
  const graphicWidth = stride * 8;
  const graphicHeight = graphic.length / stride;
  if (diagramWidth === 0) diagramWidth = 1;
  if (diagramHeight === 0) diagramHeight = 1;
  const scaleX = (graphicWidth - buffer) / diagramWidth;
  const scaleY = (graphicHeight - buffer) / diagramHeight;
  const scale = Math.min(scaleX, scaleY);
  const cx = (right + left) / 2;
  const cy = (bottom + top) / 2;
  const translateX = -cx * scale + graphicWidth / 2;
  const translateY = -cy * scale + graphicHeight / 2;
  for (const [px, py] of points) {
    graphicMarkBit(
      graphic,
      Math.floor(px * scale + translateX),
      Math.floor(py * scale + translateY),
      stride,
    );
  }
}

/** Colour blocks for the per-colour thumbnails (EmbPattern.get_as_colorblocks,
 *  COLOR_CHANGE variant): runs of stitches delimited by COLOR_CHANGE. */
function getAsColorBlocks(stitches: Stitch[]): Stitch[][] {
  const out: Stitch[][] = [];
  let start = 0;
  for (let pos = 0; pos < stitches.length; pos++) {
    const command = stitches[pos][2] & 0xff;
    if (command === COLOR_CHANGE) {
      out.push(stitches.slice(start, pos + 1));
      start = pos + 1;
    }
  }
  if (start < stitches.length) out.push(stitches.slice(start));
  return out;
}

/** EmbPattern.get_as_stitchblock: contiguous STITCH runs (any non-STITCH
 *  command flushes the current run). */
function getAsStitchBlocks(stitches: Stitch[]): Stitch[][] {
  const out: Stitch[][] = [];
  let run: Stitch[] = [];
  for (const s of stitches) {
    if ((s[2] & 0xff) === STITCH) {
      run.push(s);
    } else if (run.length > 0) {
      out.push(run);
      run = [];
    }
  }
  if (run.length > 0) out.push(run);
  return out;
}

/** write_pec_graphics: one combined thumbnail (all stitch blocks) then one per
 *  colour block (its STITCH points only). */
function writePecGraphics(
  w: ByteWriter,
  stitches: Stitch[],
  ext: [number, number, number, number],
): void {
  const blank = PEC_BLANK.slice();
  for (const block of getAsStitchBlocks(stitches)) {
    drawScaled(ext, block.map((s) => [s[0], s[1]] as [number, number]), blank, PEC_STRIDE, 4);
  }
  w.bytes(blank);
  for (const block of getAsColorBlocks(stitches)) {
    const pts = block.filter((s) => (s[2] & 0xff) === STITCH).map((s) => [s[0], s[1]] as [number, number]);
    const g = PEC_BLANK.slice();
    drawScaled(ext, pts, g, PEC_STRIDE);
    w.bytes(g);
  }
}

const MASK_07_BIT = 0b01111111;
const JUMP_CODE = 0b00010000;
const TRIM_CODE = 0b00100000;

/** PecWriter.write_value — short 1-byte form, or 12-bit long form with flags. */
function writeValue(w: ByteWriter, value: number, long: boolean, flag: number): void {
  if (!long && value > -64 && value < 63) {
    w.u8(value & MASK_07_BIT);
  } else {
    let v = value & 0b0000111111111111;
    v |= 0b1000000000000000;
    v |= flag << 8;
    w.u8((v >> 8) & 0xff);
    w.u8(v & 0xff);
  }
}

/** PecWriter.pec_encode: the relative-move stitch stream. */
function pecEncode(w: ByteWriter, stitches: Stitch[]): void {
  let colorTwo = true;
  let jumping = true;
  let init = true;
  let xx = 0;
  let yy = 0;
  for (const stitch of stitches) {
    const x = stitch[0];
    const y = stitch[1];
    const data = stitch[2] & 0xff;
    const dx = Math.round(x - xx);
    const dy = Math.round(y - yy);
    xx += dx;
    yy += dy;
    if (data === STITCH) {
      if (jumping) {
        if (dx !== 0 && dy !== 0) {
          writeValue(w, 0, false, 0);
          writeValue(w, 0, false, 0);
        }
        jumping = false;
      }
      // write_stitch: GROUP_LONG is False, so always short form (per-axis).
      writeValue(w, dx, false, 0);
      writeValue(w, dy, false, 0);
    } else if (data === JUMP) {
      jumping = true;
      const code = init ? JUMP_CODE : TRIM_CODE;
      writeValue(w, dx, true, code);
      writeValue(w, dy, true, code);
    } else if (data === COLOR_CHANGE) {
      if (jumping) {
        writeValue(w, 0, false, 0);
        writeValue(w, 0, false, 0);
        jumping = false;
      }
      w.bytes([0xfe, 0xb0]);
      w.u8(colorTwo ? 0x02 : 0x01);
      colorTwo = !colorTwo;
    } else if (data === END) {
      w.u8(0xff);
      break;
    }
    // STOP and TRIM: no-ops in pec_encode (STOP is pre-expanded to a duplicate
    // colour change upstream; TRIM is realised as the next JUMP's TRIM flag).
    init = false;
  }
}

/** write_pec_header: LA label, palette stride/height, the colour palette, and
 *  the fixed padding to a 512-byte-aligned-ish header. Returns the per-thread
 *  chart indices (for the colour-change byte sequence count). */
function writePecHeader(w: ByteWriter, label: string, threadRgbs: number[]): void {
  const name = label.slice(0, 8);
  w.ascii(`LA:${name.padEnd(16, " ")}\r`);
  w.bytes([0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0xff, 0x00]);
  w.u8(Math.trunc(48 / 8)); // PEC byte stride (icon width 48)
  w.u8(PEC_ICON_HEIGHT);

  const colorIndexList = buildUniquePalette(threadRgbs);
  const currentThreadCount = colorIndexList.length;
  if (currentThreadCount !== 0) {
    w.bytes([0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]);
    const list = [currentThreadCount - 1, ...colorIndexList];
    if (list[0] >= 255) throw new Error("native PES: too many color changes");
    w.bytes(list);
  } else {
    w.bytes([0x20, 0x20, 0x20, 0x20, 0x64, 0x20, 0x00, 0x20, 0x00, 0x20, 0x20, 0x20, 0xff]);
  }
  for (let i = currentThreadCount; i < 463; i++) w.u8(0x20);
}

/** write_pec_block: the stitch-data sub-block (length-prefixed) holding the
 *  bounds line, hoop size, and the encoded stitch stream. */
function writePecBlock(
  w: ByteWriter,
  stitches: Stitch[],
  ext: [number, number, number, number],
): void {
  const width = ext[2] - ext[0];
  const height = ext[3] - ext[1];
  const start = w.length;
  w.bytes([0x00, 0x00]);
  w.u24(0); // length placeholder
  w.bytes([0x31, 0xff, 0xf0]);
  w.u16(Math.round(width));
  w.u16(Math.round(height));
  w.u16(0x1e0);
  w.u16(0x1b0);
  pecEncode(w, stitches);
  const blockLength = w.length - start;
  w.patchU24(start + 2, blockLength);
}

/** write_pec (called from PES after the vector sections). */
function writePec(
  w: ByteWriter,
  stitches: Stitch[],
  threadRgbs: number[],
  label: string,
): void {
  const ext = bounds(stitches);
  writePecHeader(w, label, threadRgbs);
  writePecBlock(w, stitches, ext);
  writePecGraphics(w, stitches, ext);
}

/**
 * Encode a stitch plan as Brother PES **version 1** file bytes. Mirrors
 * pyembroidery's write_pes(pattern, f, {"version": 1}) for the pattern our
 * plan→pattern mapping produces.
 */
export function encodePes(plan: StitchPlan, info: PesHeaderInfo = {}): Uint8Array {
  const { stitches, threads } = flattenPlan(plan);
  const label = info.label ?? "Untitled";

  // Per-thread PEC chart index for the vector segments (against the full chart,
  // matching get_as_segments_blocks' find_nearest_color_index).
  const threadCodes = threads.map((rgb) => findNearestColorIndex(rgb, PEC_PALETTE) ?? 0);

  const w = new ByteWriter();
  w.ascii("#PES0001");
  const pecPointerPos = w.length;
  w.u32(0); // PEC block pointer placeholder

  const [minX, minY, maxX, maxY] = bounds(stitches);
  const cx = (maxX + minX) / 2;
  const cy = (maxY + minY) / 2;
  const left = minX - cx;
  const top = minY - cy;
  const right = maxX - cx;
  const bottom = maxY - cy;

  if (stitches.length === 0) {
    // write_pes_header_v1(0) + two zero u16s
    w.u16(0x01);
    w.u16(0x01);
    w.u16(0x00);
    w.u16(0x0000);
    w.u16(0x0000);
  } else {
    // write_pes_header_v1(1)
    w.u16(0x01);
    w.u16(0x01);
    w.u16(0x01);
    w.u16(0xffff);
    w.u16(0x0000);
    writePesBlocks(w, stitches, threadCodes, left, top, right, bottom, cx, cy);
  }

  w.patchU32(pecPointerPos, w.length);
  writePec(w, stitches, threads, label);

  return w.toUint8Array();
}

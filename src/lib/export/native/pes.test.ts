import { describe, it, expect } from "vitest";
import { encodePes } from "./pes";
import { splitPlanForFormat, type StitchPlan, type PlanCmd } from "../index";

/**
 * Self-consistency tests for the native PES v1 writer (no Pyodide, CI-safe). The
 * byte-level equivalence to pyembroidery is proven separately by the oracle
 * (scripts/oracle-pes.ts + .mjs, which need the Python runtime); here we decode
 * our own PEC stitch stream and confirm the stitch penetrations + colour count
 * round-trip, plus the PES/PEC header invariants.
 */

const u32 = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

const FLAG_LONG = 0x80;
const JUMP_CODE = 0x10;
const TRIM_CODE = 0x20;

function signed7(v: number): number {
  return v > 63 ? v - 128 : v;
}
function signed12(code: number): number {
  const v = code & 0x0fff;
  return v > 2047 ? v - 4096 : v;
}

interface Decoded {
  /** Absolute stitch penetrations (STITCH only), in order. */
  stitches: { x: number; y: number }[];
  /** Number of colour-change markers (0xFE 0xB0 ..) in the stream. */
  colorChanges: number;
  /** Number of trims (TRIM-flagged moves). */
  trims: number;
  /** True if the stitch stream terminates with the 0xFF end marker. */
  endsCorrectly: boolean;
}

/** Locate the PEC block and decode its relative-move stitch stream back to
 *  absolute penetrations — the inverse of pecEncode in pes.ts. */
function decodePec(bytes: Uint8Array): Decoded {
  const pecStart = u32(bytes, 8);
  // PEC header: "LA:" + 16 + 0x0D, padding, stride/height, palette, then a
  // u24 pointer (relative to its own position + 2) to the stitch data. We instead
  // locate the stitch sub-block by its fixed "0x31 0xFF 0xF0" lead and skip the
  // 4 u16 (width, height, 0x1E0, 0x1B0) that follow.
  let marker = -1;
  for (let i = pecStart; i < bytes.length - 3; i++) {
    if (bytes[i] === 0x31 && bytes[i + 1] === 0xff && bytes[i + 2] === 0xf0) {
      marker = i;
      break;
    }
  }
  if (marker < 0) throw new Error("PEC stitch marker not found");
  let i = marker + 3 + 8; // skip marker + 4 u16

  const stitches: { x: number; y: number }[] = [];
  let colorChanges = 0;
  let trims = 0;
  let endsCorrectly = false;
  let x = 0;
  let y = 0;
  for (;;) {
    if (i + 1 >= bytes.length) break;
    const v1 = bytes[i];
    const v2 = bytes[i + 1];
    if (v1 === 0xff) {
      endsCorrectly = true;
      break;
    }
    if (v1 === 0xfe && v2 === 0xb0) {
      colorChanges++;
      i += 3; // 0xFE 0xB0 <01|02>
      continue;
    }
    let jump = false;
    let trim = false;
    let dx: number;
    let dy: number;
    if (v1 & FLAG_LONG) {
      if (v1 & TRIM_CODE) trim = true;
      if (v1 & JUMP_CODE) jump = true;
      dx = signed12((v1 << 8) | v2);
      i += 2;
    } else {
      dx = signed7(v1);
      i += 1;
    }
    const w1 = bytes[i];
    if (w1 & FLAG_LONG) {
      if (w1 & TRIM_CODE) trim = true;
      if (w1 & JUMP_CODE) jump = true;
      dy = signed12((w1 << 8) | bytes[i + 1]);
      i += 2;
    } else {
      dy = signed7(w1);
      i += 1;
    }
    x += dx;
    y += dy;
    if (trim) trims++;
    if (!jump && !trim) stitches.push({ x, y });
  }
  return { stitches, colorChanges, trims, endsCorrectly };
}

const sq = (cx: number, cy: number, r: number): PlanCmd[] => [
  ["s", cx - r, cy - r], ["s", cx + r, cy - r], ["s", cx + r, cy + r], ["s", cx - r, cy + r], ["s", cx - r, cy - r],
];

/** Expected penetrations: the split plan's stitches, with each block's first
 *  stitch appearing twice (the lead-in JUMP lands on it, then the STITCH — but
 *  the lead-in is a JUMP, so only the STITCH penetration is decoded). Thus the
 *  decoded penetrations are exactly the "s" commands per block in order. */
function expectedStitches(plan: StitchPlan): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const b of plan.blocks) {
    for (const c of b.cmds) if (c[0] === "s") out.push({ x: c[1] as number, y: c[2] as number });
  }
  return out;
}

describe("encodePes (v1)", () => {
  it("round-trips stitch penetrations for a single-colour shape", () => {
    const plan: StitchPlan = { blocks: [{ rgb: 0x2050c0, cmds: sq(0, 0, 200) }] };
    const split = splitPlanForFormat(plan, "pes");
    const dec = decodePec(encodePes(split));
    expect(dec.stitches).toEqual(expectedStitches(split));
    expect(dec.endsCorrectly).toBe(true);
  });

  it("round-trips penetrations and a colour change for two colours", () => {
    const plan: StitchPlan = {
      blocks: [
        { rgb: 0xcc2020, cmds: [...sq(-300, 0, 150), ["t"]] },
        { rgb: 0x2050c0, cmds: sq(300, 0, 150) },
      ],
    };
    const split = splitPlanForFormat(plan, "pes");
    const dec = decodePec(encodePes(split));
    expect(dec.stitches).toEqual(expectedStitches(split));
    expect(dec.colorChanges).toBe(1); // one colour boundary
    expect(dec.endsCorrectly).toBe(true);
  });

  it("counts one colour change per extra block (three colours)", () => {
    const plan: StitchPlan = {
      blocks: [
        { rgb: 0xcc2020, cmds: sq(-400, 0, 120) },
        { rgb: 0x20a040, cmds: sq(0, 0, 120) },
        { rgb: 0x2050c0, cmds: sq(400, 0, 120) },
      ],
    };
    const split = splitPlanForFormat(plan, "pes");
    const dec = decodePec(encodePes(split));
    expect(dec.stitches).toEqual(expectedStitches(split));
    expect(dec.colorChanges).toBe(2);
  });

  it("splits a long stitch but preserves the original penetrations", () => {
    const plan: StitchPlan = { blocks: [{ rgb: 0x10a020, cmds: [["s", 0, 0], ["s", 1500, 0], ["s", 1500, 1500]] }] };
    const split = splitPlanForFormat(plan, "pes");
    const dec = decodePec(encodePes(split));
    // Every split penetration round-trips; the three originals are a subset.
    expect(dec.stitches).toEqual(expectedStitches(split));
    expect(dec.stitches).toEqual(expect.arrayContaining([
      { x: 0, y: 0 }, { x: 1500, y: 0 }, { x: 1500, y: 1500 },
    ]));
  });

  it("writes the #PES0001 magic and a valid PEC pointer", () => {
    const bytes = encodePes({ blocks: [{ rgb: 0, cmds: [["s", 0, 0], ["s", 50, 0]] }] });
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 8))).toBe("#PES0001");
    const pec = u32(bytes, 8);
    expect(pec).toBeGreaterThan(12);
    expect(pec).toBeLessThan(bytes.length);
    // PEC header begins with the "LA:" label field at the pointer.
    expect(new TextDecoder("latin1").decode(bytes.slice(pec, pec + 3))).toBe("LA:");
  });

  it("stores a self-consistent PEC stitch-block length", () => {
    const bytes = encodePes(splitPlanForFormat({ blocks: [{ rgb: 0x123456, cmds: sq(0, 0, 100) }] }, "pes"));
    const pec = u32(bytes, 8);
    // The stitch sub-block: after the LA header (LA: + 16 + 0x0D = 20 bytes, then
    // fixed padding) the block length is a u24 two bytes into the sub-block. We
    // verify it by walking from the "0x31 0xFF 0xF0" marker: the length stored at
    // (markerStart - 3 + 2) should reach to the graphics that follow.
    let marker = -1;
    for (let i = pec; i < bytes.length - 3; i++) {
      if (bytes[i] === 0x31 && bytes[i + 1] === 0xff && bytes[i + 2] === 0xf0) { marker = i; break; }
    }
    // Sub-block layout: 0x00 0x00 <u24 len> 0x31 0xFF 0xF0 ... so the marker sits
    // 5 bytes into the sub-block and the length is two bytes in.
    const subBlockStart = marker - 5;
    const len = u24(bytes, subBlockStart + 2);
    expect(len).toBeGreaterThan(0);
    expect(subBlockStart + len).toBeLessThanOrEqual(bytes.length);
  });

  it("throws on an appliqué STOP (caller routes those to the Python path)", () => {
    expect(() => encodePes({ blocks: [{ rgb: 0, cmds: [["s", 0, 0], ["stop"]] }] })).toThrow();
  });
});

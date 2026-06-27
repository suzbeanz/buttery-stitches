import { describe, it, expect } from "vitest";
import { encodeDst } from "./dst";
import { splitPlanForFormat, type StitchPlan, type PlanCmd } from "../index";

/**
 * Self-consistency tests for the native DST writer (no Pyodide, CI-safe). The
 * byte-level equivalence to pyembroidery is proven separately by the oracle
 * (`scripts/oracle-dst.ts`, needs the Python runtime); here we decode our own
 * output and confirm the stitch penetrations round-trip, plus header invariants.
 */

const HEADER = 512;

/** Inverse of the encoder's record(): decode a 3-byte DST record. */
function decodeRecord(b0: number, b1: number, b2: number) {
  let x = 0;
  let yUp = 0;
  if (b0 & 0x01) x += 1;
  if (b0 & 0x02) x -= 1;
  if (b1 & 0x01) x += 3;
  if (b1 & 0x02) x -= 3;
  if (b0 & 0x04) x += 9;
  if (b0 & 0x08) x -= 9;
  if (b1 & 0x04) x += 27;
  if (b1 & 0x08) x -= 27;
  if (b2 & 0x04) x += 81;
  if (b2 & 0x08) x -= 81;
  if (b0 & 0x80) yUp += 1;
  if (b0 & 0x40) yUp -= 1;
  if (b1 & 0x80) yUp += 3;
  if (b1 & 0x40) yUp -= 3;
  if (b0 & 0x20) yUp += 9;
  if (b0 & 0x10) yUp -= 9;
  if (b1 & 0x20) yUp += 27;
  if (b1 & 0x10) yUp -= 27;
  if (b2 & 0x20) yUp += 81;
  if (b2 & 0x10) yUp -= 81;
  return { dx: x, dy: -yUp, jump: !!(b2 & 0x80), color: !!(b2 & 0x40) };
}

/** Decode a DST file back to absolute stitch points (penetrations only). */
function decodeStitches(bytes: Uint8Array): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let cx = 0;
  let cy = 0;
  for (let i = HEADER; i + 3 <= bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    if (b0 === 0 && b1 === 0 && b2 === 0xf3) break; // END
    const { dx, dy, jump, color } = decodeRecord(b0, b1, b2);
    cx += dx;
    cy += dy;
    if (!jump && !color) pts.push({ x: cx, y: cy });
  }
  return pts;
}

function headerText(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes.slice(0, HEADER));
}

const square: PlanCmd[] = [
  ["s", -200, -200], ["s", 200, -200], ["s", 200, 200], ["s", -200, 200], ["s", -200, -200],
];

describe("encodeDst", () => {
  it("round-trips stitch penetrations for a single-color shape", () => {
    const plan: StitchPlan = { blocks: [{ rgb: 0x2050c0, cmds: square }] };
    const split = splitPlanForFormat(plan, "dst");
    const bytes = encodeDst(split);
    const decoded = decodeStitches(bytes);
    const expected = split.blocks[0].cmds.filter((c) => c[0] === "s").map((c) => ({ x: c[1] as number, y: c[2] as number }));
    expect(decoded).toEqual(expected);
  });

  it("writes a 512-byte header with the expected fields", () => {
    const bytes = encodeDst({ blocks: [{ rgb: 0, cmds: [["s", 0, 0], ["s", 50, 0]] }] });
    const h = headerText(bytes);
    expect(h.startsWith("LA:Untitled")).toBe(true);
    expect(h).toContain("ST:");
    expect(h).toContain("CO:");
    expect(bytes.length % 1).toBe(0);
    expect(bytes.length).toBeGreaterThan(HEADER);
  });

  it("ends with the DST end-of-file record", () => {
    const bytes = encodeDst({ blocks: [{ rgb: 0, cmds: [["s", 0, 0]] }] });
    expect([bytes[bytes.length - 3], bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0, 0, 0xf3]);
  });

  it("records one color change per extra block", () => {
    const plan: StitchPlan = {
      blocks: [
        { rgb: 0xcc0000, cmds: square },
        { rgb: 0x0000cc, cmds: square },
      ],
    };
    const bytes = encodeDst(splitPlanForFormat(plan, "dst"));
    const co = headerText(bytes).match(/CO:\s*(\d+)/);
    expect(co?.[1]).toBe("1");
  });

  it("throws on an appliqué STOP (caller routes those to the Python path)", () => {
    expect(() => encodeDst({ blocks: [{ rgb: 0, cmds: [["s", 0, 0], ["stop"]] }] })).toThrow();
  });
});

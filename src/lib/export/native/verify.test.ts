import { describe, it, expect } from "vitest";
import { encodeDst, encodeT01 } from "./dst";
import { encodePes } from "./pes";
import { verifyTernaryBytes, verifyPesBytes, ExportVerifyError } from "./verify";
import { splitPlanForFormat, type StitchPlan, type PlanCmd } from "../index";

/**
 * The export-time self-check: decode-back verification must PASS on everything
 * the writers produce and FAIL loudly on corrupted bytes — that's the whole
 * point (a corrupt file should never reach the user's machine silently).
 */

const square: PlanCmd[] = [
  ["s", 0, 0], ["s", 400, 0], ["s", 400, 400], ["s", 0, 400], ["s", 0, 0],
];

const twoColor: StitchPlan = {
  blocks: [
    { rgb: 0xcc0000, cmds: square },
    { rgb: 0x0000cc, cmds: [["s", 100, 100], ["t"], ["s", 300, 300], ["s", 300, 100]] },
  ],
};

const withStop: StitchPlan = {
  blocks: [{ rgb: 0xcc0000, cmds: [["s", 0, 0], ["s", 200, 0], ["stop"], ["s", 200, 200]] }],
};

describe("verifyTernaryBytes", () => {
  it("passes on freshly encoded DST (multi-color, trims)", () => {
    const split = splitPlanForFormat(twoColor, "dst");
    expect(() => verifyTernaryBytes(encodeDst(split), split)).not.toThrow();
  });

  it("passes on a STOP-bearing DST plan (STOP counted as a color change)", () => {
    const split = splitPlanForFormat(withStop, "dst");
    expect(() => verifyTernaryBytes(encodeDst(split), split)).not.toThrow();
  });

  it("passes on freshly encoded T01", () => {
    const split = splitPlanForFormat(withStop, "t01");
    expect(() => verifyTernaryBytes(encodeT01(split), split)).not.toThrow();
  });

  it("catches a stitch record corrupted into a jump", () => {
    const split = splitPlanForFormat(twoColor, "dst");
    const bytes = encodeDst(split);
    // Find the first real stitch record (b2 high bits clear) and flag it as a
    // jump — the penetration count in the file no longer matches the plan.
    for (let i = 512; i + 3 <= bytes.length; i += 3) {
      if ((bytes[i + 2] & 0xc0) === 0 && bytes[i + 2] !== 0xf3) {
        bytes[i + 2] |= 0x80;
        break;
      }
    }
    expect(() => verifyTernaryBytes(bytes, split)).toThrow(ExportVerifyError);
  });

  it("catches truncated output (missing stitches)", () => {
    const split = splitPlanForFormat(twoColor, "dst");
    const bytes = encodeDst(split);
    // Chop off the last records and re-terminate: fewer penetrations than planned.
    const cut = bytes.slice(0, bytes.length - 9);
    cut[cut.length - 3] = 0;
    cut[cut.length - 2] = 0;
    cut[cut.length - 1] = 0xf3;
    expect(() => verifyTernaryBytes(cut, split)).toThrow(ExportVerifyError);
  });
});

describe("verifyPesBytes", () => {
  it("passes on freshly encoded PES v1", () => {
    const split = splitPlanForFormat(twoColor, "pes");
    expect(() => verifyPesBytes(encodePes(split), split)).not.toThrow();
  });

  it("catches a corrupted PEC stitch stream", () => {
    const split = splitPlanForFormat(twoColor, "pes");
    const bytes = encodePes(split);
    // Locate the PEC stitch stream (marker 31 ff f0 + 8 bytes) and stomp a run of
    // axis bytes — decoded penetrations drift off the planned bounds.
    for (let i = 0; i + 2 < bytes.length; i++) {
      if (bytes[i] === 0x31 && bytes[i + 1] === 0xff && bytes[i + 2] === 0xf0) {
        for (let k = 0; k < 6; k++) bytes[i + 11 + k] = 0x3f; // large positive short-form deltas
        break;
      }
    }
    expect(() => verifyPesBytes(bytes, split)).toThrow(ExportVerifyError);
  });
});

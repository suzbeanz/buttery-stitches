import { describe, it, expect } from "vitest";
import { splitPlanForFormat, MAX_STITCH_TENTHS, type StitchPlan, type PlanCmd } from "./index";

/** Longest move (in tenths) between consecutive coordinate commands in a block. */
function longestMove(cmds: PlanCmd[]): number {
  let px = 0;
  let py = 0;
  let have = false;
  let max = 0;
  for (const c of cmds) {
    if (c[0] === "t" || c[0] === "stop") continue;
    const [, x, y] = c;
    if (have) max = Math.max(max, Math.hypot(x - px, y - py));
    px = x;
    py = y;
    have = true;
  }
  return max;
}

const plan = (cmds: PlanCmd[]): StitchPlan => ({ blocks: [{ rgb: 0, cmds }] });

describe("splitPlanForFormat", () => {
  it("splits a stitch longer than the DST max (12.1mm) into legal sub-stitches", () => {
    const p = plan([
      ["s", 0, 0],
      ["s", 400, 0], // 40mm — way over 12.1mm
    ]);
    const out = splitPlanForFormat(p, "dst");
    expect(longestMove(out.blocks[0].cmds)).toBeLessThanOrEqual(MAX_STITCH_TENTHS.dst + 1e-6);
    // endpoints preserved
    const cmds = out.blocks[0].cmds;
    expect(cmds[0]).toEqual(["s", 0, 0]);
    expect(cmds[cmds.length - 1]).toEqual(["s", 400, 0]);
  });

  it("splits long jumps too, keeping the jump type", () => {
    const out = splitPlanForFormat(plan([["s", 0, 0], ["j", 0, 500]]), "dst");
    const inserted = out.blocks[0].cmds.filter((c) => c[0] === "j");
    expect(inserted.length).toBeGreaterThan(1);
    expect(inserted.every((c) => c[0] === "j")).toBe(true);
    expect(longestMove(out.blocks[0].cmds)).toBeLessThanOrEqual(MAX_STITCH_TENTHS.dst + 1e-6);
  });

  it("leaves short moves and trims untouched", () => {
    const cmds: PlanCmd[] = [["s", 0, 0], ["t"], ["s", 50, 50]];
    const out = splitPlanForFormat(plan(cmds), "dst");
    expect(out.blocks[0].cmds).toEqual(cmds);
  });

  it("uses the binary-format limit (12.7mm) for pes/jef/vp3", () => {
    expect(MAX_STITCH_TENTHS.pes).toBe(127);
    const out = splitPlanForFormat(plan([["s", 0, 0], ["s", 130, 0]]), "pes");
    // 13mm > 12.7mm → must split
    expect(out.blocks[0].cmds.length).toBe(3);
    expect(longestMove(out.blocks[0].cmds)).toBeLessThanOrEqual(MAX_STITCH_TENTHS.pes + 1e-6);
  });

  it("is deterministic", () => {
    const p = plan([["s", 0, 0], ["s", 333, 211]]);
    expect(splitPlanForFormat(p, "dst")).toEqual(splitPlanForFormat(p, "dst"));
  });
});

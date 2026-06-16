import { describe, it, expect } from "vitest";
import { generateDesign } from "./index";
import { makeObject } from "../objects";
import { createEmptyProject } from "../project";
import type { Project } from "../../types/project";

/** Learned from real PES files: pros connect nearby same-color shapes with a
 *  continuous travel run, not a jump/trim. */
function twoLines(gap: number): Project {
  const a = makeObject("running", [{ x: 0, y: 0 }, { x: 5, y: 0 }], "c1");
  const b = makeObject("running", [{ x: 5 + gap, y: 0 }, { x: 10 + gap, y: 0 }], "c1");
  return { ...createEmptyProject(), objects: [a, b] };
}

describe("travel-run routing", () => {
  it("connects a close same-color gap with a stitched travel (no jump/trim)", () => {
    const design = generateDesign(twoLines(6), { lockStitches: false }); // 6mm gap (<8 woven trim)
    expect(design.some((s) => s.jump)).toBe(false);
    expect(design.some((s) => s.trim)).toBe(false);
    // The travel adds intermediate penetrations between the two lines.
    const between = design.filter((s) => !s.jump && s.x > 5 && s.x < 11);
    expect(between.length).toBeGreaterThan(0);
  });

  it("still trims a far same-color gap", () => {
    const design = generateDesign(twoLines(40), { lockStitches: false }); // 40mm > trim threshold
    expect(design.some((s) => s.jump && s.trim)).toBe(true);
  });
});

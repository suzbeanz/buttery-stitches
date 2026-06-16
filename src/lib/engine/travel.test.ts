import { describe, it, expect } from "vitest";
import { generateDesign } from "./index";
import { makeObject, makeObjectFromPaths } from "../objects";
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

describe("underpath travel under coverage", () => {
  const trims = (d: ReturnType<typeof generateDesign>) => d.filter((s) => s.trim).length;
  // c1 dots 28mm apart (> trim threshold); a later c2 fill either covers the
  // connecting path or sits off to the side. When covered, the connector hides
  // under the fill → travel (no trim); otherwise it must trim.
  function withFill(covering: boolean): Project {
    const a = makeObject("running", [{ x: 0, y: 0 }, { x: 2, y: 0 }], "c1");
    const b = makeObject("running", [{ x: 28, y: 0 }, { x: 30, y: 0 }], "c1");
    const box = covering
      ? [{ x: -5, y: -6 }, { x: 40, y: -6 }, { x: 40, y: 6 }, { x: -5, y: 6 }]
      : [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 140 }, { x: 100, y: 140 }];
    const fill = makeObjectFromPaths("fill", [box], "c2");
    const p = createEmptyProject();
    p.colors = [{ id: "c1", rgb: [0, 0, 0] }, { id: "c2", rgb: [200, 0, 0] }];
    p.objects = [a, b, fill];
    return p;
  }

  it("routes a hidden travel under a later fill instead of trimming", () => {
    expect(trims(generateDesign(withFill(true), { lockStitches: false }))).toBeLessThan(
      trims(generateDesign(withFill(false), { lockStitches: false })),
    );
  });
});

import { describe, it, expect } from "vitest";
import { generateDesign } from "./index";
import { createEmptyProject } from "../project";
import { makeObjectFromPaths } from "../objects";
import type { Path } from "../../types/project";

/** Stitch-time color-seam underlap: generateDesign extends each earlier-sewn
 *  fill under (or across a small drawn gap to) its later-sewn neighbours, on
 *  CLONES — the drawn shapes never change. This is what guarantees no bare
 *  fabric hairline along any color boundary, for every project regardless of
 *  how it was authored. */

const rect = (x0: number, y0: number, x1: number, y1: number): Path => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

describe("stitch-time color-seam underlap", () => {
  it("sews the earlier fill past a shared color boundary; drawn paths stay pristine", () => {
    const a = makeObjectFromPaths("fill", [rect(0, 0, 20, 20)], "c-red");
    const b = makeObjectFromPaths("fill", [rect(20, 0, 35, 20)], "c-blue");
    const project = { ...createEmptyProject(), objects: [a, b] };
    const before = JSON.stringify([a.paths, b.paths]);
    const design = generateDesign(project);
    // The user's objects are untouched — underlap applies to stitch clones.
    expect(JSON.stringify([a.paths, b.paths])).toBe(before);
    // Stitches of the earlier (red) object reach past the x=20 boundary.
    const redMax = Math.max(...design.filter((s) => s.colorId === "c-red").map((s) => s.x));
    expect(redMax).toBeGreaterThan(20.2);
    // The later (blue) object still owns its side.
    const blueMin = Math.min(...design.filter((s) => s.colorId === "c-blue").map((s) => s.x));
    expect(blueMin).toBeLessThan(20.5);
  });

  it("bridges a small drawn gap between color regions", () => {
    const a = makeObjectFromPaths("fill", [rect(0, 0, 20, 20)], "c-red");
    const b = makeObjectFromPaths("fill", [rect(20.6, 0, 35, 20)], "c-blue");
    const project = { ...createEmptyProject(), objects: [a, b] };
    const design = generateDesign(project);
    const redMax = Math.max(...design.filter((s) => s.colorId === "c-red").map((s) => s.x));
    // Red crosses the 0.6mm bare gap and tucks under blue.
    expect(redMax).toBeGreaterThan(20.7);
  });
});

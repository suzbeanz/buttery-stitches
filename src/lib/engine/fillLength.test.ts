import { describe, it, expect } from "vitest";
import { generateObjectRuns } from "./index";
import { makeShapeObject } from "../shapes";

/** Batch 3 — per-fill along-row stitch length. */
const stitchPts = (o: ReturnType<typeof makeShapeObject>) =>
  generateObjectRuns(o)
    .filter((r) => !r.underlay)
    .reduce((n, r) => n + r.pts.length, 0);

describe("fill stitch length", () => {
  it("shorter along-row stitches produce more penetrations", () => {
    const longS = makeShapeObject("rectangle", { width: 40, height: 40 }, "c1");
    longS.params = { density: 0.5, fillStitchLength: 5, underlay: false };
    const shortS = makeShapeObject("rectangle", { width: 40, height: 40 }, "c1");
    shortS.params = { density: 0.5, fillStitchLength: 2, underlay: false };
    expect(stitchPts(shortS)).toBeGreaterThan(stitchPts(longS));
  });
});

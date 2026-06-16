import { describe, it, expect } from "vitest";
import { generateObjectRuns } from "./index";
import { makeObjectFromPaths } from "../objects";
import type { Path } from "../../types/project";

/** Phase F — bean / triple running stitch. */

const line: Path = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
];

describe("bean / triple running stitch", () => {
  it("a single (default) running line makes one pass", () => {
    const obj = makeObjectFromPaths("running", [line], "c1");
    const single = generateObjectRuns(obj).find((r) => !r.underlay)!;
    const obj3 = makeObjectFromPaths("running", [line], "c1");
    obj3.params = { stitchLength: 2.5, beanRepeats: 3 };
    const triple = generateObjectRuns(obj3).find((r) => !r.underlay)!;
    // Triple retraces the line ~3× → roughly 3× the penetrations.
    expect(triple.pts.length).toBeGreaterThan(single.pts.length * 2);
  });

  it("a bean line ends where it started its last forward pass (odd repeats)", () => {
    const obj = makeObjectFromPaths("running", [line], "c1");
    obj.params = { stitchLength: 2.5, beanRepeats: 3 };
    const run = generateObjectRuns(obj).find((r) => !r.underlay)!;
    const last = run.pts[run.pts.length - 1];
    expect(last.x).toBeCloseTo(10, 5); // finishes at the far end
  });

  it("never punches two CONSECUTIVE coincident penetrations", () => {
    const obj = makeObjectFromPaths("running", [line], "c1");
    obj.params = { stitchLength: 2.5, beanRepeats: 5 };
    const run = generateObjectRuns(obj).find((r) => !r.underlay)!;
    for (let i = 1; i < run.pts.length; i++) {
      const d = Math.hypot(run.pts[i].x - run.pts[i - 1].x, run.pts[i].y - run.pts[i - 1].y);
      expect(d).toBeGreaterThan(0.05);
    }
  });
});

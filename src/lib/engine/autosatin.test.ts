import { describe, it, expect } from "vitest";
import { generateDesign, generateObjectRuns } from "./index";
import { createEmptyProject } from "../project";
import { makeObjectFromPaths } from "../objects";
import type { Path } from "../../types/project";

/** AUTO fill style on a NARROW plain fill (a pole, a stem): the engine must lay
 *  satin ACROSS the column, not a few lengthwise tatami cords. */

const rect = (w: number, h: number): Path => [
  { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
];

/** Fraction of consecutive stitch segments that throw ACROSS the column
 *  (|dx| spans most of the width) — satin ≈ high, lengthwise rows ≈ ~0. */
function acrossFraction(pts: { x: number; y: number }[], width: number): number {
  let across = 0, total = 0;
  for (let i = 1; i < pts.length; i++) {
    total++;
    if (Math.abs(pts[i].x - pts[i - 1].x) > width * 0.6) across++;
  }
  return total ? across / total : 0;
}

describe("auto satin for narrow plain fills", () => {
  it("sews a 3mm-wide column as satin across, not lengthwise rows", () => {
    const o = makeObjectFromPaths("fill", [rect(3, 50)], "c1"); // params untouched → AUTO
    const runs = generateObjectRuns(o);
    const body = runs.filter((r) => !r.underlay).flatMap((r) => r.pts);
    expect(body.length).toBeGreaterThan(120); // satin pitch ≈ 2·50/0.4 ≈ 250; tatami cords ≈ 90
    // split-satin staggers a mid-column penetration into half the throws, so
    // ~half the segments span the full width and the rest half of it.
    expect(acrossFraction(body, 3)).toBeGreaterThan(0.4);
  });

  it("keeps a broad region as tatami (auto tries satin only when narrow)", () => {
    const o = makeObjectFromPaths("fill", [rect(30, 30)], "c1");
    const runs = generateObjectRuns(o);
    const body = runs.filter((r) => !r.underlay).flatMap((r) => r.pts);
    // Tatami rows: consecutive deltas rarely span the full 30mm width.
    expect(acrossFraction(body, 30)).toBeLessThan(0.3);
  });

  it("an explicit tatami choice is respected even on a narrow column", () => {
    const o = makeObjectFromPaths("fill", [rect(3, 50)], "c1");
    o.params = { fillStyle: "tatami" };
    const runs = generateObjectRuns(o);
    const body = runs.filter((r) => !r.underlay).flatMap((r) => r.pts);
    expect(acrossFraction(body, 3)).toBeLessThan(0.2); // lengthwise rows, not satin throws
  });
});

describe("no mid-color thread drags", () => {
  it("walks the underlay→body connector of a long column instead of jumping", () => {
    // A 3mm × 70mm column: the underlay ends at one end and the satin body
    // starts back at the other — a ~70mm same-color connector. Emitted as a
    // "trim" jump, a home machine (no mid-color cutter) DRAGS a loose thread
    // down the whole design; the connector must be a stitched travel, buried
    // under the satin sewn right after. Jumps may only appear at the very
    // start of the design (initial positioning).
    const o = makeObjectFromPaths("fill", [rect(3, 70)], "c1");
    const design = generateDesign({ ...createEmptyProject(), objects: [o] });
    const midJumps = design.filter((s, i) => i > 0 && (s.jump || s.trim));
    expect(midJumps).toEqual([]);
  });
});

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

describe("broad solids never auto-turn", () => {
  it("fills a wide solid mound (with a pole notch) as straight tatami, not curved sweeps", () => {
    // The traced golf mound after feature-stacking: one solid ~92×37mm ellipse
    // whose boundary carries a deep narrow notch (the pole) and a cup-shaped
    // meander. The notch inflates perimeter-based width metrics into calling
    // the shape a band; the inscribed-thickness gate must keep it flat tatami —
    // one dominant grain — because turned sweeps on a broad solid read as a swirl.
    const ring: Path = [
      { x: 9.4, y: 60.8 }, { x: 9.7, y: 71.1 }, { x: 8.8, y: 71.4 }, { x: 8.8, y: 73.6 },
      { x: 11.4, y: 75.6 }, { x: 15.1, y: 76.3 }, { x: 19.5, y: 75.4 }, { x: 21.2, y: 73.8 },
      { x: 21.7, y: 72.3 }, { x: 20.6, y: 70.5 }, { x: 18.3, y: 69.4 }, { x: 14.9, y: 68.8 },
      { x: 11.8, y: 69.2 }, { x: 11.7, y: 59.3 }, { x: 22.8, y: 55.6 }, { x: 30.8, y: 54.1 },
      { x: 42.6, y: 53.1 }, { x: 53.5, y: 53.4 }, { x: 67.0, y: 55.3 }, { x: 79.8, y: 59.3 },
      { x: 85.7, y: 62.8 }, { x: 89.5, y: 66.4 }, { x: 91.6, y: 70.5 }, { x: 91.0, y: 74.1 },
      { x: 87.6, y: 77.6 }, { x: 81.6, y: 81.5 }, { x: 74.9, y: 84.1 }, { x: 65.1, y: 86.8 },
      { x: 49.6, y: 89.4 }, { x: 34.3, y: 90.3 }, { x: 21.5, y: 89.3 }, { x: 11.6, y: 86.5 },
      { x: 7.0, y: 83.9 }, { x: 3.2, y: 80.7 }, { x: 0.7, y: 76.4 }, { x: -0.1, y: 73.1 },
      { x: 0.0, y: 70.0 }, { x: 1.9, y: 66.6 }, { x: 5.0, y: 63.3 }, { x: 8.9, y: 61.0 },
    ];
    const o = makeObjectFromPaths("fill", [ring], "c1");
    const runs = generateObjectRuns(o);
    const body = runs.filter((r) => !r.underlay).flatMap((r) => r.pts);
    expect(body.length).toBeGreaterThan(500);
    // Grain histogram: bucket segment angles (mod 180°) into 12 bins; straight
    // tatami concentrates in one bin, turned/flow rows spread across many.
    const bins = new Array(12).fill(0);
    let n = 0;
    for (let i = 1; i < body.length; i++) {
      const dx = body[i].x - body[i - 1].x;
      const dy = body[i].y - body[i - 1].y;
      if (Math.hypot(dx, dy) < 1) continue;
      const ang = ((Math.atan2(dy, dx) + Math.PI) % Math.PI) / Math.PI; // 0..1
      bins[Math.min(11, Math.floor(ang * 12))]++;
      n++;
    }
    const dominant = Math.max(...bins) / n;
    expect(dominant).toBeGreaterThan(0.5);
  });
});

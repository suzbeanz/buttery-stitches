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

  it("a tiny serpentine glyph is NOT flattened into one dot block", () => {
    // A real 3.6×4.6mm 'S' from a crest's small lettering: single compact
    // ring, ~roundish bbox stats — it FOOLS isSmallRoundFill, but one straight
    // satin block across it leaves the hooks bare and crisscrosses the bends
    // (this exact bug garbled the crest's 4mm text). The dot shortcut must
    // prove coverage and fall through to the medial columns, which trace the
    // serpentine cleanly.
    const sGlyph: Path = [
      { x: 1.16, y: 0.91 }, { x: 0.79, y: 1.1 }, { x: 0.6, y: 2.39 }, { x: 0.82, y: 3.67 },
      { x: 1.21, y: 3.63 }, { x: 1.69, y: 0.61 }, { x: 1.95, y: 0.27 }, { x: 2.78, y: 0.1 },
      { x: 3.4, y: 0.68 }, { x: 3.6, y: 2.85 }, { x: 3.43, y: 3.7 }, { x: 2.89, y: 4.38 },
      { x: 2.47, y: 4.49 }, { x: 2.38, y: 4.15 }, { x: 2.87, y: 2.64 }, { x: 2.59, y: 1 },
      { x: 2.25, y: 1.21 }, { x: 1.82, y: 4.23 }, { x: 1.51, y: 4.54 }, { x: 0.66, y: 4.59 },
      { x: 0.07, y: 3.97 }, { x: 0, y: 0.93 }, { x: 0.83, y: 0 }, { x: 1.19, y: 0.03 },
    ];
    const o = makeObjectFromPaths("fill", [sGlyph], "c1");
    o.params.fillStyle = "satin";
    const runs = generateObjectRuns(o);
    const body = runs.filter((r) => !r.underlay);
    // The medial serpentine's throws never exceed the ~1mm stroke width (plus
    // pull comp); the dot block's crisscross threw 4mm diagonals across the
    // whole glyph (residual patches then hid the bare hooks from a coverage
    // check — throw length is the honest signature).
    let maxSeg = 0;
    for (const r of body) {
      for (let i = 1; i < r.pts.length; i++) {
        maxSeg = Math.max(maxSeg, Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y));
      }
    }
    expect(maxSeg).toBeLessThanOrEqual(2);
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

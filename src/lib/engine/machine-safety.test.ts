import { describe, it, expect } from "vitest";
import { makeShapeObject } from "../shapes";
import { makeObjectFromPaths } from "../objects";
import { generateDesign, countStitches, type EngineStitch } from "./index";
import { createEmptyProject } from "../project";
import { railsFromCenterline } from "../geometry";
import type { Project } from "../../types/project";

/**
 * A tool that jams machines is useless. These tests assert the two failure modes
 * that actually clog an embroidery machine never reach the stitch-out:
 *   1. THREAD BUILDUP — consecutive penetrations punching (nearly) the same hole;
 *   2. OVER-DENSE FILLS — packing rows tighter than the needle can clear.
 */

/** Smallest gap between consecutive REAL penetrations of the same object (mm). */
function minStitchGap(design: EngineStitch[]): number {
  let m = Infinity;
  for (let i = 1; i < design.length; i++) {
    const a = design[i - 1];
    const b = design[i];
    if (a.jump || b.jump || a.objectId !== b.objectId) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > 0) m = Math.min(m, d);
  }
  return m;
}

function projectWith(...objects: Project["objects"]): Project {
  return { ...createEmptyProject(), objects };
}

describe("machine safety: no thread buildup", () => {
  it("a tight satin ring never punches sub-minimum stitches on the inner curve", () => {
    // A 5 mm-radius centerline with a 4 mm column → a 3 mm inner radius: the
    // worst case for density compensation bunching the concave rail.
    const center = Array.from({ length: 64 }, (_, i) => {
      const a = (2 * Math.PI * i) / 64;
      return { x: 30 + 5 * Math.cos(a), y: 30 + 5 * Math.sin(a) };
    });
    const [l, r] = railsFromCenterline(center, 4, true);
    const ring = makeObjectFromPaths("satin", [l, r], createEmptyProject().colors[0].id);
    const design = generateDesign(projectWith(ring));
    expect(countStitches(design)).toBeGreaterThan(0);
    expect(minStitchGap(design)).toBeGreaterThanOrEqual(0.25);
  });

  it("dense script-like satin stays above the buildup threshold", () => {
    // A serpentine satin column that doubles back (tight curvature both ways).
    const center = Array.from({ length: 60 }, (_, i) => ({
      x: 10 + i * 0.6,
      y: 30 + 6 * Math.sin(i * 0.5),
    }));
    const [l, r] = railsFromCenterline(center, 3);
    const wiggle = makeObjectFromPaths("satin", [l, r], "c1");
    const design = generateDesign(projectWith(wiggle));
    expect(minStitchGap(design)).toBeGreaterThanOrEqual(0.25);
  });
});

describe("machine safety: over-dense fills are clamped, not packed", () => {
  it("a reckless 0.02 mm density fill is clamped to a safe row spacing", () => {
    const o = makeShapeObject("ellipse", { width: 30, height: 30 }, "c1");
    o.params = { density: 0.02 }; // user dragged density to nonsense
    const design = generateDesign(projectWith(o));
    // Clamped to ~0.3 mm rows → on the order of ~900 stitches, not many thousands.
    expect(countStitches(design)).toBeLessThan(2000);
    expect(minStitchGap(design)).toBeGreaterThanOrEqual(0.25);
  });

  it("a knit fabric multiplier can't push density past the safe floor", () => {
    const o = makeShapeObject("ellipse", { width: 30, height: 30 }, "c1");
    o.params = { density: 0.3 };
    // knit ×0.9 would give 0.27 mm — below the floor; must be clamped up.
    const design = generateDesign({ ...projectWith(o), fabric: "knit" });
    expect(minStitchGap(design)).toBeGreaterThanOrEqual(0.25);
  });
});

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

describe("machine safety: junk params never hang or OOM the tab", () => {
  // These params are user-editable AND stored verbatim in a .embproj, so a
  // hand-edited/corrupt file reaches the engine unchecked. A zero, negative, or
  // non-finite STEP length made the stepping loops never advance (or diverge) →
  // the tab OOMed before a single stitch. Each must now finish in bounded time
  // with a bounded, finite stitch-out. (A hang would time the test out.)
  const sq = (x: number, y: number, s: number) => [
    { x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s },
  ];
  const finiteAndBounded = (design: EngineStitch[]) => {
    expect(design.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y))).toBe(true);
    expect(countStitches(design)).toBeLessThan(200000);
  };
  function fill(params: Record<string, unknown>, ring = sq(10, 10, 40)) {
    const o = makeObjectFromPaths("fill", [ring], "c1");
    o.params = { ...o.params, ...params };
    return generateDesign(projectWith(o));
  }
  function run(params: Record<string, unknown>, path = [{ x: 0, y: 0 }, { x: 40, y: 0 }]) {
    const o = makeObjectFromPaths("running", [path], "c1");
    o.params = { ...o.params, ...params };
    return generateDesign(projectWith(o));
  }
  function satin(params: Record<string, unknown>) {
    const o = makeObjectFromPaths(
      "satin",
      [[{ x: 0, y: 0 }, { x: 40, y: 0 }], [{ x: 0, y: 4 }, { x: 40, y: 4 }]],
      "c1",
    );
    o.params = { ...o.params, ...params };
    return generateDesign(projectWith(o));
  }

  it("a zero fill stitch length is floored, not looped forever", () => {
    const design = fill({ fillStitchLength: 0 });
    expect(countStitches(design)).toBeGreaterThan(0);
    finiteAndBounded(design);
  });

  it("a negative fill stitch length is floored", () => finiteAndBounded(fill({ fillStitchLength: -5 })));

  it("a zero running stitch length is floored", () => {
    const design = run({ stitchLength: 0 });
    expect(countStitches(design)).toBeGreaterThan(0);
    finiteAndBounded(design);
  });

  it("a negative running stitch length is floored", () => finiteAndBounded(run({ stitchLength: -2 })));

  it("a NaN satin density is coerced (no raw TypeError)", () => {
    const design = satin({ density: NaN });
    expect(countStitches(design)).toBeGreaterThan(0);
    finiteAndBounded(design);
  });

  it("an astronomical pull comp yields bounded satin rows", () => finiteAndBounded(satin({ pullComp: 1e6 })));

  it("a billion bean repeats is clamped to a sane count", () => finiteAndBounded(run({ beanRepeats: 1e9 })));
});

describe("machine safety: degenerate geometry is skipped, not stitched", () => {
  const sq = (x: number, y: number, s: number) => [
    { x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s },
  ];
  function fillPaths(ring: { x: number; y: number }[]) {
    return generateDesign(projectWith(makeObjectFromPaths("fill", [ring], "c1")));
  }

  it("an Infinity coordinate produces no stitches (never steps to infinity)", () => {
    expect(countStitches(fillPaths([{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 40, y: 40 }]))).toBe(0);
  });

  it("a NaN coordinate never leaks a non-finite penetration", () => {
    const design = fillPaths([{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 40, y: 40 }]);
    expect(design.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y))).toBe(true);
  });

  it("an astronomically large object (1e12 mm) is skipped, not stepped", () => {
    expect(countStitches(fillPaths(sq(0, 0, 1e12)))).toBe(0);
  });

  it("a normal design of the same shape still stitches (guard isn't over-broad)", () => {
    expect(countStitches(fillPaths(sq(10, 10, 40)))).toBeGreaterThan(0);
  });
});

describe("machine safety: compensation yields at the hoop boundary", () => {
  it("pull-comp overshoot at the hoop edge is clamped onto the boundary", () => {
    // A fill flush against the hoop's left edge: pull compensation widens its
    // rows a fraction of a millimetre past x=0. That must snap onto the
    // boundary — stitches outside the hoop are a machine fault.
    const o = makeObjectFromPaths(
      "fill",
      [[{ x: 0, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 40 }, { x: 0, y: 40 }]],
      "c1",
    );
    const design = generateDesign(projectWith(o));
    for (const s of design) {
      if (s.jump || s.trim) continue;
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
    }
    // ...while spacing safety still holds on the clamped boundary line.
    expect(minStitchGap(design)).toBeGreaterThanOrEqual(0.25);
  });

  it("content genuinely placed outside the hoop is NOT masked by the clamp", () => {
    // 10mm past the edge is a layout mistake, not compensation — the validator
    // must keep seeing it.
    const o = makeObjectFromPaths(
      "fill",
      [[{ x: -14, y: 20 }, { x: 6, y: 20 }, { x: 6, y: 40 }, { x: -14, y: 40 }]],
      "c1",
    );
    const design = generateDesign(projectWith(o));
    expect(design.some((s) => !s.jump && !s.trim && s.x < -1)).toBe(true);
  });
});

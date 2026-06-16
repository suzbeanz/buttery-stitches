import { describe, it, expect } from "vitest";
import type { Path, Project } from "../../types/project";
import { createEmptyProject } from "../project";
import { makeObject, makeObjectFromPaths } from "../objects";
import { generateDesign, generateObjectRuns, countStitches, countColorChanges } from "./index";
import { validateDesign, LIMITS } from "./validate";

function projectWith(...objs: Project["objects"]): Project {
  const p = createEmptyProject();
  // ensure two colors exist
  p.colors = [
    { id: "c1", rgb: [0, 0, 0] },
    { id: "c2", rgb: [255, 0, 0] },
  ];
  p.objects = objs;
  return p;
}

describe("generateDesign", () => {
  it("produces an empty design for an empty project", () => {
    expect(generateDesign(createEmptyProject())).toEqual([]);
  });

  it("skips hidden objects", () => {
    const o = makeObject("running", [{ x: 0, y: 0 }, { x: 10, y: 0 }], "c1");
    o.visible = false;
    expect(generateDesign(projectWith(o))).toEqual([]);
  });

  it("jumps between the disjoint regions of one multi-region fill", () => {
    // Two separate squares in a single fill object, far apart, same color.
    const fill = makeObjectFromPaths(
      "fill",
      [
        [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
        [{ x: 60, y: 60 }, { x: 70, y: 60 }, { x: 70, y: 70 }, { x: 60, y: 70 }],
      ],
      "c1",
    );
    const design = generateDesign(projectWith(fill), { lockStitches: false });
    // A jump separates the two regions even though it's one object/color.
    const jumps = design.filter((s) => s.jump);
    expect(jumps.length).toBeGreaterThanOrEqual(1);
    expect(jumps.every((s) => s.objectId === fill.id)).toBe(true);
    expect(countColorChanges(design)).toBe(0);
  });

  it("inserts a trimming jump on a color change", () => {
    const a = makeObject("running", [{ x: 0, y: 0 }, { x: 5, y: 0 }], "c1");
    const b = makeObject("running", [{ x: 40, y: 40 }, { x: 45, y: 40 }], "c2");
    const design = generateDesign(projectWith(a, b));
    expect(countColorChanges(design)).toBe(1);
    const jump = design.find((s) => s.jump);
    expect(jump).toBeTruthy();
    expect(jump!.trim).toBe(true);
  });

  it("counts penetrations excluding jumps", () => {
    const a = makeObject("running", [{ x: 0, y: 0 }, { x: 10, y: 0 }], "c1");
    const design = generateDesign(projectWith(a));
    expect(countStitches(design)).toBe(design.filter((s) => !s.jump).length);
  });
});

describe("lock / tie stitches", () => {
  const single = () =>
    projectWith(makeObject("running", [{ x: 0, y: 0 }, { x: 10, y: 0 }], "c1"));

  it("adds a tie-in and tie-off to a single thread run (7 extra penetrations)", () => {
    const plain = generateDesign(single(), { lockStitches: false });
    const locked = generateDesign(single(), { lockStitches: true });
    // One cluster = 4 penetrations at each end (8), but the tie-in ends exactly
    // on the run's first point, so that one same-hole punch is collapsed → 7.
    expect(countStitches(locked) - countStitches(plain)).toBe(7);
  });

  it("is on by default", () => {
    const a = makeObject("running", [{ x: 0, y: 0 }, { x: 10, y: 0 }], "c1");
    expect(countStitches(generateDesign(projectWith(a)))).toBe(
      countStitches(generateDesign(projectWith(a), { lockStitches: true })),
    );
  });

  it("places the tie-in cluster at the run's first penetration", () => {
    const locked = generateDesign(single(), { lockStitches: true });
    // First four real penetrations are the tie-in, hugging the start point.
    const first = locked.filter((s) => !s.jump).slice(0, 4);
    for (const s of first) {
      expect(Math.hypot(s.x - 0, s.y - 0)).toBeLessThanOrEqual(0.8 + 1e-6);
    }
  });

  it("inserts a tie-off before every trim", () => {
    const a = makeObject("running", [{ x: 0, y: 0 }, { x: 5, y: 0 }], "c1");
    const b = makeObject("running", [{ x: 40, y: 40 }, { x: 45, y: 40 }], "c2");
    const locked = generateDesign(projectWith(a, b), { lockStitches: true });
    const trimIdx = locked.findIndex((s) => s.trim);
    expect(trimIdx).toBeGreaterThan(0);
    // The four events just before the trim are the tie-off, near object a's
    // last penetration (5, 0), and carry object a's color.
    const before = locked.slice(trimIdx - 4, trimIdx);
    for (const s of before) {
      expect(s.jump).toBeFalsy();
      expect(s.colorId).toBe("c1");
      expect(Math.hypot(s.x - 5, s.y - 0)).toBeLessThanOrEqual(0.8 + 1e-6);
    }
  });

  it("ties are real penetrations, never jumps", () => {
    const locked = generateDesign(single(), { lockStitches: true });
    const plainCount = generateDesign(single(), { lockStitches: false }).length;
    const extra = locked.filter((s) => !s.jump).length - plainCount;
    expect(extra).toBe(7); // 8 tie penetrations minus the collapsed same-hole punch
    expect(locked.filter((s) => s.jump)).toHaveLength(0); // single run, no travel
  });
});

describe("satin density is preserved (not thinned by the min-stitch floor)", () => {
  it("keeps the dense throws of a satin column instead of culling every other one", () => {
    // A straight 4 mm-wide, 24 mm-long satin column at 0.4 mm density. Its
    // down-rail steps are ~0.4 mm — below the 0.5 mm general floor. If the floor
    // were applied to satin it would drop half the penetrations and shred the
    // column; the satin floor (0.15 mm) must keep them.
    const left: Path = [{ x: 0, y: 0 }, { x: 0, y: 24 }];
    const right: Path = [{ x: 4, y: 0 }, { x: 4, y: 24 }];
    const obj = makeObjectFromPaths("satin", [left, right], "c1");
    obj.params = { density: 0.4, underlay: false };
    const runs = generateObjectRuns(obj);
    const top = runs.find((r) => !r.underlay)!;
    // ~24 mm / 0.4 ≈ 60 throws × 2 rail points ≈ 120 penetrations. Applying the
    // 0.5 mm general floor would cull the ~0.4 mm down-rail steps and roughly
    // halve this to ~60; the satin floor keeps the column dense.
    expect(top.pts.length).toBeGreaterThan(100);
  });
});

describe("validateDesign", () => {
  it("flags stitches outside the hoop", () => {
    const p = createEmptyProject();
    // a line that runs well past the hoop edge
    const o = makeObject(
      "running",
      [{ x: 0, y: 0 }, { x: p.hoop.wMm + 50, y: 0 }],
      p.colors[0].id,
    );
    p.objects = [o];
    const warnings = validateDesign(generateDesign(p), p);
    expect(warnings.some((w) => /outside/i.test(w.message))).toBe(true);
  });

  it("flags a too-high fill density", () => {
    const p = createEmptyProject();
    const o = makeObject(
      "fill",
      [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
      p.colors[0].id,
    );
    o.params = { density: LIMITS.minDensity - 0.1 };
    p.objects = [o];
    const warnings = validateDesign(generateDesign(p), p);
    expect(warnings.some((w) => /puckering/i.test(w.message))).toBe(true);
  });

  it("flags a satin column wider than the safe max", () => {
    const p = createEmptyProject();
    // Explicit rails 9 mm apart — wider than LIMITS.maxSatinWidth (7 mm).
    const left = [{ x: 10, y: 10 }, { x: 40, y: 10 }];
    const right = [{ x: 10, y: 19 }, { x: 40, y: 19 }];
    const o = makeObjectFromPaths("satin", [left, right], p.colors[0].id, "Wide bar");
    p.objects = [o];
    const warnings = validateDesign(generateDesign(p), p);
    expect(warnings.some((w) => /sews loose|wider than/i.test(w.message))).toBe(true);
  });

  it("flags a large fill with underlay turned off", () => {
    const p = createEmptyProject();
    const o = makeObjectFromPaths(
      "fill",
      [[
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
      ]],
      p.colors[0].id,
      "Big patch",
    );
    o.params = { underlay: false };
    p.objects = [o];
    const warnings = validateDesign(generateDesign(p), p);
    expect(warnings.some((w) => /underlay off/i.test(w.message))).toBe(true);
  });

  it("does not flag a large fill when underlay is on", () => {
    const p = createEmptyProject();
    const o = makeObjectFromPaths(
      "fill",
      [[
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
      ]],
      p.colors[0].id,
      "Big patch",
    );
    o.params = { underlay: true };
    p.objects = [o];
    const warnings = validateDesign(generateDesign(p), p);
    expect(warnings.some((w) => /underlay off/i.test(w.message))).toBe(false);
  });

  it("is quiet for a clean design", () => {
    const p = createEmptyProject();
    const o = makeObject("running", [{ x: 10, y: 10 }, { x: 30, y: 10 }], p.colors[0].id);
    p.objects = [o];
    expect(validateDesign(generateDesign(p), p)).toEqual([]);
  });

  it("never emits two coincident penetrations in a row (no same-hole punches)", () => {
    // A filled square with lock stitches: the tie clusters and fill spans must
    // not leave a 0 mm stitch where the needle would punch the same hole.
    const fill = makeObjectFromPaths(
      "fill",
      [[
        { x: 0, y: 0 },
        { x: 24, y: 0 },
        { x: 24, y: 24 },
        { x: 0, y: 24 },
      ]],
      "c1",
    );
    const design = generateDesign(projectWith(fill));
    let coincident = 0;
    for (let i = 1; i < design.length; i++) {
      const a = design[i - 1];
      const b = design[i];
      if (a.jump || b.jump || a.colorId !== b.colorId) continue;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-4) coincident++;
    }
    expect(coincident).toBe(0);
  });
});

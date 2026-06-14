import { describe, it, expect } from "vitest";
import type { Project } from "../../types/project";
import { createEmptyProject } from "../project";
import { makeObject } from "../objects";
import { generateDesign, countStitches, countColorChanges } from "./index";
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

  it("adds a tie-in and tie-off to a single thread run (8 extra penetrations)", () => {
    const plain = generateDesign(single(), { lockStitches: false });
    const locked = generateDesign(single(), { lockStitches: true });
    // One cluster = 4 penetrations; one at the start, one at the end.
    expect(countStitches(locked) - countStitches(plain)).toBe(8);
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
    expect(extra).toBe(8);
    expect(locked.filter((s) => s.jump)).toHaveLength(0); // single run, no travel
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

  it("is quiet for a clean design", () => {
    const p = createEmptyProject();
    const o = makeObject("running", [{ x: 10, y: 10 }, { x: 30, y: 10 }], p.colors[0].id);
    p.objects = [o];
    expect(validateDesign(generateDesign(p), p)).toEqual([]);
  });
});

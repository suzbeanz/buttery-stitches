import { describe, it, expect } from "vitest";
import type { Project } from "../../types/project";
import { createEmptyProject } from "../project";
import { makeObject } from "../objects";
import { generateDesign, countStitches, countColorChanges } from "./index";
import { validateDesign, LIMITS } from "./validate";

function projectWith(...objs: Project["objects"]): Project {
  const p = createEmptyProject();
  // ensure two colours exist
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

  it("inserts a trimming jump on a colour change", () => {
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

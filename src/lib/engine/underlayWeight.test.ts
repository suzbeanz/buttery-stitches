import { describe, it, expect } from "vitest";
import { generateObjectRuns } from "./index";
import { makeShapeObject } from "../shapes";
import { fabricProfile } from "../../types/project";

/** Batch 3 — per-object underlay weight override. */

const underlayRuns = (o: ReturnType<typeof makeShapeObject>) =>
  generateObjectRuns(o).filter((r) => r.underlay).length;

describe("per-object underlay weight", () => {
  it("a heavier override lays more underlay than a lighter one (same fabric)", () => {
    const light = makeShapeObject("ellipse", { width: 30, height: 30 }, "c1");
    light.params = { underlay: true, underlayWeight: "light" };
    const heavy = makeShapeObject("ellipse", { width: 30, height: 30 }, "c1");
    heavy.params = { underlay: true, underlayWeight: "heavy" };
    expect(underlayRuns(heavy)).toBeGreaterThan(underlayRuns(light));
  });

  it('"auto" follows the fabric profile', () => {
    const o = makeShapeObject("ellipse", { width: 30, height: 30 }, "c1");
    o.params = { underlay: true, underlayWeight: "auto" };
    const explicit = makeShapeObject("ellipse", { width: 30, height: 30 }, "c1");
    explicit.params = { underlay: true, underlayWeight: fabricProfile("woven").underlay };
    expect(underlayRuns(o)).toBe(underlayRuns(explicit));
  });
});

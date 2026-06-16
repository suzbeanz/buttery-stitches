import { describe, it, expect } from "vitest";
import { effectiveProfile } from "./profile";
import { FABRICS } from "../../types/project";

describe("effectiveProfile", () => {
  it("returns the plain fabric profile at the 40wt baseline", () => {
    const p = effectiveProfile("woven", 40);
    expect(p.densityMul).toBeCloseTo(FABRICS.woven.densityMul, 10);
    expect(p.pullMul).toBe(FABRICS.woven.pullMul);
    expect(p.underlay).toBe(FABRICS.woven.underlay);
    expect(p.stitchLenMul).toBe(FABRICS.woven.stitchLenMul);
  });

  it("defaults to woven + 40wt when fabric/weight are undefined", () => {
    const p = effectiveProfile(undefined, undefined);
    expect(p.densityMul).toBeCloseTo(FABRICS.woven.densityMul, 10);
  });

  it("tightens rows for fine 60wt thread and opens for bold 30wt", () => {
    expect(effectiveProfile("woven", 60).densityMul).toBeCloseTo(0.72, 10);
    expect(effectiveProfile("woven", 30).densityMul).toBeCloseTo(1.15, 10);
    // denser than baseline for 60wt, looser for 30wt
    expect(effectiveProfile("woven", 60).densityMul).toBeLessThan(1);
    expect(effectiveProfile("woven", 30).densityMul).toBeGreaterThan(1);
  });

  it("composes thread weight on top of the fabric density multiplier", () => {
    // knit base 0.9 × 60wt 0.72
    expect(effectiveProfile("knit", 60).densityMul).toBeCloseTo(0.9 * 0.72, 10);
  });

  it("leaves pull and underlay to the fabric (thread weight doesn't touch them)", () => {
    const knit = effectiveProfile("knit", 60);
    expect(knit.pullMul).toBe(FABRICS.knit.pullMul);
    expect(knit.underlay).toBe(FABRICS.knit.underlay);
  });
});

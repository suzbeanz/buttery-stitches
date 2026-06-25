import { describe, it, expect } from "vitest";
import { CORPUS } from "./corpus";
import { benchMetrics } from "./metrics";

/**
 * Guards the curvature-aware row spacing on the guidance-field fill. A curve's
 * outer edge fans the rows apart; stepping by the median |∇u| left ~87% coverage
 * there. Stepping by a low percentile (the spread-most spot) lifts it to ~95%+.
 * The threshold sits well above the old 87% so a regression to median stepping
 * fails here.
 */
describe("curved-fill coverage", () => {
  it("keeps a curved band well covered (no fan gaps on the outer edge)", () => {
    const proj = CORPUS.find((c) => c.name === "crescent-field")!.project;
    const cov = benchMetrics(proj).fillCoverage;
    expect(cov).not.toBeNull();
    expect(cov!).toBeGreaterThan(0.93);
  });

  it("flat fills stay essentially fully covered", () => {
    const proj = CORPUS.find((c) => c.name === "rect-fill")!.project;
    expect(benchMetrics(proj).fillCoverage!).toBeGreaterThan(0.97);
  });

  it("contour rings cover (no jitter gaps between echo loops)", () => {
    const proj = CORPUS.find((c) => c.name === "disc-fill-contour")!.project;
    expect(benchMetrics(proj).fillCoverage!).toBeGreaterThan(0.95);
  });
});

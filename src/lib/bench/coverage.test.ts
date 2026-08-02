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
    // Honest 0.3mm-thread metric: the directional field fill covers ~0.92 here; the
    // remaining gap is the curved-band connector quality tracked as a follow-up.
    expect(cov!).toBeGreaterThan(0.92);
  });

  it("the turned-row crescent covers ≥0.95 (cap closure + adaptive row pitch)", () => {
    // Was 0.930: caps lost their last rows to the long-chord reject, the outer
    // edge starved on the bend (fixed stations along the spine), and the 0.5mm
    // short-stitch floor ate every row's turnaround penetration. The strict-
    // coverage arbitration now also lets these rows beat the field fill when
    // they genuinely cover more.
    const proj = CORPUS.find((c) => c.name === "crescent-turning")!.project;
    expect(benchMetrics(proj).fillCoverage!).toBeGreaterThan(0.95);
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

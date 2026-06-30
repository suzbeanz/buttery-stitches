import { describe, it, expect } from "vitest";
import { buildTestSwatch } from "./swatch";
import { designFor } from "../engine";
import { fillCoverage } from "../bench/metrics";

/**
 * Coverage regression: the default fill density must keep the calibration swatch's
 * fills solidly covered under the HONEST 0.3mm-thread metric (a stabilized muslin
 * sew-out at the old 0.35mm default showed clear gaps; tightening the default to
 * 0.30mm lifted measured coverage from ~87% to ~95%).
 */
describe("swatch fill coverage (default density)", () => {
  it("covers ≥92% under the honest thread metric", () => {
    const p = buildTestSwatch();
    const cov = fillCoverage(p, designFor(p));
    expect(cov).not.toBeNull();
    expect(cov!).toBeGreaterThan(0.92);
  });
});

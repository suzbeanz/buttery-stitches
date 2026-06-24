import { describe, it, expect } from "vitest";
import { CORPUS } from "./corpus";
import { designFor } from "../engine";
import { travelLengthMm } from "./metrics";

/**
 * Guards the global-routing optimizer (routeGroups Or-opt). On the NN-trap scatter
 * layout, greedy nearest-neighbour strands an outlier and racks up ~220 mm of
 * travel; the Or-opt pass relocates it and reaches ~150 mm. The threshold sits
 * between the two so a regression back to plain greedy NN fails the test.
 */
describe("global routing", () => {
  it("orders scattered same-colour objects well below greedy nearest-neighbour", () => {
    const proj = CORPUS.find((c) => c.name === "scatter-dots")!.project;
    const travel = travelLengthMm(designFor(proj));
    expect(travel).toBeLessThan(185);
  });

  it("keeps multi-region travel tight (orderByTravel) too", () => {
    const proj = CORPUS.find((c) => c.name === "multiregion-grid")!.project;
    const travel = travelLengthMm(designFor(proj));
    expect(travel).toBeLessThan(185);
  });

  it("enters reversible objects from the nearer end (start/end-aware)", () => {
    // Fixed start→end orientation costs ~229mm of travel on these scattered lines;
    // choosing each line's sewing direction brings it to ~149mm. The threshold
    // fails a regression to fixed-orientation routing.
    const proj = CORPUS.find((c) => c.name === "scatter-lines")!.project;
    const travel = travelLengthMm(designFor(proj));
    expect(travel).toBeLessThan(190);
  });
});

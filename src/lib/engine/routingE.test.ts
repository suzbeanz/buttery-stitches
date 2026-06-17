import { describe, it, expect } from "vitest";
import { generateDesign } from "./index";
import { makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import type { Project } from "../../types/project";

/**
 * Travel vs trim (premium clean rule): a same-color move across OPEN fabric is
 * trimmed so no thread slash shows; only a very short hop, or a connector hidden
 * under a fill, is bridged with a stitched travel.
 */
function twoLines(gapMm: number): Project {
  const a = makeObjectFromPaths("running", [[{ x: 0, y: 0 }, { x: 2, y: 0 }]], "c1");
  const b = makeObjectFromPaths("running", [[{ x: 2 + gapMm, y: 0 }, { x: 4 + gapMm, y: 0 }]], "c1");
  return { ...createEmptyProject(), objects: [a, b] };
}
const hasTrim = (p: Project, opts = {}) => generateDesign(p, opts).some((s) => s.trim);

describe("travel vs trim (clean exposed connectors)", () => {
  it("trims an exposed connector across open fabric", () => {
    expect(hasTrim(twoLines(8))).toBe(true);
  });

  it("bridges a very short exposed hop without trimming", () => {
    expect(hasTrim(twoLines(3.5))).toBe(false); // ≤ EXPOSED_TRAVEL_MAX
  });

  it("the trimThreshold option widens the exposed bridge", () => {
    expect(hasTrim(twoLines(6))).toBe(true); // default: trimmed
    expect(hasTrim(twoLines(6), { trimThreshold: 8 })).toBe(false); // widened: traveled
  });
});

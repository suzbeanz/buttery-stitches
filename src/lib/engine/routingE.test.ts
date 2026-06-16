import { describe, it, expect } from "vitest";
import { generateDesign } from "./index";
import { makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import type { Project } from "../../types/project";

/** Phase E — fabric-aware trim thresholds. */

// Two same-color running lines with a ~6 mm gap between them: longer than the
// jump threshold (so it's a jump), and right between the pile (5 mm) and woven
// (8 mm) trim thresholds — so the fabric decides whether the thread is cut.
function twoLinesGap6(fabric: Project["fabric"]): Project {
  const a = makeObjectFromPaths("running", [[{ x: 0, y: 0 }, { x: 2, y: 0 }]], "c1");
  const b = makeObjectFromPaths("running", [[{ x: 8, y: 0 }, { x: 10, y: 0 }]], "c1");
  return { ...createEmptyProject(), fabric, objects: [a, b] };
}

const hasTrim = (p: Project) => generateDesign(p).some((s) => s.trim);

describe("fabric-aware trim threshold", () => {
  it("a stable woven jumps a 6 mm connector without trimming", () => {
    expect(hasTrim(twoLinesGap6("woven"))).toBe(false);
  });

  it("napped pile trims the same 6 mm connector (buries/snags in the loops)", () => {
    expect(hasTrim(twoLinesGap6("pile"))).toBe(true);
  });

  it("an explicit trimThreshold option still overrides the fabric default", () => {
    const design = generateDesign(twoLinesGap6("woven"), { trimThreshold: 5 });
    expect(design.some((s) => s.trim)).toBe(true);
  });
});

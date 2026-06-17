import { describe, it, expect } from "vitest";
import { generateDesign } from "./index";
import { makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import type { Path } from "../../types/project";

/** Appliqué: one shape expands into placement run → STOP → tackdown → STOP →
 *  satin cover, so the operator can lay and trim the fabric between phases. */
describe("appliqué", () => {
  const ring: Path = [
    { x: 10, y: 10 },
    { x: 50, y: 10 },
    { x: 50, y: 50 },
    { x: 10, y: 50 },
  ];

  it("emits two machine STOPs and a full stitch sequence", () => {
    const o = makeObjectFromPaths("fill", [ring], "c1");
    o.params.applique = true;
    const d = generateDesign({ ...createEmptyProject(), objects: [o] }, { lockStitches: false });
    expect(d.filter((s) => s.stop).length).toBe(2);
    // placement + tackdown running passes + a satin cover band
    expect(d.filter((s) => !s.jump && !s.trim && !s.stop).length).toBeGreaterThan(20);
  });

  it("a normal fill has no STOPs", () => {
    const o = makeObjectFromPaths("fill", [ring], "c1");
    const d = generateDesign({ ...createEmptyProject(), objects: [o] }, { lockStitches: false });
    expect(d.filter((s) => s.stop).length).toBe(0);
  });
});

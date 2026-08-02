import { describe, it, expect } from "vitest";
import { explodeSatinColumns, planSatinCenterlines, generateDesign } from "./index";
import { fillCoverage } from "../bench/metrics";
import { makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import type { EmbObject, Path, Project } from "../../types/project";

/**
 * "Break apart to satin columns": the exploded pieces must sew what the
 * un-exploded object sewed — same columns, junction wedges covered by the
 * residual fill — and decline gracefully when there is nothing to explode.
 */

/** An L of two 3mm bars — a junction, so the explode has a residual wedge. */
function ell(): EmbObject {
  const ring: Path = [
    { x: 10, y: 10 },
    { x: 13, y: 10 },
    { x: 13, y: 27 },
    { x: 30, y: 27 },
    { x: 30, y: 30 },
    { x: 10, y: 30 },
  ];
  const o = makeObjectFromPaths("fill", [ring], "c1");
  o.params = { ...o.params, fillStyle: "satin" };
  o.satinCenterlines = planSatinCenterlines(o);
  return o;
}

function projectWith(objects: EmbObject[]): Project {
  return {
    ...createEmptyProject(),
    colors: [{ id: "c1", rgb: [200, 40, 40], name: "Red" }],
    objects: objects.map((o) => ({ ...o, visible: true })),
  };
}

describe("explodeSatinColumns", () => {
  it("produces satin objects (+ optional residual) from a persisted decomposition", () => {
    const src = ell();
    expect(src.satinCenterlines).toBeDefined();
    const exploded = explodeSatinColumns(src)!;
    expect(exploded).not.toBeNull();
    expect(exploded.satins.length).toBeGreaterThanOrEqual(1);
    for (const s of exploded.satins) {
      expect(s.type).toBe("satin");
      expect(s.paths).toHaveLength(2); // two rails
      expect(s.colorId).toBe("c1");
    }
  });

  it("the exploded pieces cover the source region like the original", () => {
    const src = ell();
    const before = projectWith([src]);
    const exploded = explodeSatinColumns(src)!;
    const after = projectWith([
      ...(exploded.residual ? [exploded.residual] : []),
      ...exploded.satins,
    ]);
    // Coverage of the SOURCE region by each compiled design. fillCoverage
    // needs a fill object to define the target, so measure both designs
    // against the source geometry.
    const target = projectWith([src]);
    const covBefore = fillCoverage(target, generateDesign(before))!;
    const covAfter = fillCoverage(target, generateDesign(after))!;
    expect(covBefore).toBeGreaterThan(0.85);
    expect(covAfter).toBeGreaterThan(covBefore - 0.06);
  });

  it("returns null when there is nothing to explode", () => {
    const plain = makeObjectFromPaths(
      "fill",
      [[{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]],
      "c1",
    );
    expect(explodeSatinColumns(plain)).toBeNull(); // no centerlines
    const satinNoCl = ell();
    satinNoCl.satinCenterlines = undefined;
    expect(explodeSatinColumns(satinNoCl)).toBeNull();
  });
});

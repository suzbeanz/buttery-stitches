import { describe, it, expect } from "vitest";
import { fixStitches } from "./fix";
import { planSatinCenterlines, generateObjectRuns } from "./engine";
import { satinCoverage } from "./engine/medial";
import { makeObjectFromPaths } from "./objects";
import { createEmptyProject } from "./project";
import type { EmbObject, Path } from "../types/project";

/**
 * Editable auto-satin: the engine's stitch-time decomposition is persisted as
 * `satinCenterlines` at fix/apply time, the engine's authored path consumes
 * exactly those strokes, and a user edit to a centerline changes what sews.
 */

/** A plain 20×3 mm horizontal bar at (10,10) — the canonical satin column. */
function bar(): EmbObject {
  const ring: Path = [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 13 },
    { x: 10, y: 13 },
  ];
  const o = makeObjectFromPaths("fill", [ring], "c1");
  o.params = { ...o.params, fillStyle: "satin" };
  return o;
}

function projectWith(obj: EmbObject) {
  return { ...createEmptyProject(), colors: [{ id: "c1", rgb: [200, 40, 40] as [number, number, number], name: "Red" }], objects: [obj] };
}

describe("editable auto-satin persistence", () => {
  it("fixStitches persists the engine's decomposition on satin-classified fills", () => {
    const fixed = fixStitches(projectWith(bar()));
    const o = fixed.objects[0];
    expect(o.satinCenterlines).toBeDefined();
    expect(o.satinCenterlines!.length).toBeGreaterThan(0);
    // The bar's stroke is horizontal: its centerline should run left→right
    // near y = 11.5.
    const cl = o.satinCenterlines![0];
    const ys = cl.map((p) => p.y);
    for (const y of ys) expect(Math.abs(y - 11.5)).toBeLessThan(0.8);
  });

  it("never overwrites an existing (authored/edited) decomposition", () => {
    const authored: Path[] = [[{ x: 11, y: 11.5 }, { x: 29, y: 11.5 }]];
    const o = bar();
    o.satinCenterlines = authored;
    const fixed = fixStitches(projectWith(o));
    expect(fixed.objects[0].satinCenterlines).toEqual(authored);
  });

  it("the persisted decomposition sews with the same coverage as the engine's own", () => {
    const auto = bar();
    const persisted = fixStitches(projectWith(bar())).objects[0];
    const cover = (obj: EmbObject): number => {
      const runs = generateObjectRuns(obj).filter((r) => !r.underlay);
      return satinCoverage(obj.paths, runs.map((r) => r.pts));
    };
    const a = cover(auto);
    const b = cover(persisted);
    expect(a).toBeGreaterThan(0.9);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it("editing a persisted centerline changes what sews", () => {
    const persisted = fixStitches(projectWith(bar())).objects[0];
    const edited: EmbObject = {
      ...persisted,
      // Bow the centerline downward mid-bar — the user dragged a vertex.
      satinCenterlines: [[{ x: 11, y: 11.5 }, { x: 20, y: 12.6 }, { x: 29, y: 11.5 }]],
    };
    const throwsOf = (obj: EmbObject) =>
      generateObjectRuns(obj)
        .filter((r) => !r.underlay)
        .flatMap((r) => r.pts);
    const straight = throwsOf(persisted);
    const bowed = throwsOf(edited);
    expect(straight.length).toBeGreaterThan(10);
    expect(bowed.length).toBeGreaterThan(10);
    // The rails come from the region outline either way — what the centerline
    // steers is the THROW GEOMETRY (angles/spacing). The deterministic engine
    // must produce a different penetration sequence for the edited centerline.
    expect(JSON.stringify(bowed)).not.toBe(JSON.stringify(straight));
  });

  it("planSatinCenterlines declines non-satin fills", () => {
    const broad = makeObjectFromPaths(
      "fill",
      [[{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]],
      "c1",
    );
    broad.params = { ...broad.params, fillStyle: "tatami" };
    expect(planSatinCenterlines(broad)).toBeUndefined();
  });
});

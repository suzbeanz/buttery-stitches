import { describe, it, expect } from "vitest";
import { nearestThread, matchColorsToChart, colorDistance } from "./match";
import { BUTTERY_STANDARD } from "./catalog";
import { reduceProjectColors, mergeSimilarColors } from "./reduce";
import { createEmptyProject } from "../project";
import { makeObjectFromPaths } from "../objects";
import type { Project, ThreadColor } from "../../types/project";

describe("thread matching", () => {
  it("matches a near-black to the chart's Black", () => {
    const t = nearestThread([18, 18, 20], BUTTERY_STANDARD);
    expect(t.name).toBe("Black");
  });
  it("matches a vivid blue to a blue, not a green", () => {
    const t = nearestThread([30, 80, 180], BUTTERY_STANDARD);
    expect(t.name.toLowerCase()).toContain("blue");
  });
  it("stamps brand/code/name and snaps rgb, preserving the id", () => {
    const colors: ThreadColor[] = [{ id: "c1", rgb: [200, 20, 30] }];
    const [m] = matchColorsToChart(colors, BUTTERY_STANDARD);
    expect(m.id).toBe("c1");
    expect(m.brand).toBe("Buttery Standard");
    expect(m.code).toMatch(/^BS-/);
    expect(m.rgb).not.toEqual([200, 20, 30]); // snapped to the spool
  });
  it("perceptual distance ranks a close color nearer than a far one", () => {
    expect(colorDistance([100, 100, 100], [110, 100, 100])).toBeLessThan(
      colorDistance([100, 100, 100], [10, 200, 50]),
    );
  });
});

describe("color reduction", () => {
  function proj(): Project {
    const p = createEmptyProject();
    p.colors = [
      { id: "a", rgb: [10, 10, 10] },
      { id: "b", rgb: [12, 12, 14] }, // ~black, should merge with a
      { id: "c", rgb: [220, 30, 30] }, // red
      { id: "d", rgb: [30, 40, 220] }, // blue
    ];
    p.objects = [
      makeObjectFromPaths("fill", [[{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]], "a"),
      makeObjectFromPaths("fill", [[{ x: 6, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 3 }]], "b"),
      makeObjectFromPaths("fill", [[{ x: 0, y: 6 }, { x: 5, y: 6 }, { x: 5, y: 9 }]], "c"),
      makeObjectFromPaths("fill", [[{ x: 6, y: 6 }, { x: 9, y: 6 }, { x: 9, y: 9 }]], "d"),
    ];
    return p;
  }
  it("reduces to N colors and remaps every object to a surviving color", () => {
    const out = reduceProjectColors(proj(), 3);
    expect(out.colors).toHaveLength(3);
    const ids = new Set(out.colors.map((c) => c.id));
    for (const o of out.objects) expect(ids.has(o.colorId)).toBe(true);
  });
  it("merges the two near-blacks first (perceptual)", () => {
    const out = reduceProjectColors(proj(), 3);
    // the two black objects now share one color
    const blackish = out.objects.slice(0, 2).map((o) => o.colorId);
    expect(blackish[0]).toBe(blackish[1]);
  });
  it("is a no-op when already within the limit", () => {
    const p = proj();
    expect(reduceProjectColors(p, 10)).toBe(p);
  });

  it("merge-similar collapses only the near-duplicate shades", () => {
    // The two near-blacks (ΔE ~2) merge; red and blue are far apart and survive.
    const out = mergeSimilarColors(proj(), 8);
    expect(out.colors).toHaveLength(3);
    expect(out.objects[0].colorId).toBe(out.objects[1].colorId); // the two blacks
    const ids = new Set(out.colors.map((c) => c.id));
    for (const o of out.objects) expect(ids.has(o.colorId)).toBe(true);
  });

  it("merge-similar is a no-op when nothing is within the threshold", () => {
    const out = mergeSimilarColors(proj(), 1);
    expect(out.colors).toHaveLength(4);
  });
});

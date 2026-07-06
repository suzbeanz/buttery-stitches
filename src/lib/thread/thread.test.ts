import { describe, it, expect } from "vitest";
import { nearestThread, matchColorsToChart, colorDistance, type RGB } from "./match";
import { BUTTERY_STANDARD } from "./catalog";
import { reduceProjectColors, mergeSimilarColors, consolidateFringeColors } from "./reduce";
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

describe("fringe color consolidation", () => {
  // A right triangle with legs L → outer-ring area L²/2, so L sets the color's area.
  const tri = (L: number, id: string) =>
    makeObjectFromPaths("fill", [[{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: L }]], id);
  const build = (rows: Array<[string, RGB, number]>): Project => {
    const p = createEmptyProject();
    p.colors = rows.map(([id, rgb]) => ({ id, rgb }));
    p.objects = rows.map(([id, , L]) => tri(L, id));
    return p;
  };

  it("folds a small near-duplicate shade into its large neighbor (the two-reds case)", () => {
    const out = consolidateFringeColors(
      build([
        ["red", [218, 29, 34], 100], // big flat body
        ["darkred", [155, 15, 19], 2], // tiny shadow/anti-alias sliver, ΔE≈22
        ["blue", [30, 40, 220], 100], // distinct, large
      ]),
    );
    expect(out.colors).toHaveLength(2); // darkred merged away, blue intact
    expect(out.objects[1].colorId).toBe(out.objects[0].colorId); // darkred → red
    const ids = new Set(out.colors.map((c) => c.id));
    for (const o of out.objects) expect(ids.has(o.colorId)).toBe(true); // no orphans
  });

  it("leaves two LARGE distinct colors apart even at the same ΔE", () => {
    const out = consolidateFringeColors(
      build([
        ["red", [218, 29, 34], 100],
        ["darkred", [155, 15, 19], 100], // same ΔE≈22 but now large → not fringe
      ]),
    );
    expect(out.colors).toHaveLength(2);
  });

  it("merges a true near-duplicate (ΔE≈2) regardless of size", () => {
    const out = consolidateFringeColors(
      build([
        ["a", [10, 10, 10], 100],
        ["b", [12, 12, 14], 100], // near-black twin
        ["c", [220, 30, 30], 100],
      ]),
    );
    expect(out.colors).toHaveLength(2); // a+b collapse, c survives
  });
});

describe("consolidateFringeColors respects the colour budget", () => {
  it("never fringe-merges below minColors", () => {
    // Five distinct-ish colours, several small: unbounded fringe merging used
    // to collapse a requested-5 palette to 2-3, eating real features (a dark
    // red beacon dome). With minColors it may collapse true duplicates but
    // must stop trimming at the budget.
    const mk = (id: string, rgb: [number, number, number]) => ({ id, rgb, name: id });
    const ring = (x: number) => [
      { x, y: 0 }, { x: x + 4, y: 0 }, { x: x + 4, y: 4 }, { x, y: 4 },
    ];
    const big = (x: number) => [
      { x, y: 10 }, { x: x + 30, y: 10 }, { x: x + 30, y: 40 }, { x, y: 40 },
    ];
    const project = {
      version: 1 as const,
      widthMm: 100,
      heightMm: 100,
      hoop: { wMm: 100, hMm: 100, name: "t" },
      colors: [mk("red", [219, 28, 34]), mk("darkred", [152, 17, 20]), mk("blue", [50, 95, 200]), mk("lightblue", [194, 236, 251]), mk("black", [6, 3, 3])],
      objects: [
        { id: "o1", type: "fill" as const, colorId: "red", paths: [big(0)], params: {}, visible: true },
        { id: "o2", type: "fill" as const, colorId: "darkred", paths: [ring(0)], params: {}, visible: true },
        { id: "o3", type: "fill" as const, colorId: "blue", paths: [big(40)], params: {}, visible: true },
        { id: "o4", type: "fill" as const, colorId: "lightblue", paths: [ring(10)], params: {}, visible: true },
        { id: "o5", type: "fill" as const, colorId: "black", paths: [big(80)], params: {}, visible: true },
      ],
    };
    const out = consolidateFringeColors(project as never, 5);
    expect(out.colors.length).toBe(5); // nothing under budget is trimmed
    const out3 = consolidateFringeColors(project as never, 3);
    expect(out3.colors.length).toBeGreaterThanOrEqual(3);
  });
});

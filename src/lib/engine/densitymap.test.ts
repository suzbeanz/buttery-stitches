import { describe, it, expect } from "vitest";
import { buildDensityMap, hotCells, DENSITY_CAUTION_PER_MM2 } from "./densitymap";
import { generateDesign } from "./index";
import { makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import type { EngineStitch } from "./index";

const stitch = (x: number, y: number): EngineStitch => ({ x, y, colorId: "c", objectId: "o" });

describe("density map", () => {
  it("returns null for an empty or jump-only design", () => {
    expect(buildDensityMap([])).toBeNull();
    expect(buildDensityMap([{ ...stitch(0, 0), jump: true }])).toBeNull();
  });

  it("counts penetrations per cell and flags an artificial pile-up", () => {
    // 40 penetrations into the same 1 mm cell = way past caution (12/mm²).
    const pile: EngineStitch[] = Array.from({ length: 40 }, (_, i) =>
      stitch(5 + (i % 3) * 0.1, 5 + ((i / 3) | 0) * 0.01),
    );
    const map = buildDensityMap(pile)!;
    const hot = hotCells(map);
    expect(hot.length).toBeGreaterThanOrEqual(1);
    expect(hot[0].count).toBeGreaterThan(DENSITY_CAUTION_PER_MM2);
    expect(hot[0].severity).toBeGreaterThan(0.5);
    // The hotspot localizes to where the pile actually is.
    expect(hot[0].x).toBeGreaterThan(4);
    expect(hot[0].x).toBeLessThan(7);
  });

  it("a normal single-layer fill produces no danger cells", () => {
    const o = makeObjectFromPaths(
      "fill",
      [[{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }]],
      "c1",
    );
    const p = { ...createEmptyProject(), objects: [o] };
    const design = generateDesign(p);
    const map = buildDensityMap(design)!;
    const hot = hotCells(map);
    // A healthy tatami at default density: essentially no cells past caution
    // (a few boundary cells where edge-run + rows + underlay meet are ok, but
    // none should reach danger severity 1).
    expect(hot.filter((h) => h.severity >= 1)).toHaveLength(0);
  });

  it("two identical fills stacked on top of each other DO get flagged", () => {
    const ring = [[{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }]];
    const a = makeObjectFromPaths("fill", ring, "c1");
    const b = makeObjectFromPaths("fill", ring, "c1");
    const c = makeObjectFromPaths("fill", ring, "c1");
    const p = { ...createEmptyProject(), objects: [a, b, c] };
    const design = generateDesign(p);
    const map = buildDensityMap(design)!;
    const single = buildDensityMap(
      generateDesign({ ...createEmptyProject(), objects: [makeObjectFromPaths("fill", ring, "c1")] }),
    )!;
    // Triple-stacked coverage flags materially more area than one layer.
    expect(hotCells(map).length).toBeGreaterThan(hotCells(single).length * 2);
  });
});

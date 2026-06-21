import { describe, it, expect } from "vitest";
import type { Path } from "../types/project";
import { mergeRegionPaths, splitRegionComponents } from "./regions";

/** A closed square ring with corner (x,y) and side `s` (CCW). */
function square(x: number, y: number, s = 10): Path {
  return [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
}

describe("mergeRegionPaths", () => {
  it("fuses two overlapping squares into a single component", () => {
    const merged = mergeRegionPaths([[square(0, 0)], [square(5, 5)]]);
    expect(merged.length).toBeGreaterThan(0);
    expect(splitRegionComponents(merged)).toHaveLength(1);
  });

  it("keeps two disjoint squares as two components", () => {
    const merged = mergeRegionPaths([[square(0, 0)], [square(20, 0)]]);
    expect(splitRegionComponents(merged)).toHaveLength(2);
  });

  it("returns [] for empty input", () => {
    expect(mergeRegionPaths([])).toEqual([]);
  });
});

describe("splitRegionComponents", () => {
  it("treats a single square as one (non-splittable) component", () => {
    expect(splitRegionComponents([square(0, 0)])).toHaveLength(1);
  });

  it("separates two disjoint blobs", () => {
    const comps = splitRegionComponents([square(0, 0), square(20, 0)]);
    expect(comps).toHaveLength(2);
    expect(comps.every((c) => c.length === 1)).toBe(true);
  });

  it("keeps a hole attached to its outer ring (one component)", () => {
    const outer = square(0, 0, 20);
    const hole = square(5, 5, 10);
    const comps = splitRegionComponents([outer, hole]);
    expect(comps).toHaveLength(1);
    expect(comps[0]).toHaveLength(2); // outer + its hole
  });

  it("gives each disjoint blob its own hole", () => {
    const comps = splitRegionComponents([
      square(0, 0, 20),
      square(5, 5, 10), // hole inside the first blob
      square(40, 0, 20), // a second, separate blob
    ]);
    expect(comps).toHaveLength(2);
    const sizes = comps.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 2]); // one solid blob, one blob-with-hole
  });
});

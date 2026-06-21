import { describe, it, expect } from "vitest";
import type { Path } from "../types/project";
import { mergeRegionPaths, splitRegionComponents, weldToNeighbors } from "./regions";

/** A closed square ring with corner (x,y) and side `s` (CCW). */
function square(x: number, y: number, s = 10): Path {
  return [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
}

describe("weldToNeighbors", () => {
  const maxX = (rings: Path[]) => Math.max(...rings.flat().map((p) => p.x));

  it("grows a fill under an abutting neighbor (seamless trap)", () => {
    const target = [square(0, 0, 10)]; // shares x=10 with the neighbor
    const neighbor = [square(10, 0, 10)];
    const out = weldToNeighbors(target, [neighbor], 0.4);
    expect(maxX(out)).toBeGreaterThan(10); // tucked under the neighbor
    expect(maxX(out)).toBeLessThan(10.8); // bounded by the trap
  });

  it("returns the target unchanged when nothing is adjacent", () => {
    const target = [square(0, 0, 10)];
    expect(weldToNeighbors(target, [[square(50, 50, 10)]], 0.4)).toBe(target);
    expect(weldToNeighbors(target, [], 0.4)).toBe(target);
  });
});

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

import { describe, it, expect } from "vitest";
import type { Path } from "../../types/project";
import { satinUnderlay } from "./underlay";

describe("satinUnderlay", () => {
  it("spans the whole column even when the rails have different vertex counts", () => {
    // Left rail described with many points, right rail with only its endpoints —
    // a realistic edited/imported satin. The underlay must still run the full
    // length of the column, not stop short where the shorter rail ends.
    const left: Path = Array.from({ length: 21 }, (_, i) => ({ x: 0, y: i }));
    const right: Path = [
      { x: 4, y: 0 },
      { x: 4, y: 20 },
    ];
    const out = satinUnderlay(left, right);
    expect(out.length).toBeGreaterThan(2);
    const ys = out.map((p) => p.y);
    // Centerline runs from y≈0 to y≈20 (full height), centered near x=2.
    expect(Math.min(...ys)).toBeLessThanOrEqual(1);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(19);
  });

  it("returns nothing for degenerate rails", () => {
    expect(satinUnderlay([{ x: 0, y: 0 }], [{ x: 1, y: 0 }])).toEqual([]);
  });
});

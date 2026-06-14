import { describe, it, expect } from "vitest";
import { medialSatin } from "./medial";
import type { Path } from "../../types/project";

describe("medialSatin", () => {
  it("lays a satin column down a vertical stroke", () => {
    // A 4mm-wide, 30mm-tall stroke (like a letter stem).
    const stroke: Path = [
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 14, y: 40 },
      { x: 10, y: 40 },
    ];
    const runs = medialSatin([stroke], { density: 0.5 });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const pts = runs.flat();
    expect(pts.length).toBeGreaterThan(10);
    // Throws span roughly the stroke width; column runs the stroke height.
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...xs)).toBeLessThanOrEqual(16);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(15);
  });

  it("returns nothing for a degenerate tiny region", () => {
    const tiny: Path = [
      { x: 0, y: 0 },
      { x: 0.3, y: 0 },
      { x: 0.3, y: 0.3 },
      { x: 0, y: 0.3 },
    ];
    expect(medialSatin([tiny], { density: 0.5 })).toEqual([]);
  });

  it("is deterministic", () => {
    const stroke: Path = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 20 },
      { x: 0, y: 20 },
    ];
    const a = medialSatin([stroke], { density: 0.5 });
    const b = medialSatin([stroke], { density: 0.5 });
    expect(a).toEqual(b);
  });
});

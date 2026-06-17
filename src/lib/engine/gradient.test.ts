import { describe, it, expect } from "vitest";
import { tatamiFill } from "./fill";
import type { Path } from "../../types/project";

/** Gradient/ombré fill ramps row spacing across the shape (a Wilcom-style effect). */
describe("gradient fill", () => {
  const sq: Path = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ];
  const rowYs = (pts: { y: number }[]) =>
    [...new Set(pts.map((p) => Math.round(p.y * 10) / 10))];

  it("packs more rows on the dense edge than the sparse edge", () => {
    const g = tatamiFill([sq], { density: 0.4, angle: 0, gradient: 3 });
    const ys = rowYs(g);
    const dense = ys.filter((y) => y < 20).length;
    const sparse = ys.filter((y) => y >= 20).length;
    expect(dense).toBeGreaterThan(sparse * 1.4);
  });

  it("gradient 1 (or omitted) is uniform — bands roughly equal", () => {
    const ys = rowYs(tatamiFill([sq], { density: 0.4, angle: 0 }));
    const a = ys.filter((y) => y < 20).length;
    const b = ys.filter((y) => y >= 20).length;
    expect(Math.abs(a - b)).toBeLessThan(a * 0.3);
  });
});

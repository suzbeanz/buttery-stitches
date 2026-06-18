import { describe, it, expect } from "vitest";
import type { Path, Point } from "../../types/project";
import { contourFill } from "./contour";

/** A regular polygon approximating a circle. */
function circle(cx: number, cy: number, r: number, n = 72): Path {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

const dist = (p: Point, c: Point) => Math.hypot(p.x - c.x, p.y - c.y);
const C = { x: 30, y: 30 };

describe("contourFill", () => {
  it("lays concentric rings inside a disc, all penetrations within the shape", () => {
    const runs = contourFill([circle(30, 30, 20)], { density: 2, stitchLength: 3 });
    // A 20 mm radius at 2 mm spacing → several rings.
    expect(runs.length).toBeGreaterThanOrEqual(5);
    for (const run of runs) {
      for (const p of run) expect(dist(p, C)).toBeLessThanOrEqual(20.5);
    }
  });

  it("keeps stitch length along the ring bounded", () => {
    const runs = contourFill([circle(30, 30, 20)], { density: 2, stitchLength: 3 });
    let max = 0;
    for (const run of runs)
      for (let i = 1; i < run.length; i++) max = Math.max(max, dist(run[i], run[i - 1]));
    expect(max).toBeLessThanOrEqual(3 + 0.3);
  });

  it("rings get smaller toward the center", () => {
    const runs = contourFill([circle(30, 30, 20)], { density: 2.5, stitchLength: 3 });
    const radius = (run: Path) =>
      run.reduce((s, p) => s + dist(p, C), 0) / run.length;
    // Outermost ring (first) is larger than the innermost (last).
    expect(radius(runs[0])).toBeGreaterThan(radius(runs[runs.length - 1]) + 3);
  });

  it("respects a hole: no penetrations land inside the counter", () => {
    const ring: Path[] = [circle(30, 30, 20), circle(30, 30, 8)];
    const runs = contourFill(ring, { density: 2, stitchLength: 3 });
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs)
      for (const p of run) expect(dist(p, C)).toBeGreaterThan(7); // outside the 8 mm hole
  });

  it("sews a band (annulus) as a spiral: adjacent rings, no pinhead loops", () => {
    // A wide ring: the distance field peaks at the band midline, so each level
    // yields two loops (one per side). Naive level-order would hop across the band
    // on every loop; the spiral chaining keeps consecutive loops adjacent.
    const annulus: Path[] = [circle(40, 40, 35, 120), circle(40, 40, 22, 80)];
    const runs = contourFill(annulus, { density: 0.6, stitchLength: 3 });
    expect(runs.length).toBeGreaterThan(8);

    // No pinhead loops (the medial-axis maxima that collapse to a point).
    for (const run of runs) {
      let per = 0;
      for (let i = 1; i < run.length; i++) per += dist(run[i], run[i - 1]);
      expect(per).toBeGreaterThan(3);
    }

    // Consecutive loops connect with a small step (a spiral). The level-order bug
    // hopped across the band on nearly every loop; the spiral keeps the vast
    // majority adjacent (a handful of larger steps where it meets the midline).
    let smallSteps = 0;
    for (let i = 1; i < runs.length; i++) {
      const gap = dist(runs[i][0], runs[i - 1][runs[i - 1].length - 1]);
      if (gap <= 6) smallSteps++;
    }
    expect(smallSteps).toBeGreaterThan((runs.length - 1) * 0.8);
  });

  it("returns nothing for a shape too thin to seat a ring (falls back upstream)", () => {
    const sliver: Path = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 0.8 },
      { x: 0, y: 0.8 },
    ];
    expect(contourFill([sliver], { density: 2 })).toEqual([]);
  });

  it("is deterministic", () => {
    const a = contourFill([circle(30, 30, 18)], { density: 2 });
    const b = contourFill([circle(30, 30, 18)], { density: 2 });
    expect(a).toEqual(b);
  });
});

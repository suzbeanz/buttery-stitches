import { describe, it, expect } from "vitest";
import { snap } from "./snap";
import type { Bounds } from "./geometry";

const hoop = { wMm: 100, hMm: 100 };

function box(minX: number, minY: number, w: number, h: number): Bounds {
  return { minX, minY, maxX: minX + w, maxY: minY + h };
}

describe("snap", () => {
  it("snaps the moving center to the hoop center", () => {
    // 20x20 box centered at (48,52); hoop center is (50,50).
    const moving = box(38, 42, 20, 20);
    const r = snap(moving, [], hoop, 5);
    expect(r.dx).toBeCloseTo(2); // center 48 -> 50
    expect(r.dy).toBeCloseTo(-2); // center 52 -> 50
    expect(r.guidesX).toEqual([50]);
    expect(r.guidesY).toEqual([50]);
  });

  it("snaps an edge to the hoop edge (0)", () => {
    // box near the left edge: left at 1.5 -> snaps to 0.
    const moving = box(1.5, 30, 10, 10);
    const r = snap(moving, [], hoop, 3);
    expect(r.dx).toBeCloseTo(-1.5);
    expect(r.guidesX).toEqual([0]);
  });

  it("snaps edge-to-edge with another target", () => {
    // Target left edge at x=63; moving right edge at x=62 (gap 1) is the
    // closest of all candidates, so they align edge-to-edge.
    const target = box(63, 20, 20, 20);
    const moving = box(42, 70, 20, 20); // edges 42, 52, 62
    const r = snap(moving, [target], hoop, 3);
    expect(r.dx).toBeCloseTo(1); // 62 -> 63
    expect(r.guidesX).toEqual([63]);
  });

  it("snaps center-to-center with another target", () => {
    // Wide target centered at x=63 (edges 23 and 103, both far); moving center
    // at x=62 (gap 1) is the closest candidate of all.
    const target = box(23, 40, 80, 20); // center x=63
    const moving = box(57, 70, 10, 10); // edges 57, 62, 67
    const r = snap(moving, [target], hoop, 3);
    expect(r.dx).toBeCloseTo(1); // 62 -> 63
    expect(r.guidesX).toEqual([63]);
  });

  it("is a no-op when nothing is within threshold", () => {
    // Center at (33,33), far from any candidate within 1mm.
    const moving = box(23, 23, 20, 20);
    const r = snap(moving, [], hoop, 1);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.guidesX).toEqual([]);
    expect(r.guidesY).toEqual([]);
  });

  it("picks the nearest candidate when several are in range", () => {
    // Two targets whose left edges straddle the moving left edge; nearer wins.
    const near = box(11, 0, 10, 10); // left at 11
    const far = box(14, 0, 10, 10); // left at 14
    const moving = box(12, 50, 10, 10); // left at 12
    const r = snap(moving, [near, far], hoop, 5);
    expect(r.dx).toBeCloseTo(-1); // 12 -> 11 (gap 1) beats 12 -> 14 (gap 2)
    expect(r.guidesX).toEqual([11]);
  });

  it("snaps x and y independently", () => {
    // center x=50 hits the hoop center exactly (dx 0 but guide active);
    // top y=5 is 5mm from the hoop top (0), beyond the 3mm threshold -> no y snap.
    const r = snap(box(40, 5, 20, 20), [], hoop, 3);
    expect(r.dx).toBeCloseTo(0);
    expect(r.guidesX).toEqual([50]);
    expect(r.dy).toBe(0);
    expect(r.guidesY).toEqual([]);
  });

  it("is deterministic", () => {
    const moving = box(38, 42, 20, 20);
    const target = box(60, 20, 20, 20);
    const a = snap(moving, [target], hoop, 5);
    const b = snap(moving, [target], hoop, 5);
    expect(a).toEqual(b);
  });
});

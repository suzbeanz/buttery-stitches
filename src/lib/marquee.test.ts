import { describe, it, expect } from "vitest";
import {
  rectFromPoints,
  rectIntersectsBounds,
  rectSpanMm,
  marqueeSelect,
} from "./marquee";
import type { Bounds } from "./geometry";

const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("marquee", () => {
  it("normalizes corners regardless of drag direction", () => {
    expect(rectFromPoints(10, 20, 0, 5)).toEqual({ minX: 0, minY: 5, maxX: 10, maxY: 20 });
  });

  it("intersection includes grazing overlap but not separation", () => {
    const rect = rectFromPoints(0, 0, 10, 10);
    expect(rectIntersectsBounds(rect, box(5, 5, 15, 15))).toBe(true); // overlap
    expect(rectIntersectsBounds(rect, box(10, 10, 12, 12))).toBe(true); // touch corner
    expect(rectIntersectsBounds(rect, box(11, 0, 13, 10))).toBe(false); // to the right
  });

  it("selects every object the box touches, in order", () => {
    const objects = [
      { id: "a", b: box(0, 0, 4, 4) },
      { id: "b", b: box(20, 20, 24, 24) },
      { id: "c", b: box(3, 3, 6, 6) },
    ];
    const rect = rectFromPoints(2, 2, 8, 8);
    expect(marqueeSelect(rect, objects)).toEqual(["a", "c"]);
  });

  it("reports the longest side so a click can be told from a drag", () => {
    expect(rectSpanMm(rectFromPoints(0, 0, 0.2, 0.1))).toBeCloseTo(0.2);
    expect(rectSpanMm(rectFromPoints(0, 0, 3, 40))).toBeCloseTo(40);
  });
});

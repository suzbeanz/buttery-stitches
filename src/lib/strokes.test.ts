import { describe, it, expect } from "vitest";
import { autoCenterlines, nearestStrokePoint, tidyStroke } from "./strokes";
import type { Path } from "../types/project";

const bar = (x: number, y: number, w: number, h: number): Path => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

describe("strokes", () => {
  it("derives an auto centerline down a bar, per component", () => {
    const strokes = autoCenterlines([bar(0, 0, 20, 2.4), bar(0, 10, 2.4, 20)]);
    expect(strokes.length).toBeGreaterThanOrEqual(2);
    // The horizontal bar's stroke runs near y≈1.2.
    const flat = strokes.find((s) => Math.abs(s[0].y - 1.2) < 0.8);
    expect(flat).toBeTruthy();
  });

  it("finds the nearest stroke point within range", () => {
    const strokes: Path[] = [[{ x: 0, y: 0 }, { x: 10, y: 0 }]];
    expect(nearestStrokePoint(strokes, { x: 9.6, y: 0.2 }, 1)).toEqual({ stroke: 0, point: 1 });
    expect(nearestStrokePoint(strokes, { x: 5, y: 5 }, 1)).toBeNull();
  });

  it("tidies dense hand-drawn points", () => {
    const dense: Path = Array.from({ length: 50 }, (_, i) => ({ x: i * 0.1, y: 0 }));
    expect(tidyStroke(dense, 0.5).length).toBeLessThan(15);
  });
});

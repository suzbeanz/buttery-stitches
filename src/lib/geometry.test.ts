import { describe, it, expect } from "vitest";
import {
  polylineLength,
  pathsBounds,
  translatePaths,
  offsetPolyline,
  railsFromCenterline,
  dedupePath,
  centerlineOf,
  applyMatrix,
} from "./geometry";

describe("geometry", () => {
  it("measures polyline length", () => {
    expect(polylineLength([])).toBe(0);
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBeCloseTo(5);
  });

  it("computes bounds across paths", () => {
    const b = pathsBounds([
      [
        { x: 1, y: 2 },
        { x: 5, y: 2 },
      ],
      [{ x: 3, y: -1 }],
    ]);
    expect(b).toEqual({ minX: 1, minY: -1, maxX: 5, maxY: 2 });
  });

  it("translates all points", () => {
    const out = translatePaths([[{ x: 0, y: 0 }]], 2, -3);
    expect(out).toEqual([[{ x: 2, y: -3 }]]);
  });

  it("offsets a horizontal line to its left normal", () => {
    // Direction +x => left normal is (0, +1) in screen coords; offset +1 mm.
    const out = offsetPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      1,
    );
    expect(out[0].y).toBeCloseTo(1);
    expect(out[1].y).toBeCloseTo(1);
  });

  it("builds a rail pair straddling the centreline at half-width", () => {
    const [left, right] = railsFromCenterline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      4,
    );
    // rails sit ±2 mm off the centreline
    expect(Math.abs(left[0].y)).toBeCloseTo(2);
    expect(Math.abs(right[0].y)).toBeCloseTo(2);
    expect(left[0].y).toBeCloseTo(-right[0].y);
  });

  it("dedupes consecutive coincident points (double-click cleanup)", () => {
    const out = dedupePath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 }, // duplicate from a double-click
      { x: 10, y: 0 },
    ]);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("recovers the centreline from a rail pair", () => {
    const center = centerlineOf(
      [
        { x: 0, y: 2 },
        { x: 10, y: 2 },
      ],
      [
        { x: 0, y: -2 },
        { x: 10, y: -2 },
      ],
    );
    expect(center).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("applies an affine matrix (scale 2x, translate +1) to points", () => {
    // Konva matrix [a,b,c,d,e,f]: x' = a*x + c*y + e, y' = b*x + d*y + f
    const out = applyMatrix([[{ x: 3, y: 4 }]], [2, 0, 0, 2, 1, 1]);
    expect(out[0][0]).toEqual({ x: 7, y: 9 });
  });
});

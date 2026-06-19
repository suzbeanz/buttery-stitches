import { describe, it, expect } from "vitest";
import { bucketFill } from "./paintbucket";
import { pathsBounds } from "./geometry";
import type { Path } from "../types/project";

/** Batch 1 — paint-bucket flood fill. */

const square: Path = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
  { x: 0, y: 0 },
];
const bounds = { minX: -5, minY: -5, maxX: 25, maxY: 25 };

describe("bucketFill", () => {
  it("fills the inside of a closed square", () => {
    const rings = bucketFill([square], { x: 10, y: 10 }, bounds, 0.5);
    expect(rings).not.toBeNull();
    const b = pathsBounds(rings!)!;
    // The fill reaches and slightly overlaps the square's edges (no gap), so it
    // tracks the 0–20 box closely (within a small overlap/smoothing margin).
    expect(b.minX).toBeGreaterThan(-3);
    expect(b.minX).toBeLessThan(1);
    expect(b.minY).toBeGreaterThan(-3);
    expect(b.minY).toBeLessThan(1);
    expect(b.maxX).toBeLessThan(23);
    expect(b.maxX).toBeGreaterThan(19);
    expect(b.maxY).toBeLessThan(23);
    expect(b.maxY).toBeGreaterThan(19);
  });

  it("returns null when the click lands on a line", () => {
    expect(bucketFill([square], { x: 0, y: 10 }, bounds, 0.5)).toBeNull();
  });

  it("fills the surrounding area when clicking outside the square", () => {
    const rings = bucketFill([square], { x: 23, y: 23 }, bounds, 0.5);
    expect(rings).not.toBeNull();
    // The background region spans most of the working bounds.
    const b = pathsBounds(rings!)!;
    expect(b.maxX - b.minX).toBeGreaterThan(20);
  });

  it("is deterministic", () => {
    const a = bucketFill([square], { x: 10, y: 10 }, bounds, 0.5);
    const b = bucketFill([square], { x: 10, y: 10 }, bounds, 0.5);
    expect(a).toEqual(b);
  });

  it("requireEnclosed: fills a bounded click but declines an open one", () => {
    // Inside the square (enclosed) → still fills.
    expect(bucketFill([square], { x: 10, y: 10 }, bounds, 0.5, true)).not.toBeNull();
    // Outside the square, where the flood reaches the working-area edge → null,
    // so the unified Fill tool draws an outline instead of flooding the background.
    expect(bucketFill([square], { x: 23, y: 23 }, bounds, 0.5, true)).toBeNull();
  });
});

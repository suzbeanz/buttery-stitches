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
    // The traced region sits inside the square and roughly fills it.
    expect(b.minX).toBeGreaterThan(-1);
    expect(b.minY).toBeGreaterThan(-1);
    expect(b.maxX).toBeLessThan(21);
    expect(b.maxY).toBeLessThan(21);
    expect(b.maxX - b.minX).toBeGreaterThan(15);
    expect(b.maxY - b.minY).toBeGreaterThan(15);
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
});

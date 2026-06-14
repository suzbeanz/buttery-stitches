import { describe, it, expect } from "vitest";
import { buildOutline, DEFAULT_OUTLINE_WIDTH } from "./outline";
import { distance } from "./geometry";
import { satinWidthOf } from "./objects";
import type { Path } from "../types/project";

/** A 20mm square ring (open, not pre-closed). */
const square: Path = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

/** A 8mm inner square hole inside the outer square. */
const hole: Path = [
  { x: 6, y: 6 },
  { x: 14, y: 6 },
  { x: 14, y: 14 },
  { x: 6, y: 14 },
];

describe("buildOutline", () => {
  it("outlines the outer ring only by default", () => {
    const objs = buildOutline([square, hole], 1.5, "c1");
    expect(objs).toHaveLength(1);
  });

  it("produces a satin object with the given color id", () => {
    const [obj] = buildOutline([square], 1.5, "thread-7");
    expect(obj.type).toBe("satin");
    expect(obj.colorId).toBe("thread-7");
    expect(obj.visible).toBe(true);
  });

  it("emits exactly two rails per ring", () => {
    const [obj] = buildOutline([square], 1.5, "c1");
    expect(obj.paths).toHaveLength(2);
    expect(obj.paths[0].length).toBeGreaterThanOrEqual(2);
    expect(obj.paths[1].length).toBe(obj.paths[0].length);
  });

  it("honors the requested column width (rail gap ~= width)", () => {
    const [obj] = buildOutline([square], 2.4, "c1");
    expect(satinWidthOf(obj.paths)).toBeCloseTo(2.4, 1);
  });

  it("closes the ring: each rail returns to its start", () => {
    // The centerline is closed (first point appended), so the rails trace the
    // whole border and end back near where they began. The seam vertex is not
    // mitered like an interior corner, so allow up to the column width.
    const width = 1.5;
    const [obj] = buildOutline([square], width, "c1");
    for (const rail of obj.paths) {
      const first = rail[0];
      const last = rail[rail.length - 1];
      expect(distance(first, last)).toBeLessThanOrEqual(width + 1e-6);
    }
  });

  it("traces a ring that is already closed without doubling the seam", () => {
    const closed: Path = [...square, { ...square[0] }];
    const [a] = buildOutline([closed], 1.5, "c1");
    const [b] = buildOutline([square], 1.5, "c1");
    // Same number of rail vertices whether or not the input was pre-closed.
    expect(a.paths[0].length).toBe(b.paths[0].length);
  });

  it("includeHoles outlines every ring", () => {
    const objs = buildOutline([square, hole], 1.5, "c1", {
      includeHoles: true,
    });
    expect(objs).toHaveLength(2);
    for (const o of objs) expect(o.type).toBe("satin");
  });

  it("ignores degenerate rings", () => {
    const objs = buildOutline([[{ x: 1, y: 1 }]], 1.5, "c1");
    expect(objs).toHaveLength(0);
  });

  it("returns nothing for empty input", () => {
    expect(buildOutline([], 1.5, "c1")).toHaveLength(0);
  });

  it("is deterministic", () => {
    const a = buildOutline([square], DEFAULT_OUTLINE_WIDTH, "c1");
    const b = buildOutline([square], DEFAULT_OUTLINE_WIDTH, "c1");
    expect(a[0].paths).toEqual(b[0].paths);
  });
});

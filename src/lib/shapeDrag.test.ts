import { describe, it, expect } from "vitest";
import { shapeFromDrag } from "./shapes";
import { pathsBounds } from "./geometry";

/** Batch 1 — drag-to-place shape creation. */

describe("shapeFromDrag", () => {
  it("makes a rectangle fill object spanning the drag box", () => {
    const obj = shapeFromDrag("rectangle", { x: 10, y: 20 }, { x: 30, y: 50 }, "c1");
    expect(obj).not.toBeNull();
    expect(obj!.type).toBe("fill");
    expect(obj!.colorId).toBe("c1");
    const b = pathsBounds(obj!.paths)!;
    expect(b.minX).toBeCloseTo(10, 1);
    expect(b.maxX).toBeCloseTo(30, 1);
    expect(b.minY).toBeCloseTo(20, 1);
    expect(b.maxY).toBeCloseTo(50, 1);
  });

  it("makes a line a running object from corner to corner (any angle)", () => {
    const obj = shapeFromDrag("line", { x: 0, y: 0 }, { x: 10, y: 6 }, "c1");
    expect(obj!.type).toBe("running");
    expect(obj!.paths[0]).toEqual([{ x: 0, y: 0 }, { x: 10, y: 6 }]);
  });

  it("works regardless of drag direction (drag up-left)", () => {
    const obj = shapeFromDrag("ellipse", { x: 30, y: 50 }, { x: 10, y: 20 }, "c1");
    const b = pathsBounds(obj!.paths)!;
    expect(b.minX).toBeCloseTo(10, 1);
    expect(b.maxX).toBeCloseTo(30, 1);
  });

  it("returns null for a drag too small to be intentional", () => {
    expect(shapeFromDrag("rectangle", { x: 5, y: 5 }, { x: 5.2, y: 5.1 }, "c1")).toBeNull();
    expect(shapeFromDrag("line", { x: 5, y: 5 }, { x: 5.1, y: 5.1 }, "c1")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { booleanOp } from "./boolean";
import type { Path } from "../types/project";

const A: Path[] = [[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]];
const B: Path[] = [[{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }]];

function area(ring: Path): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  return Math.abs(s) / 2;
}
const total = (rings: Path[]) => rings.reduce((s, r) => s + area(r), 0);

describe("boolean polygon ops", () => {
  it("unions two overlapping squares (combined minus the shared overlap)", () => {
    const u = booleanOp(A, B, "union", 0.15);
    expect(u.length).toBe(1);
    expect(total(u)).toBeGreaterThan(680); // 400+400−100 = 700
    expect(total(u)).toBeLessThan(720);
  });

  it("intersects to just the overlap", () => {
    const i = booleanOp(A, B, "intersect", 0.15);
    expect(total(i)).toBeGreaterThan(90); // 10×10 = 100
    expect(total(i)).toBeLessThan(112);
  });

  it("subtracts B from A", () => {
    const d = booleanOp(A, B, "subtract", 0.15);
    expect(total(d)).toBeGreaterThan(285); // 400−100 = 300
    expect(total(d)).toBeLessThan(315);
  });

  it("makes a hole when subtracting an interior shape (outer + hole rings)", () => {
    const ring: Path[] = [[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }]];
    const hole: Path[] = [[{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }]];
    const res = booleanOp(ring, hole, "subtract", 0.15);
    expect(res.length).toBe(2); // outer boundary + the hole's boundary
    expect(total([res[0]]) - total([res[1]])).toBeGreaterThan(0); // net area = frame
  });

  it("returns nothing when shapes don't intersect", () => {
    const far: Path[] = [[{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }, { x: 100, y: 110 }]];
    expect(booleanOp(A, far, "intersect", 0.2)).toHaveLength(0);
  });
});

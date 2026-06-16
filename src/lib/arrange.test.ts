import { describe, it, expect } from "vitest";
import { alignObjects, distributeObjects } from "./arrange";
import { makeObjectFromPaths } from "./objects";
import { pathsBounds } from "./geometry";
import type { EmbObject, Hoop } from "../types/project";

const hoop: Hoop = { name: "T", wMm: 100, hMm: 100 };

/** A square of side `s` with its top-left at (x, y). */
function box(x: number, y: number, s = 10): EmbObject {
  return makeObjectFromPaths(
    "fill",
    [[
      { x, y },
      { x: x + s, y },
      { x: x + s, y: y + s },
      { x, y: y + s },
    ]],
    "c1",
  );
}
const cx = (o: EmbObject) => {
  const b = pathsBounds(o.paths)!;
  return (b.minX + b.maxX) / 2;
};

describe("alignObjects", () => {
  it("aligns left edges of the selection", () => {
    const a = box(5, 0);
    const b = box(40, 20);
    const out = alignObjects([a, b], [a.id, b.id], "left", hoop);
    expect(pathsBounds(out[0].paths)!.minX).toBe(5);
    expect(pathsBounds(out[1].paths)!.minX).toBe(5); // moved to the selection's left edge
  });

  it("centers a single object in the hoop", () => {
    const a = box(0, 0, 20);
    const out = alignObjects([a], [a.id], "hcenter", hoop);
    expect(cx(out[0])).toBeCloseTo(50); // hoop center
  });

  it("only moves selected objects", () => {
    const a = box(5, 0);
    const b = box(40, 0);
    const out = alignObjects([a, b], [a.id], "right", hoop);
    expect(out[1]).toBe(b); // unchanged reference (not selected)
  });
});

describe("distributeObjects", () => {
  it("evenly spaces centers and keeps the ends fixed", () => {
    const a = box(0, 0, 10); // center x=5
    const b = box(12, 0, 10); // center x=17 (uneven)
    const c = box(40, 0, 10); // center x=45
    const out = distributeObjects([a, b, c], [a.id, b.id, c.id], "h");
    const [oa, ob, oc] = out;
    expect(cx(oa)).toBeCloseTo(5); // first fixed
    expect(cx(oc)).toBeCloseTo(45); // last fixed
    expect(cx(ob)).toBeCloseTo(25); // midpoint of 5 and 45
  });

  it("is a no-op for fewer than three", () => {
    const a = box(0, 0);
    const b = box(40, 0);
    expect(distributeObjects([a, b], [a.id, b.id], "h")).toEqual([a, b]);
  });
});

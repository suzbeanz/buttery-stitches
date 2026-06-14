import { describe, it, expect } from "vitest";
import type { EngineStitch } from "./index";
import { designToSegments, needleAt } from "./render";

const design: EngineStitch[] = [
  { x: 0, y: 0, colorId: "a", objectId: "o" },
  { x: 1, y: 0, colorId: "a", objectId: "o" },
  { x: 5, y: 5, colorId: "b", objectId: "p", jump: true, trim: true },
  { x: 5, y: 5, colorId: "b", objectId: "p" },
  { x: 6, y: 5, colorId: "b", objectId: "p" },
];

describe("designToSegments", () => {
  it("breaks segments at jumps and colour boundaries", () => {
    const segs = designToSegments(design);
    expect(segs).toHaveLength(2);
    expect(segs[0].colorId).toBe("a");
    expect(segs[0].points).toHaveLength(2);
    expect(segs[1].colorId).toBe("b");
    expect(segs[1].points).toHaveLength(2);
  });

  it("respects the upTo cursor (partial redraw)", () => {
    const segs = designToSegments(design, 1);
    expect(segs).toHaveLength(1);
    expect(segs[0].points).toHaveLength(1);
  });
});

describe("needleAt", () => {
  it("returns the last real penetration, skipping jumps", () => {
    expect(needleAt(design, 5)).toEqual({ x: 6, y: 5 });
    // after 4 events (0..3): index 3 is the first stitch of colour b
    expect(needleAt(design, 4)).toEqual({ x: 5, y: 5 });
    // after 3 events (0..2): index 2 is a jump, so the last real one is index 1
    expect(needleAt(design, 3)).toEqual({ x: 1, y: 0 });
    expect(needleAt(design, 0)).toBeNull();
  });
});

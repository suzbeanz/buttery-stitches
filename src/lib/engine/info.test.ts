import { describe, it, expect } from "vitest";
import { designInfo } from "./info";
import { generateDesign } from "./index";
import { makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";

describe("designInfo", () => {
  it("reports stitches, thread length, runtime, and hoop fit for a fill", () => {
    const o = makeObjectFromPaths(
      "fill",
      [[{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }]],
      "c1",
    );
    const p = { ...createEmptyProject(), objects: [o] };
    const info = designInfo(generateDesign(p), p);
    expect(info.stitches).toBeGreaterThan(0);
    expect(info.threadLengthMm).toBeGreaterThan(0);
    expect(info.runtimeMin).toBeGreaterThan(0);
    expect(info.widthMm).toBeGreaterThan(25); // ~30mm box
    expect(info.withinHoop).toBe(true);
  });

  it("flags a design that overflows the hoop", () => {
    const o = makeObjectFromPaths(
      "fill",
      [[{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 50 }, { x: 0, y: 50 }]],
      "c1",
    );
    const p = { ...createEmptyProject(), objects: [o] };
    expect(designInfo(generateDesign(p), p).withinHoop).toBe(false);
  });

  it("empty design is zero and trivially fits", () => {
    const p = createEmptyProject();
    const info = designInfo(generateDesign(p), p);
    expect(info.stitches).toBe(0);
    expect(info.withinHoop).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { designInfo, estimateRuntimeMin, BOBBIN_RATIO } from "./info";
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
    expect(info.bobbinLengthMm).toBe(0);
    expect(info.perColor).toHaveLength(0);
  });

  it("reports bobbin as the ⅓ estimate and per-color thread usage that sums to the total", () => {
    const a = makeObjectFromPaths(
      "fill",
      [[{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }]],
      "c1",
    );
    const b = makeObjectFromPaths(
      "fill",
      [[{ x: 60, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 40 }, { x: 60, y: 40 }]],
      "c2",
    );
    const p = { ...createEmptyProject(), objects: [a, b] };
    const info = designInfo(generateDesign(p), p);
    expect(info.bobbinLengthMm).toBeCloseTo(info.threadLengthMm * BOBBIN_RATIO, 6);
    expect(info.perColor).toHaveLength(2);
    const perColorSum = info.perColor.reduce((s, u) => s + u.threadLengthMm, 0);
    expect(perColorSum).toBeCloseTo(info.threadLengthMm, 4);
    const perColorStitches = info.perColor.reduce((s, u) => s + u.stitches, 0);
    expect(perColorStitches).toBe(info.stitches);
  });

  it("estimateRuntimeMin adds change + trim overhead on top of sew time", () => {
    const base = estimateRuntimeMin(7000, 0, 0);
    const withOverhead = estimateRuntimeMin(7000, 3, 5);
    expect(withOverhead).toBeGreaterThan(base);
    expect(base).toBeCloseTo(10, 5); // 7000 / 700 spm
  });
});

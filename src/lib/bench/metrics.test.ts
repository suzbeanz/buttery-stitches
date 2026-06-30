import { describe, it, expect } from "vitest";
import type { Project } from "../../types/project";
import { DEFAULT_PARAMS } from "../../types/project";
import type { EngineStitch } from "../engine";
import {
  stitchSegmentLengths,
  travelLengthMm,
  summarizeLengths,
  fillCoverage,
  benchMetrics,
} from "./metrics";

const s = (x: number, y: number, extra: Partial<EngineStitch> = {}): EngineStitch => ({
  x,
  y,
  colorId: "c1",
  objectId: "o1",
  ...extra,
});

describe("stitch-length metrics", () => {
  it("measures real segment lengths and resets across jumps/colours", () => {
    const design = [s(0, 0), s(2, 0), s(4, 0), s(10, 0, { jump: true }), s(12, 0)];
    // (0→2), (2→4) are real; the jump break means (4→10) and (10→12) are not segments.
    expect(stitchSegmentLengths(design)).toEqual([2, 2]);
  });

  it("summarizes a uniform run with zero spread", () => {
    const stats = summarizeLengths([2, 2, 2, 2]);
    expect(stats.mean).toBe(2);
    expect(stats.cv).toBe(0);
    expect(stats.shortPct).toBe(0);
  });

  it("flags short stitches below the threshold", () => {
    const stats = summarizeLengths([0.5, 0.5, 3, 3]); // two of four are < 0.8mm
    expect(stats.shortPct).toBeCloseTo(0.5, 5);
  });
});

describe("travel metric", () => {
  it("sums only jump moves", () => {
    const design = [s(0, 0), s(3, 0), s(13, 0, { jump: true }), s(15, 0)];
    expect(travelLengthMm(design)).toBe(10); // only the 3→13 jump counts
  });
});

function rectFillProject(): Project {
  return {
    version: 1,
    widthMm: 100,
    heightMm: 100,
    hoop: { wMm: 100, hMm: 100, name: "test" },
    colors: [{ id: "c-green", rgb: [64, 158, 52], name: "Green" }],
    objects: [
      {
        id: "rect",
        name: "rect",
        type: "fill",
        colorId: "c-green",
        paths: [[
          { x: 30, y: 38 },
          { x: 70, y: 38 },
          { x: 70, y: 62 },
          { x: 30, y: 62 },
        ]],
        params: { ...DEFAULT_PARAMS, fillStyle: "tatami" },
        visible: true,
      },
    ],
  };
}

describe("fill coverage", () => {
  it("returns null when there are no fill objects", () => {
    const p = rectFillProject();
    p.objects = [];
    // designFor of an empty project is empty; coverage is null (nothing to cover).
    expect(fillCoverage(p, [])).toBeNull();
  });

  it("a solid tatami rectangle covers essentially its whole region", () => {
    const m = benchMetrics(rectFillProject());
    expect(m.stitches).toBeGreaterThan(100);
    expect(m.travelMm).toBe(0); // one region, no jumps
    expect(m.fillCoverage).not.toBeNull();
    expect(m.fillCoverage!).toBeGreaterThan(0.95);
  });
});

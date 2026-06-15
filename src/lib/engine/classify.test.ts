import { describe, it, expect } from "vitest";
import type { Path } from "../../types/project";
import { classifyRegion, meanStrokeWidthMm } from "./classify";

/** A closed rectangle ring `w`×`h` mm at the origin. */
function rect(w: number, h: number): Path {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
    { x: 0, y: 0 },
  ];
}

describe("meanStrokeWidthMm", () => {
  it("reads a thin bar as its short dimension", () => {
    // A 0.6×20 mm bar: 2·area/perimeter ≈ 2·12 / (2·20.6) ≈ 0.58 mm.
    const w = meanStrokeWidthMm([rect(0.6, 20)]);
    expect(w).toBeGreaterThan(0.4);
    expect(w).toBeLessThan(0.8);
  });

  it("is holes-aware: a ring reads as its band width, not its diameter", () => {
    // 20×20 outer with a 16×16 hole → a 2 mm band, not a 20 mm blob.
    const outer = rect(20, 20);
    const hole: Path = [
      { x: 2, y: 2 },
      { x: 2, y: 18 },
      { x: 18, y: 18 },
      { x: 18, y: 2 },
      { x: 2, y: 2 },
    ];
    const w = meanStrokeWidthMm([outer, hole]);
    expect(w).toBeGreaterThan(1.5);
    expect(w).toBeLessThan(3.5);
  });
});

describe("classifyRegion", () => {
  it("a hairline is running", () => {
    expect(classifyRegion([rect(0.6, 20)])).toBe("running");
  });

  it("a stroke is satin", () => {
    expect(classifyRegion([rect(3, 20)])).toBe("satin");
  });

  it("a broad blob is tatami", () => {
    expect(classifyRegion([rect(20, 20)])).toBe("tatami");
  });

  it("a thin ring (like the letter 'o') is satin, not tatami", () => {
    const outer = rect(20, 20);
    const hole: Path = [
      { x: 2, y: 2 },
      { x: 2, y: 18 },
      { x: 18, y: 18 },
      { x: 18, y: 2 },
      { x: 2, y: 2 },
    ];
    expect(classifyRegion([outer, hole])).toBe("satin");
  });

  it("honors a custom satin width cap", () => {
    // With satinMax 2.5 a 3 mm stroke tips over into tatami.
    expect(classifyRegion([rect(3, 20)], { satinMaxWidthMm: 2.5 })).toBe("tatami");
  });

  it("degenerate input falls back to tatami", () => {
    expect(classifyRegion([])).toBe("tatami");
  });
});

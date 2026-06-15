import { describe, it, expect } from "vitest";
import { medialSatin, satinCoverage } from "./medial";
import type { Path } from "../../types/project";

/** A square ring (annulus) like the letter "o": outer box with a centered hole. */
function ring(size: number, thickness: number): Path[] {
  const o = size / 2;
  const i = o - thickness;
  const outer: Path = [
    { x: -o, y: -o },
    { x: o, y: -o },
    { x: o, y: o },
    { x: -o, y: o },
  ];
  const hole: Path = [
    { x: -i, y: -i },
    { x: -i, y: i },
    { x: i, y: i },
    { x: i, y: -i },
  ];
  return [outer, hole];
}

describe("medialSatin", () => {
  it("lays a satin column down a vertical stroke", () => {
    // A 4mm-wide, 30mm-tall stroke (like a letter stem).
    const stroke: Path = [
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 14, y: 40 },
      { x: 10, y: 40 },
    ];
    const runs = medialSatin([stroke], { density: 0.5 });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const pts = runs.flat();
    expect(pts.length).toBeGreaterThan(10);
    // Throws span roughly the stroke width; column runs the stroke height.
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...xs)).toBeLessThanOrEqual(16);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(15);
  });

  it("returns nothing for a degenerate tiny region", () => {
    const tiny: Path = [
      { x: 0, y: 0 },
      { x: 0.3, y: 0 },
      { x: 0.3, y: 0.3 },
      { x: 0, y: 0.3 },
    ];
    expect(medialSatin([tiny], { density: 0.5 })).toEqual([]);
  });

  it("is deterministic", () => {
    const stroke: Path = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 20 },
      { x: 0, y: 20 },
    ];
    const a = medialSatin([stroke], { density: 0.5 });
    const b = medialSatin([stroke], { density: 0.5 });
    expect(a).toEqual(b);
  });

  it("stitches a closed ring (an 'o') all the way around with good coverage", () => {
    const o = ring(16, 3); // 16mm letter, 3mm stroke
    const runs = medialSatin(o, { density: 0.4 });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    // The satin must cover almost the whole ring — a broken loop would leave a
    // big gap and tank coverage.
    expect(satinCoverage(o, runs)).toBeGreaterThan(0.85);
  });
});

describe("satinCoverage", () => {
  it("is ~1 for a column that sweeps the whole stroke and low for none", () => {
    const stroke: Path = [
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 14, y: 40 },
      { x: 10, y: 40 },
    ];
    const runs = medialSatin([stroke], { density: 0.4 });
    expect(satinCoverage([stroke], runs)).toBeGreaterThan(0.85);
    expect(satinCoverage([stroke], [])).toBe(0);
  });
});

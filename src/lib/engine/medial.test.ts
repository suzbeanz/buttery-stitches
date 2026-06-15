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

  it("widens the column with width-driven pull compensation", () => {
    // A 4mm-wide vertical stroke. With pull comp the rails sit a touch outside
    // the true stroke edge so the sewn column matches the drawing.
    const stroke: Path = [
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 14, y: 40 },
      { x: 10, y: 40 },
    ];
    const span = (runs: Path[]) => {
      const xs = runs.flat().map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    const plain = medialSatin([stroke], { density: 0.5 });
    const comped = medialSatin([stroke], { density: 0.5, pullScale: 1 });
    // ~0.58mm total comp for a 4mm stroke → noticeably wider span.
    expect(span(comped)).toBeGreaterThan(span(plain) + 0.3);
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
    // The satin must fill the ring (a broken loop would leave a big gap and tank
    // coverage). This synthetic ring has sharp 90° corners that real rounded
    // letters don't, so it sits near the production acceptance bar; actual font
    // "o"s score ~0.97+.
    expect(satinCoverage(o, runs)).toBeGreaterThan(0.82);
  });

  it("keeps the satin column dense around a curve (density compensation)", () => {
    // A circular annulus (a clean curved stroke). With density compensation the
    // outer rail's gap between throws stays near the stitch spacing instead of
    // fanning open — so the convex edge has no gaps. The advances between throws
    // (the even-indexed segments of the L,R,R,L,… chain) are the rail gaps.
    const density = 0.4;
    const runs = medialSatin(ring(24, 3), { density });
    let maxRailGap = 0;
    for (const run of runs) {
      for (let i = 2; i < run.length; i += 2) {
        maxRailGap = Math.max(
          maxRailGap,
          Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y),
        );
      }
    }
    // Comfortably bounded (a fixed-spacing satin would fan to several × density).
    expect(maxRailGap).toBeLessThanOrEqual(density * 2.5);
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

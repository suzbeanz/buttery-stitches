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

  it("lands rails ON the stroke edge (no overshoot) without pull comp", () => {
    // A 4mm-wide vertical stem. With pullScale 0 the rails are raycast to the true
    // outline, so the column span hugs the 4mm stroke instead of feathering wide.
    const stroke: Path = [
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 14, y: 40 },
      { x: 10, y: 40 },
    ];
    const pts = medialSatin([stroke], { density: 0.4, pullScale: 0 }).flat();
    const xs = pts.map((p) => p.x);
    // Rails sit within a hair of the real edges (10 and 14), not bulged outside.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(9.6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(14.4);
  });

  it("covers a branching T-junction without redundant columns", () => {
    // A "T": a vertical stem meeting a horizontal bar. The skeleton branches; the
    // engine must satin both strokes (high coverage) without emitting overlapping
    // duplicate columns that pile into the junction and fan.
    const tee: Path = [
      { x: 0, y: 26 }, { x: 8, y: 26 }, { x: 8, y: 0 }, { x: 12, y: 0 },
      { x: 12, y: 26 }, { x: 20, y: 26 }, { x: 20, y: 30 }, { x: 0, y: 30 },
    ];
    const runs = medialSatin([tee], { density: 0.4 });
    // Stem + bar → a small handful of columns, not a pile of retraced ones.
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.length).toBeLessThanOrEqual(4);
    expect(satinCoverage([tee], runs)).toBeGreaterThan(0.85);
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
    // An annulus (a clean bent stroke). With density compensation the outer
    // rail's gap between penetrations stays near the stitch spacing instead of
    // fanning open — so the convex edge has no gaps. The satin chain is an
    // all-crossings zigzag, so the outer-edge penetrations are the chain points
    // landing near the outer rail; walk them in sew order and bound their gaps.
    const density = 0.4;
    const runs = medialSatin(ring(24, 3), { density });
    // Collect the penetrations landing on each straight stretch of the outer
    // rail (the rail sits at 12 ± overshoot; corners are the mitre/fan's job —
    // guarded by the satin-corner suite — so stay 1.5mm off the vertices) and
    // bound the sorted gaps along each edge.
    const outerBand = 11.5;
    const cornerPad = 10.5;
    const edges: number[][] = [[], [], [], []]; // +x, -x, +y, -y edges (coord along edge)
    for (const run of runs) {
      for (const p of run) {
        if (p.x > outerBand && Math.abs(p.y) < cornerPad) edges[0].push(p.y);
        if (p.x < -outerBand && Math.abs(p.y) < cornerPad) edges[1].push(p.y);
        if (p.y > outerBand && Math.abs(p.x) < cornerPad) edges[2].push(p.x);
        if (p.y < -outerBand && Math.abs(p.x) < cornerPad) edges[3].push(p.x);
      }
    }
    let maxRailGap = 0;
    for (const edge of edges) {
      expect(edge.length).toBeGreaterThan(10);
      edge.sort((a, b) => a - b);
      for (let i = 1; i < edge.length; i++) maxRailGap = Math.max(maxRailGap, edge[i] - edge[i - 1]);
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

import { describe, it, expect } from "vitest";
import type { Path } from "../../types/project";
import { guidanceFieldFill } from "./field";

const D = Math.PI / 180;
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number): Path =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

const opts = { density: 0.4, angle: 0, stitchLength: 4, pullCompMm: 0 };

describe("guidanceFieldFill", () => {
  it("sweeps a curved band with many rows that follow the form", () => {
    const crescent: Path = [...arc(50, 55, 40, 200 * D, 340 * D, 60), ...arc(50, 55, 26, 340 * D, 200 * D, 60)];
    const runs = guidanceFieldFill([crescent], opts);
    expect(runs).not.toBeNull();
    expect(runs!.length).toBeGreaterThan(20); // a dense sweep, not a handful of rows
    for (const run of runs!) expect(run.length).toBeGreaterThanOrEqual(2);

    // The rows genuinely TURN along the arc: collect each row's direction and
    // confirm a wide spread (a fixed-angle tatami would cluster in one bin).
    const bins = new Set<number>();
    for (const run of runs!) {
      if (run.length < 2) continue;
      const dx = run[run.length - 1].x - run[0].x;
      const dy = run[run.length - 1].y - run[0].y;
      let a = (Math.atan2(dy, dx) * 180) / Math.PI;
      a = ((a % 180) + 180) % 180;
      bins.add(Math.floor(a / 20));
    }
    expect(bins.size).toBeGreaterThanOrEqual(3);
  });

  it("rejects a tight band whose field shatters into hop-heavy stubs (the swatch C-band nest)", () => {
    // The calibration swatch's small C-band: cBand(78,84,12,5). Its isolines
    // fragment into dozens of short runs, so chaining them spends ~32% of the
    // laid thread on exposed inter-run hops — that sewed out as a bird-nest.
    // The connector-quality gate must reject it so the caller draws clean tatami.
    const a0 = (-130 * Math.PI) / 180;
    const a1 = (130 * Math.PI) / 180;
    const n = 28;
    const outer: { x: number; y: number }[] = [];
    const inner: { x: number; y: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      outer.push({ x: 78 + 12 * Math.cos(a), y: 84 + 12 * Math.sin(a) });
      inner.push({ x: 78 + 5 * Math.cos(a), y: 84 + 5 * Math.sin(a) });
    }
    inner.reverse();
    const cband: Path = [...outer, ...inner, outer[0]];
    expect(guidanceFieldFill([cband], { density: 0.3, angle: 0, stitchLength: 3, pullCompMm: 0 })).toBeNull();
  });

  it("declines a shape too small to seat a field (caller falls back to tatami)", () => {
    const tiny: Path = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
      { x: 0, y: 6 },
    ];
    expect(guidanceFieldFill([tiny], opts)).toBeNull();
  });
});

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

import { describe, it, expect } from "vitest";
import type { Path, Point } from "../../types/project";
import { turningFill } from "./turning";

const opts = { density: 0.6, angle: 0, stitchLength: 3, pullCompMm: 0.2 };

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Path {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}
const D = Math.PI / 180;
/** A thick crescent band (outer arc + inner arc) — the model turning-fill case. */
const crescent: Path = [...arc(50, 55, 42, 200 * D, 340 * D, 60), ...arc(50, 55, 28, 340 * D, 200 * D, 60)];

/** Is p inside the crescent band? (radial membership, allowing pull-comp.) */
function inCrescent(p: Point): boolean {
  const r = Math.hypot(p.x - 50, p.y - 55);
  let a = (Math.atan2(p.y - 55, p.x - 50) * 180) / Math.PI;
  if (a < 0) a += 360;
  return r > 28 - 0.7 && r < 42 + 0.7 && a > 197 && a < 343;
}

describe("turningFill", () => {
  it("fills a curved band with rows that follow the curve, all inside", () => {
    const runs = turningFill([crescent], opts);
    expect(runs).not.toBeNull();
    let pts = 0;
    let outside = 0;
    const dirs: number[] = [];
    for (const run of runs!) {
      for (let i = 0; i < run.length; i++) {
        pts++;
        if (!inCrescent(run[i])) outside++;
      }
      // sample the row direction at the start vs the end of the run
      if (run.length > 4) {
        const d0 = Math.atan2(run[1].y - run[0].y, run[1].x - run[0].x);
        const dN = Math.atan2(run[run.length - 1].y - run[run.length - 2].y, run[run.length - 1].x - run[run.length - 2].x);
        dirs.push(Math.abs(d0 - dN));
      }
    }
    expect(pts).toBeGreaterThan(50);
    expect(outside).toBe(0); // no slashes, stays in the band
    // The fill genuinely TURNS: stitch direction changes a lot across the arc.
    expect(Math.max(...dirs, 0)).toBeGreaterThan(0.5); // > ~30° of turn
  });

  it("declines a straight bar (a fixed angle already flows along it)", () => {
    const bar: Path = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 12 }, { x: 0, y: 12 }];
    expect(turningFill([bar], opts)).toBeNull();
  });

  it("declines a round blob (too compact to be a band)", () => {
    const disc = arc(30, 30, 18, 0, 2 * Math.PI, 48);
    expect(turningFill([disc], opts)).toBeNull();
  });

  it("declines a notched/concave shape rather than slash across the notch", () => {
    const u: Path = [
      { x: 0, y: 0 }, { x: 44, y: 0 }, { x: 44, y: 40 }, { x: 30, y: 40 },
      { x: 30, y: 12 }, { x: 14, y: 12 }, { x: 14, y: 40 }, { x: 0, y: 40 },
    ];
    expect(turningFill([u], opts)).toBeNull();
  });
});

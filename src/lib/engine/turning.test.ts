import { describe, it, expect } from "vitest";
import type { Path, Point } from "../../types/project";
import { turningFill, flowFill, flowAlong } from "./turning";

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

/** A 3-limbed Y: a stem and two upper arms meeting at a junction — a branchy shape
 *  with no single dominant spine, so turningFill declines and flowFill takes over. */
const yShape: Path = [
  { x: 34, y: 8 }, { x: 46, y: 8 }, { x: 46, y: 48 }, { x: 78, y: 80 },
  { x: 70, y: 88 }, { x: 40, y: 60 }, { x: 10, y: 88 }, { x: 2, y: 80 }, { x: 34, y: 48 },
];
function inShape(p: Point, ring: Path): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function distToRing(p: Point, ring: Path): number {
  let m = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    m = Math.min(m, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return m;
}

describe("flowFill (branchy / multi-limb shapes)", () => {
  it("fills a branchy Y that turningFill declines — no slash across any limb", () => {
    expect(turningFill([yShape], opts)).toBeNull(); // no single spine → turning bows out
    const runs = flowFill([yShape], opts);
    expect(runs).not.toBeNull();
    let pts = 0, deepOut = 0;
    for (const run of runs!) {
      for (let i = 1; i < run.length; i++) {
        pts++;
        const m = { x: (run[i - 1].x + run[i].x) / 2, y: (run[i - 1].y + run[i].y) / 2 };
        if (!inShape(m, yShape) && distToRing(m, yShape) > 1) deepOut++;
      }
    }
    expect(pts).toBeGreaterThan(50);
    expect(deepOut).toBe(0); // every limb's rows stay inside — never slashes the fork
  });

  it("declines a plain rectangle and a disc (tatami/turning already suit them)", () => {
    const rect: Path = [{ x: 20, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 80 }, { x: 20, y: 80 }];
    expect(flowFill([rect], opts)).toBeNull();
    const disc = arc(50, 50, 25, 0, 2 * Math.PI, 48);
    expect(flowFill([disc], opts)).toBeNull();
  });
});

describe("flowAlong (user-drawn flow curve)", () => {
  it("follows a spine the user drew along the crescent — turns, stays inside", () => {
    // A spine that arcs down the middle of the band; rows run perpendicular to it.
    const spine = arc(50, 55, 35, 205 * D, 335 * D, 20);
    const runs = flowAlong([crescent], spine, opts);
    expect(runs).not.toBeNull();
    let outside = 0;
    const dirs: number[] = [];
    for (const run of runs!) {
      for (const pt of run) if (!inCrescent(pt)) outside++;
      if (run.length > 4) {
        const d0 = Math.atan2(run[1].y - run[0].y, run[1].x - run[0].x);
        const dN = Math.atan2(run[run.length - 1].y - run[run.length - 2].y, run[run.length - 1].x - run[run.length - 2].x);
        dirs.push(Math.abs(d0 - dN));
      }
    }
    expect(outside).toBe(0); // never slashes past the band
    expect(Math.max(...dirs, 0)).toBeGreaterThan(0.5); // rows genuinely turn along the arc
  });

  it("declines when the drawn spine lies outside the shape (→ tatami fallback)", () => {
    const farSpine: Path = [{ x: 200, y: 200 }, { x: 260, y: 200 }];
    expect(flowAlong([crescent], farSpine, opts)).toBeNull();
  });
});

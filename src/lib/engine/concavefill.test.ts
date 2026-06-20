import { describe, it, expect } from "vitest";
import type { Path, Point } from "../../types/project";
import { tatamiFill, tatamiConcaveRuns } from "./fill";

const opts = { density: 0.6, angle: 0, stitchLength: 3, pullCompMm: 0.2 };

/** Nonzero-winding inside test (matches the fill's own rule). */
function inside(p: Point, ring: Path): boolean {
  let w = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (a.y <= p.y) {
      if (b.y > p.y && cr > 0) w++;
    } else if (b.y <= p.y && cr < 0) w--;
  }
  return w !== 0;
}

/** Distance from p to the ring's boundary (nearest edge). */
function distToBoundary(p: Point, ring: Path): number {
  let m = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    m = Math.min(m, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return m;
}

/** Count segments that cut DEEP across open fabric — a real thread slash, not the
 *  hair of pull-comp that every row carries past the edge. A midpoint more than
 *  1 mm OUTSIDE the region is unmistakably a bridge across a concavity. */
function crossingSegments(runs: Point[][], ring: Path): { count: number; longest: number } {
  let count = 0;
  let longest = 0;
  for (const pts of runs) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      let deepOut = false;
      for (let t = 0.25; t < 0.8; t += 0.25) {
        const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (!inside(m, ring) && distToBoundary(m, ring) > 1) deepOut = true;
      }
      if (deepOut) {
        count++;
        longest = Math.max(longest, Math.hypot(b.x - a.x, b.y - a.y));
      }
    }
  }
  return { count, longest };
}

describe("concavity-aware tatami (boustrophedon)", () => {
  it("a convex shape is identical to plain tatami (one run, same points)", () => {
    const square: Path = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 0, y: 30 },
    ];
    const runs = tatamiConcaveRuns([square], opts);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(tatamiFill([square], opts));
  });

  it("does NOT slash across a concave notch (a U), where plain tatami does", () => {
    // A cup: full-width base with two arms, an open notch up the middle.
    const u: Path = [
      { x: 0, y: 0 },
      { x: 44, y: 0 },
      { x: 44, y: 40 },
      { x: 30, y: 40 },
      { x: 30, y: 12 },
      { x: 14, y: 12 },
      { x: 14, y: 40 },
      { x: 0, y: 40 },
    ];
    // Plain serpentine bridges the notch on every arm row — many long slashes.
    const old = crossingSegments([tatamiFill([u], opts)], u);
    expect(old.count).toBeGreaterThan(10);
    expect(old.longest).toBeGreaterThan(8);
    // The boustrophedon fills each side as its own cell and connects them inside
    // the shape (or trims), so nothing crosses the open notch.
    const next = crossingSegments(tatamiConcaveRuns([u], opts), u);
    expect(next.count).toBe(0);
  });

  it("does NOT slash across the notch of an L (abrupt one-sided width jump)", () => {
    // An L: a narrow stem whose span widens abruptly into the foot. A single-cell
    // serpentine would connect the narrow stem row straight across to the far end
    // of the wide foot row — a diagonal slash over the notch (top-right). The cell
    // must split where the span end jumps, so the two join inside the shape.
    const l: Path = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 34 },
      { x: 34, y: 34 },
      { x: 34, y: 42 },
      { x: 0, y: 42 },
    ];
    const next = crossingSegments(tatamiConcaveRuns([l], opts), l);
    expect(next.count).toBe(0);
  });

  it("keeps every drawn stitch inside the region for a wavy (multi-notch) strip", () => {
    // A zig-zag-edged bar: several concave dips along the top.
    const wave: Path = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 20 },
      { x: 50, y: 8 },
      { x: 40, y: 20 },
      { x: 30, y: 8 },
      { x: 20, y: 20 },
      { x: 10, y: 8 },
      { x: 0, y: 20 },
    ];
    const runs = tatamiConcaveRuns([wave], opts);
    expect(runs.length).toBeGreaterThan(0);
    // No leg of any run leaves the shape.
    expect(crossingSegments(runs, wave).count).toBe(0);
  });

  it("fills a heavily-fragmented region (many holes) quickly and validly", () => {
    // A region riddled with holes (a traced fur fill) blows up the inside-routing
    // visibility graph; past the vertex cap the router is skipped (connectors
    // break instead) so generation stays fast. Output must still be valid: real
    // runs, finite coordinates, no crash.
    const outer: Path = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 60 },
      { x: 0, y: 60 },
    ];
    const rings: Path[] = [outer];
    for (let gx = 0; gx < 7; gx++) {
      for (let gy = 0; gy < 7; gy++) {
        const cx = 5 + gx * 8;
        const cy = 5 + gy * 8;
        // CW holes (reverse winding) so they punch out under nonzero fill.
        rings.push([
          { x: cx, y: cy },
          { x: cx, y: cy + 3 },
          { x: cx + 3, y: cy + 3 },
          { x: cx + 3, y: cy },
        ]);
      }
    }
    const t0 = Date.now();
    const runs = tatamiConcaveRuns(rings, opts);
    const ms = Date.now() - t0;
    expect(runs.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(800); // capped router keeps it interactive
    for (const run of runs) {
      for (const p of run) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
    }
  });
});

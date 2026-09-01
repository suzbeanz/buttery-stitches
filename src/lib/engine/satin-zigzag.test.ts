import { describe, it, expect } from "vitest";
import type { Path, Point } from "../../types/project";
import { railsFromCenterline } from "../geometry";
import { satinColumn, staggeredSatin, levelFanPivots, REF_SATIN_CROSSING_FRACTION } from "./satin";
import { medialColumns } from "./medial";

/**
 * Satin CROSSING TOPOLOGY. Commercial satin sews every segment ACROSS the
 * column: the decoded reference designs run {@link REF_SATIN_CROSSING_FRACTION}
 * (≥95%; measured 338/341 and 126/130 on two designs) of their satin segments
 * as full-width crossings. The pre-fix engine alternated the leading rail and
 * left the return as an implicit walk ALONG the rail — only half the segments
 * crossed, the sewn column showed ground colour between its throws (half the
 * top-thread coverage of a commercial column at the same penetration count)
 * and the rails carried a busy ladder of little advance bars.
 */

/** Fraction of segments whose across-column component ≥ half the column width. */
function crossingFraction(col: Point[], widthMm: number, axis: Point): number {
  let cross = 0;
  let n = 0;
  for (let i = 1; i < col.length; i++) {
    const dx = col[i].x - col[i - 1].x;
    const dy = col[i].y - col[i - 1].y;
    // component perpendicular to the column axis
    const across = Math.abs(dx * -axis.y + dy * axis.x);
    n++;
    if (across >= widthMm * 0.5) cross++;
  }
  return n ? cross / n : 0;
}

describe("satin crossing topology (all-crossings zigzag)", () => {
  it("a straight satinColumn crosses on ≥ the commercial fraction of segments", () => {
    const left: Path = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ];
    const right: Path = [
      { x: 0, y: 3 },
      { x: 30, y: 3 },
    ];
    const col = satinColumn(left, right, { density: 0.4, pullComp: 0 });
    expect(col.length).toBeGreaterThan(100);
    expect(crossingFraction(col, 3, { x: 1, y: 0 })).toBeGreaterThanOrEqual(
      REF_SATIN_CROSSING_FRACTION,
    );
  });

  it("a curved satinColumn crosses on ≥ the commercial fraction of segments", () => {
    const center: Path = [];
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * Math.PI;
      center.push({ x: 12 * Math.cos(a), y: 12 * Math.sin(a) });
    }
    const [l, r] = railsFromCenterline(center, 2.4);
    const col = satinColumn(l, r, { density: 0.4, pullComp: 0 });
    // On a curve the axis turns — measure each segment against the local rail
    // direction via its own length instead: a crossing spans ≥ half the width.
    let cross = 0;
    let n = 0;
    for (let i = 1; i < col.length; i++) {
      const len = Math.hypot(col[i].x - col[i - 1].x, col[i].y - col[i - 1].y);
      n++;
      if (len >= 2.4 * 0.5) cross++;
    }
    expect(n).toBeGreaterThan(100);
    expect(cross / n).toBeGreaterThanOrEqual(REF_SATIN_CROSSING_FRACTION);
  });

  it("medialColumns throws cross on ≥ the commercial fraction of segments", () => {
    // A plain 20×2mm bar region (a drawn stroke) skeletonizes to one column.
    const ring: Path = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 2 },
      { x: 0, y: 2 },
    ];
    const cols = medialColumns([ring], { density: 0.4, pullScale: 0 });
    expect(cols.length).toBeGreaterThan(0);
    let cross = 0;
    let n = 0;
    for (const c of cols) {
      for (let i = 1; i < c.throws.length; i++) {
        const dy = c.throws[i].y - c.throws[i - 1].y;
        n++;
        if (Math.abs(dy) >= 1.0) cross++; // across the bar ≈ y component
      }
    }
    expect(n).toBeGreaterThan(50);
    expect(cross / n).toBeGreaterThanOrEqual(REF_SATIN_CROSSING_FRACTION);
  });

  it("zigzag mode keeps every penetration of the legacy meander (same holes)", () => {
    const pairs: [Point, Point][] = [];
    for (let i = 0; i <= 20; i++) pairs.push([{ x: i * 0.4, y: 0 }, { x: i * 0.4, y: 3 }]);
    const zz = staggeredSatin(pairs, 7, false, true);
    // Same penetration count as pairs demand (2 per station), no rail walks.
    expect(zz.length).toBe(42);
    for (let i = 1; i < zz.length; i++) {
      expect(Math.abs(zz[i].y - zz[i - 1].y)).toBeCloseTo(3); // every segment crosses
    }
  });

  it("levels fan pivots: no hole is drilled more than twice", () => {
    // A hairpin fan: 9 spokes pivoting on one left-rail hole while the right
    // rail sweeps. With the old meander chain the assembler's 0.3mm min-stitch
    // silently merged the adjacent re-punches; the all-crossings zigzag
    // interleaves a crossing between them, so unleveled pairs drilled the
    // pivot 9 times — a script ligature measured 26 penetrations in one mm²,
    // past DENSITY_DANGER_PER_MM2 (24, the committed density ceiling).
    const pivot: Point = { x: 0, y: 0 };
    const pairs: [Point, Point][] = [];
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * (Math.PI / 3);
      pairs.push([{ ...pivot }, { x: 3 * Math.sin(a), y: 3 * Math.cos(a) }]);
    }
    const leveled = levelFanPivots(pairs);
    let atPivot = 0;
    for (const [l, r] of leveled) {
      for (const p of [l, r]) {
        if (Math.hypot(p.x - pivot.x, p.y - pivot.y) < 0.12) atPivot++;
      }
    }
    expect(atPivot).toBeLessThanOrEqual(2);
    // Moved endpoints stay on their own spoke (between the two rails), pulled
    // a real short-stitch depth in — never past the middle of the throw.
    for (let k = 0; k < leveled.length; k++) {
      const [l, r] = leveled[k];
      const d = Math.hypot(l.x - pivot.x, l.y - pivot.y);
      if (d < 1e-9) continue; // the kept anchor hole
      expect(d).toBeGreaterThanOrEqual(0.4);
      expect(d).toBeLessThanOrEqual(3 * 0.66);
      const w = Math.hypot(r.x - l.x, r.y - l.y);
      expect(w).toBeLessThan(3); // moved toward its own partner
    }
  });

  it("legacy (non-zigzag) mode is unchanged for underlay/fill callers", () => {
    const pairs: [Point, Point][] = [];
    for (let i = 0; i <= 6; i++)
      pairs.push(i % 2 === 0 ? [{ x: i * 2, y: 0 }, { x: i * 2, y: 3 }] : [{ x: i * 2, y: 3 }, { x: i * 2, y: 0 }]);
    const legacy = staggeredSatin(pairs, 7);
    expect(legacy.length).toBe(14);
    // Meander: crossings and rail walks alternate.
    expect(Math.abs(legacy[1].y - legacy[0].y)).toBeCloseTo(3);
    expect(Math.abs(legacy[2].y - legacy[1].y)).toBeCloseTo(0);
  });
});

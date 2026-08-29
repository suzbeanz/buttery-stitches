import { describe, it, expect } from "vitest";
import type { Path, Point } from "../../types/project";
import { railsFromCenterline } from "../geometry";
import { satinColumn } from "./satin";

/**
 * Satin corner handling (mitre splits). A satin column whose rails turn a sharp
 * corner must NOT throw skewed stitches across the bend: the pre-fix sampler
 * matched the two rails by whole-column arc fraction, so around an L-bend or a
 * bordered rectangle the throws progressively leaned (61° off perpendicular on
 * the rectangle fixture), crossed each other (9 crossings on the L, 31 on the
 * ring), and sewed as a tangled fan. Commercial digitizers mitre such corners:
 * split the column at the corner, sew each leg with its own perpendicular
 * throws, and join the legs along the corner diagonal.
 */

/** Count genuinely crossing stitch segments within a local window (a zig-zag's
 *  own chaining shares endpoints and never "crosses" under a strict test). */
function crossings(path: Point[]): number {
  const orient = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const cross = (a: Point, b: Point, c: Point, d: Point) => {
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    return o1 * o2 < -1e-12 && o3 * o4 < -1e-12;
  };
  let n = 0;
  for (let i = 1; i < path.length; i++) {
    for (let j = i + 2; j < Math.min(path.length, i + 14); j++) {
      if (cross(path[i - 1], path[i], path[j - 1], path[j])) n++;
    }
  }
  return n;
}

/** Worst throw lean (degrees off rail-perpendicular) against the centerline. */
function maxLeanDeg(col: Point[], center: Path, widthMm: number): number {
  let worst = 0;
  for (let i = 1; i < col.length; i++) {
    const len = Math.hypot(col[i].x - col[i - 1].x, col[i].y - col[i - 1].y);
    // Only full-width throws — sub-splits and short travels don't measure lean.
    if (len < widthMm * 0.6 || len > widthMm * 2) continue;
    const mid = { x: (col[i].x + col[i - 1].x) / 2, y: (col[i].y + col[i - 1].y) / 2 };
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < center.length; k++) {
      const d = Math.hypot(center[k].x - mid.x, center[k].y - mid.y);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    const a = center[Math.max(0, best - 1)];
    const b = center[Math.min(center.length - 1, best + 1)];
    const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const sx = (col[i].x - col[i - 1].x) / len;
    const sy = (col[i].y - col[i - 1].y) / len;
    const dot = Math.abs((sx * (b.x - a.x) + sy * (b.y - a.y)) / tl);
    const lean = (Math.asin(Math.min(1, dot)) * 180) / Math.PI;
    // Skip throws sitting right ON a corner vertex (the mitre diagonal itself
    // deliberately leans ~45°): their midpoint is within a width of the corner.
    // A closed centerline's seam vertex is a corner too.
    let nearCorner =
      Math.hypot(center[0].x - center[center.length - 1].x, center[0].y - center[center.length - 1].y) <
        1e-9 && Math.hypot(center[0].x - mid.x, center[0].y - mid.y) < widthMm * 1.25;
    for (let k = 1; k < center.length - 1 && !nearCorner; k++) {
      const v1x = center[k].x - center[k - 1].x;
      const v1y = center[k].y - center[k - 1].y;
      const v2x = center[k + 1].x - center[k].x;
      const v2y = center[k + 1].y - center[k].y;
      const dd = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
      if (dd === 0) continue;
      const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / dd));
      if ((Math.acos(cos) * 180) / Math.PI >= 40) {
        if (Math.hypot(center[k].x - mid.x, center[k].y - mid.y) < widthMm * 1.25) {
          nearCorner = true;
          break;
        }
      }
    }
    if (!nearCorner && lean > worst) worst = lean;
  }
  return worst;
}

const lCenter: Path = [];
for (let t = 0; t <= 10; t++) lCenter.push({ x: t, y: 0 });
for (let t = 1; t <= 10; t++) lCenter.push({ x: 10, y: t });

const rect: Path = [];
for (let t = 0; t <= 20; t++) rect.push({ x: t, y: 0 });
for (let t = 1; t <= 12; t++) rect.push({ x: 20, y: t });
for (let t = 19; t >= 0; t--) rect.push({ x: t, y: 12 });
for (let t = 11; t >= 0; t--) rect.push({ x: 0, y: t });

describe("satin corner mitring (sharp rail corners)", () => {
  it("an L-bend column sews with no crossing throws", () => {
    const [l, r] = railsFromCenterline(lCenter, 3);
    const col = satinColumn(l, r, { density: 0.4, pullComp: 0 });
    expect(col.length).toBeGreaterThan(20);
    expect(crossings(col)).toBe(0);
  });

  it("a closed rectangular border sews with no crossing throws", () => {
    const [l, r] = railsFromCenterline(rect, 3, true);
    const col = satinColumn(l, r, { density: 0.4, pullComp: 0 });
    expect(col.length).toBeGreaterThan(100);
    expect(crossings(col)).toBe(0);
  });

  it("border throws stay near-perpendicular to the rails (no progressive skew)", () => {
    const [l, r] = railsFromCenterline(rect, 3, true);
    const col = satinColumn(l, r, { density: 0.4, pullComp: 0 });
    // Pre-fix the arc-fraction mismatch between the long outer rail and short
    // inner rail skewed throws up to 61° off perpendicular.
    expect(maxLeanDeg(col, rect, 3)).toBeLessThan(25);
  });

  it("the corner itself stays covered (a penetration reaches the outer corner)", () => {
    const [l, r] = railsFromCenterline(lCenter, 3);
    const col = satinColumn(l, r, { density: 0.4, pullComp: 0 });
    // The outer rail's corner vertex must have stitching right at it — a mitre
    // splits the column AT the corner, it doesn't skip the corner region.
    const outer = l.reduce(
      (best, p) => {
        const d = Math.hypot(p.x - 11.5, p.y - (-1.5));
        return d < best.d ? { p, d } : best;
      },
      { p: l[0], d: Infinity },
    ).p;
    let nearest = Infinity;
    for (const p of col) nearest = Math.min(nearest, Math.hypot(p.x - outer.x, p.y - outer.y));
    expect(nearest).toBeLessThan(0.8);
  });

  it("is deterministic on cornered rails", () => {
    const [l, r] = railsFromCenterline(lCenter, 3);
    const a = satinColumn(l, r, { density: 0.4, pullComp: 0 });
    const b = satinColumn(l, r, { density: 0.4, pullComp: 0 });
    expect(a).toEqual(b);
  });

  it("leaves straight and gently curved columns on the plain path (no splits)", () => {
    // Straight: identical structure to the classic zig-zag (starts on left rail,
    // alternates, and no interior mitre seam).
    const left: Path = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];
    const right: Path = [
      { x: 0, y: 4 },
      { x: 20, y: 4 },
    ];
    const col = satinColumn(left, right, { density: 0.4, pullComp: 0 });
    expect(col[0].y).toBeCloseTo(0);
    expect(col[1].y).toBeCloseTo(4);
    expect(crossings(col)).toBe(0);
    // Gentle arc (6mm radius, 90° sweep): no corner detected, no crossings.
    const cl: Path = [];
    const cr: Path = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * (Math.PI / 2);
      cl.push({ x: 8 * Math.cos(a), y: 8 * Math.sin(a) });
      cr.push({ x: 5 * Math.cos(a), y: 5 * Math.sin(a) });
    }
    expect(crossings(satinColumn(cl, cr, { density: 0.4, pullComp: 0 }))).toBe(0);
  });
});

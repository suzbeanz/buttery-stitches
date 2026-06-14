import { describe, it, expect } from "vitest";
import { smoothPath, DEFAULT_MAX_SEGMENT_MM } from "./smooth";
import { distance, polylineLength } from "./geometry";
import type { Path, Point } from "../types/project";

/** True if `target` appears (within eps mm) somewhere in `path`. */
function pathContains(path: Path, target: Point, eps = 1e-6): boolean {
  return path.some((p) => distance(p, target) <= eps);
}

/** Distance from point p to the infinite line through a→b. */
function distToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return distance(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

describe("smoothPath", () => {
  it("returns inputs of fewer than 3 points unchanged (copied)", () => {
    expect(smoothPath([])).toEqual([]);

    const one: Path = [{ x: 1, y: 2 }];
    expect(smoothPath(one)).toEqual(one);

    const two: Path = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ];
    const out = smoothPath(two);
    expect(out).toEqual(two);
    // Must be a copy, not the same references.
    expect(out[0]).not.toBe(two[0]);
  });

  it("passes through every control point in order", () => {
    const control: Path = [
      { x: 0, y: 0 },
      { x: 10, y: 8 },
      { x: 20, y: -4 },
      { x: 30, y: 6 },
    ];
    const out = smoothPath(control);
    for (const c of control) {
      expect(pathContains(out, c)).toBe(true);
    }
  });

  it("preserves the endpoints exactly", () => {
    const control: Path = [
      { x: 2, y: 3 },
      { x: 12, y: 9 },
      { x: 25, y: 1 },
    ];
    const out = smoothPath(control);
    expect(out[0]).toEqual(control[0]);
    expect(out[out.length - 1]).toEqual(control[control.length - 1]);
  });

  it("adds intermediate points between the controls", () => {
    const control: Path = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const out = smoothPath(control);
    expect(out.length).toBeGreaterThan(control.length);
  });

  it("respects the maxSegmentMm spacing", () => {
    const control: Path = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
    ];
    const spacing = 0.5;
    const out = smoothPath(control, { maxSegmentMm: spacing });
    for (let i = 1; i < out.length; i++) {
      // Spacing is approximate: the step count is derived from the straight
      // chord, so the actual arc spacing can exceed the target a little on a
      // curved segment. Allow modest slack while still bounding it tightly.
      expect(distance(out[i - 1], out[i])).toBeLessThanOrEqual(spacing * 1.5);
    }
  });

  it("keeps straight (collinear) input essentially straight", () => {
    const control: Path = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
    ];
    const out = smoothPath(control);
    const a = control[0];
    const b = control[control.length - 1];
    for (const p of out) {
      expect(distToLine(p, a, b)).toBeLessThan(1e-6);
    }
    // A straight smoothing shouldn't meaningfully lengthen the path.
    expect(polylineLength(out)).toBeCloseTo(polylineLength(control), 6);
  });

  it("is deterministic", () => {
    const control: Path = [
      { x: 0, y: 0 },
      { x: 7, y: 11 },
      { x: 14, y: -3 },
      { x: 21, y: 5 },
    ];
    expect(smoothPath(control)).toEqual(smoothPath(control));
  });

  it("does not mutate its input", () => {
    const control: Path = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const snapshot = JSON.parse(JSON.stringify(control));
    smoothPath(control);
    expect(control).toEqual(snapshot);
  });

  it("handles duplicate / coincident control points without producing NaN", () => {
    const control: Path = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const out = smoothPath(control);
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(out[0]).toEqual(control[0]);
    expect(out[out.length - 1]).toEqual(control[control.length - 1]);
  });

  it("stays within a reasonable bound of the control polygon (no wild overshoot)", () => {
    const control: Path = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 0 },
      { x: 30, y: 20 },
      { x: 40, y: 0 },
    ];
    const out = smoothPath(control);
    const ys = control.map((p) => p.y);
    const maxY = Math.max(...ys);
    const minY = Math.min(...ys);
    const span = maxY - minY;
    for (const p of out) {
      expect(p.y).toBeLessThanOrEqual(maxY + span * 0.5);
      expect(p.y).toBeGreaterThanOrEqual(minY - span * 0.5);
    }
  });

  it("uses a sensible default spacing", () => {
    const control: Path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    const out = smoothPath(control);
    // With ~0.75 mm default spacing over 200 mm we expect many points.
    expect(out.length).toBeGreaterThan(200 / DEFAULT_MAX_SEGMENT_MM - 5);
  });
});

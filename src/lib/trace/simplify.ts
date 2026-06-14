import type { Path, Point } from "../../types/project";

/** Perpendicular distance from point p to the line through a–b. */
function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // |cross product| / |a→b|
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/**
 * Douglas–Peucker polyline simplification. Drops vertices that lie within
 * `tolerance` of the line between their neighbours — turning a noisy traced
 * outline into a clean, light path. Pure.
 */
export function douglasPeucker(points: Path, tolerance: number): Path {
  if (points.length <= 2 || tolerance <= 0) return points.map((p) => ({ ...p }));

  let maxDist = 0;
  let index = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], a, b);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, index + 1), tolerance);
    const right = douglasPeucker(points.slice(index), tolerance);
    // Drop the duplicated joint vertex.
    return [...left.slice(0, -1), ...right];
  }
  return [{ ...a }, { ...b }];
}

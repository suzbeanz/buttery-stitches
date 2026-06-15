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
 *
 * Implemented iteratively with an explicit work stack and a keep-mask, so a
 * huge traced outline (tens of thousands of points) can't blow the call stack
 * or allocate a new sub-array at every level of recursion.
 */
export function douglasPeucker(points: Path, tolerance: number): Path {
  const n = points.length;
  if (n <= 2 || tolerance <= 0) return points.map((p) => ({ ...p }));

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    const a = points[first];
    const b = points[last];
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out: Path = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ ...points[i] });
  return out;
}

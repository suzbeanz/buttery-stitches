import type { Path, Point } from "../types/project";

/** Plain 2D geometry helpers operating in millimeters. Pure functions only. */

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(p: Point, k: number): Point {
  return { x: p.x * k, y: p.y * k };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Total length of a polyline. */
export function polylineLength(path: Path): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += distance(path[i - 1], path[i]);
  return len;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Axis-aligned bounding box of a set of paths. Returns null if empty. */
export function pathsBounds(paths: Path[]): Bounds | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const path of paths) {
    for (const p of path) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** Translate every point of every path by (dx, dy). */
export function translatePaths(paths: Path[], dx: number, dy: number): Path[] {
  return paths.map((path) => path.map((p) => ({ x: p.x + dx, y: p.y + dy })));
}

/**
 * Drop consecutive points that are within `eps` mm of each other. This cleans
 * up the duplicate vertices a double-click-to-finish leaves behind (the two
 * clicks of the double-click land on the same spot), and any accidental
 * stationary clicks, before an object is committed.
 */
export function dedupePath(path: Path, eps = 0.1): Path {
  const out: Path = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || distance(last, p) > eps) out.push({ ...p });
  }
  return out;
}

/** Midpoint centerline of a rail pair, over the shorter of the two rails. */
export function centerlineOf(left: Path, right: Path): Path {
  const n = Math.min(left.length, right.length);
  const center: Path = [];
  for (let i = 0; i < n; i++) {
    center.push({
      x: (left[i].x + right[i].x) / 2,
      y: (left[i].y + right[i].y) / 2,
    });
  }
  return center;
}

/** A 2D affine matrix in Konva's [a, b, c, d, e, f] form. */
export type Matrix = [number, number, number, number, number, number];

/** Apply an affine matrix to every point of every path. */
export function applyMatrix(paths: Path[], m: Matrix): Path[] {
  const [a, b, c, d, e, f] = m;
  return paths.map((path) =>
    path.map((p) => ({
      x: a * p.x + c * p.y + e,
      y: b * p.x + d * p.y + f,
    })),
  );
}

/** Unit normal (pointing left of the direction a→b). */
function leftNormal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Left normal of (dx,dy) is (-dy, dx).
  return { x: -dy / len, y: dx / len };
}

/** Average two unit normals into a single unit normal. */
function averageNormal(a: Point, b: Point): Point {
  const nx = a.x + b.x;
  const ny = a.y + b.y;
  const len = Math.hypot(nx, ny) || 1;
  return { x: nx / len, y: ny / len };
}

/**
 * Offset a polyline by `dist` mm along its left normal. Vertices use the average
 * of the adjacent segment normals so corners stay continuous. Used to derive a
 * satin rail pair from a centerline.
 *
 * When `closed` is set and the path's first and last points coincide, the path
 * is treated as a loop: the shared seam vertex is offset using its wrap-around
 * neighbors (the segment before the last point and the segment after the first),
 * so the offset ring closes on itself with no gap at the seam.
 */
export function offsetPolyline(path: Path, dist: number, closed = false): Path {
  if (path.length < 2) return path.map((p) => ({ ...p }));

  const isLoop =
    closed && distance(path[0], path[path.length - 1]) < 1e-9 && path.length > 2;

  if (isLoop) {
    // Work on the unique vertices (drop the duplicated closing point), offset
    // each with wrap-around neighbors, then re-close the seam exactly.
    const ring = path.slice(0, -1);
    const m = ring.length;
    const out = ring.map((p, i) => {
      const prev = leftNormal(ring[(i - 1 + m) % m], ring[i]);
      const next = leftNormal(ring[i], ring[(i + 1) % m]);
      const n = averageNormal(prev, next);
      return { x: p.x + n.x * dist, y: p.y + n.y * dist };
    });
    out.push({ ...out[0] });
    return out;
  }

  const normals: Point[] = [];
  for (let i = 0; i < path.length; i++) {
    const prev = i > 0 ? leftNormal(path[i - 1], path[i]) : null;
    const next = i < path.length - 1 ? leftNormal(path[i], path[i + 1]) : null;
    normals.push(averageNormal(prev ?? next!, next ?? prev!));
  }
  return path.map((p, i) => ({
    x: p.x + normals[i].x * dist,
    y: p.y + normals[i].y * dist,
  }));
}

/**
 * Build a satin rail pair from a centerline and total column width.
 * Returns [leftRail, rightRail]. Pass `closed` for a centerline that loops back
 * on itself (e.g. an outline border) so the rails close cleanly at the seam.
 */
export function railsFromCenterline(
  center: Path,
  widthMm: number,
  closed = false,
): [Path, Path] {
  const half = widthMm / 2;
  return [
    offsetPolyline(center, half, closed),
    offsetPolyline(center, -half, closed),
  ];
}

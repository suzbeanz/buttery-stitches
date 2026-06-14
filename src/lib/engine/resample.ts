import type { Path, Point } from "../../types/project";
import { distance } from "../geometry";

/**
 * Geometry resampling helpers used by the stitch algorithms. All pure, all in
 * millimetres.
 */

/**
 * Walk a polyline and place a point every `spacing` mm of arc length. The first
 * vertex is always included, and the final vertex is always landed on exactly
 * (embroidery needs the needle to finish on the real endpoint, not a rounded
 * approximation of it).
 */
export function resampleByDistance(path: Path, spacing: number): Path {
  if (path.length === 0) return [];
  if (path.length === 1 || spacing <= 0) return path.map((p) => ({ ...p }));

  const out: Point[] = [{ ...path[0] }];
  let carry = 0; // distance accumulated since the last placed point

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = distance(a, b);
    if (segLen === 0) continue;
    const dx = (b.x - a.x) / segLen;
    const dy = (b.y - a.y) / segLen;

    let dist = carry;
    while (dist + spacing <= segLen) {
      dist += spacing;
      out.push({ x: a.x + dx * dist, y: a.y + dy * dist });
    }
    carry = segLen - dist; // leftover carried into the next segment
  }

  // Always finish exactly on the last vertex.
  const last = path[path.length - 1];
  const tail = out[out.length - 1];
  if (distance(tail, last) > 1e-6) out.push({ ...last });
  return out;
}

/** Total arc length plus the cumulative length at each vertex. */
function arcLengths(path: Path): { total: number; cum: number[] } {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += distance(path[i - 1], path[i]);
    cum.push(total);
  }
  return { total, cum };
}

/**
 * Resample a polyline into exactly `count` points spaced equally by arc length
 * (endpoints included). Used to march two satin rails in lock-step.
 */
export function resampleByCount(path: Path, count: number): Path {
  if (count < 2 || path.length === 0) return path.map((p) => ({ ...p }));
  if (path.length === 1) return Array.from({ length: count }, () => ({ ...path[0] }));

  const { total, cum } = arcLengths(path);
  if (total === 0) return Array.from({ length: count }, () => ({ ...path[0] }));

  const out: Point[] = [];
  let seg = 1;
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1);
    while (seg < path.length - 1 && cum[seg] < target) seg++;
    const a = path[seg - 1];
    const b = path[seg];
    const segLen = cum[seg] - cum[seg - 1] || 1;
    const t = (target - cum[seg - 1]) / segLen;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Insert intermediate points so no segment exceeds `maxLen` mm. */
export function capSegmentLength(path: Path, maxLen: number): Path {
  if (path.length < 2 || maxLen <= 0) return path.map((p) => ({ ...p }));
  const out: Point[] = [{ ...path[0] }];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = distance(a, b);
    const steps = Math.ceil(len / maxLen);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Rotate a point by `deg` degrees about `pivot`. */
export function rotatePoint(p: Point, deg: number, pivot: Point): Point {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

import type { Path, Point } from "../../types/project";
import { distance } from "../geometry";

/**
 * Geometry resampling helpers used by the stitch algorithms. All pure, all in
 * millimeters.
 */

/** Default minimum stitch length (mm). Penetrations closer than this are merged. */
export const MIN_STITCH_LENGTH = 0.5;

/**
 * Merge consecutive penetrations that fall closer together than `minLen` mm.
 * Tiny stitches do not pull thread through cleanly: the needle can punch the
 * same hole twice, nesting thread on the underside and stressing (or snapping)
 * the needle. We walk the path keeping a running anchor and skipping any point
 * within `minLen` of it, while always preserving the first and last points so
 * an object still starts and ends exactly where it should.
 */
export function dropShortStitches(path: Path, minLen = MIN_STITCH_LENGTH): Path {
  if (path.length < 2 || minLen <= 0) return path.map((p) => ({ ...p }));

  const out: Point[] = [{ ...path[0] }];
  const lastIdx = path.length - 1;
  for (let i = 1; i < lastIdx; i++) {
    if (distance(out[out.length - 1], path[i]) >= minLen) out.push({ ...path[i] });
  }

  // Always keep the true endpoint. If it crowds the previously kept point, drop
  // that previous point instead (never the endpoint) so spacing stays legal,
  // but never drop the start.
  const last = path[lastIdx];
  while (out.length > 1 && distance(out[out.length - 1], last) < minLen) out.pop();
  out.push({ ...last });
  return out;
}

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
  // Arc length from the last placed point forward to the current vertex `a`.
  // The next penetration must land `spacing` past the last placed point, i.e.
  // `spacing - carry` into the upcoming segment.
  let carry = 0;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = distance(a, b);
    if (segLen === 0) continue;
    const dx = (b.x - a.x) / segLen;
    const dy = (b.y - a.y) / segLen;

    let dist = spacing - carry; // first sample's offset into this segment
    while (dist <= segLen + 1e-9) {
      out.push({ x: a.x + dx * dist, y: a.y + dy * dist });
      dist += spacing;
    }
    // Distance from the last placed point to b carries into the next segment.
    carry = segLen - (dist - spacing);
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

/**
 * Split a stitch path into separate runs wherever it makes a travel longer than
 * `maxMm` — those long moves are a fill crossing a counter or gap, which should
 * be a jump (handled by the assembler), not one long snag-prone stitch.
 */
export function splitLongTravels(path: Path, maxMm: number): Path[] {
  if (path.length === 0) return [];
  const runs: Path[] = [];
  let cur: Point[] = [{ ...path[0] }];
  for (let i = 1; i < path.length; i++) {
    if (distance(path[i - 1], path[i]) > maxMm) {
      runs.push(cur);
      cur = [{ ...path[i] }];
    } else {
      cur.push({ ...path[i] });
    }
  }
  runs.push(cur);
  return runs.filter((r) => r.length > 0);
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

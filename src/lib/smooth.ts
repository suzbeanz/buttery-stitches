import type { Path, Point } from "../types/project";
import { distance } from "./geometry";

/**
 * Pure curve smoothing in millimeters.
 *
 * Curves are stored as ordinary densified polylines so the stitch engine and
 * exporter never need to know a curve was involved — the smoothed path is just
 * a denser run of points. The user's clicked points are treated as control
 * points the spline must pass through (a centripetal Catmull-Rom spline, which
 * stays well-behaved and avoids the loops/overshoots a uniform parameterization
 * can produce on unevenly spaced clicks).
 *
 * Everything here is deterministic and side-effect free.
 */

/** Target spacing (mm) between sampled points along a curved segment. */
export const DEFAULT_MAX_SEGMENT_MM = 0.75;

export interface SmoothOptions {
  /**
   * Approximate maximum distance (mm) between adjacent output points along a
   * curve. Smaller means a denser, smoother polyline. Defaults to ~0.75 mm.
   */
  maxSegmentMm?: number;
  /**
   * Hard cap on samples per control-point segment, so a very long segment can't
   * generate an unbounded number of points.
   */
  maxSamplesPerSegment?: number;
}

const EPS = 1e-9;

/**
 * Smooth a path of control points into a densified polyline passing through
 * every control point.
 *
 * Fewer than 3 points cannot describe a curve, so the input is returned as-is
 * (copied). Output always begins at the first control point and ends at the
 * last, with the interior control points preserved exactly in order.
 */
export function smoothPath(path: Path, options: SmoothOptions = {}): Path {
  const maxSegmentMm = Math.max(EPS, options.maxSegmentMm ?? DEFAULT_MAX_SEGMENT_MM);
  const maxSamples = Math.max(1, options.maxSamplesPerSegment ?? 256);

  // A curve needs at least three control points; otherwise pass through.
  if (path.length < 3) return path.map((p) => ({ ...p }));

  const pts = path;
  const out: Path = [{ ...pts[0] }];

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];

    // Pick a sample count from the straight-line span of this segment so the
    // output spacing lands near maxSegmentMm regardless of how the user clicked.
    const span = distance(p1, p2);
    let steps = Math.ceil(span / maxSegmentMm);
    if (steps < 1) steps = 1;
    if (steps > maxSamples) steps = maxSamples;

    // Emit samples for t in (0, 1]; t === 0 is the previous segment's endpoint.
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push(catmullRom(p0, p1, p2, p3, t));
    }
  }

  return out;
}

/**
 * Smooth a CLOSED ring into a soft curve, wrapping the seam so the join is as
 * smooth as the rest of the loop. Used to de-facet traced/flood-filled region
 * outlines so fills follow natural curves instead of stair-steps.
 */
export function smoothClosedRing(ring: Path, maxSegmentMm = 0.6): Path {
  if (ring.length < 4) return ring.map((p) => ({ ...p }));
  const n = ring.length;
  const padded = [ring[n - 1], ...ring, ring[0], ring[1]];
  const sm = smoothPath(padded, { maxSegmentMm });
  // Trim the leading/trailing padding (~one control segment each side).
  const seg = Math.round(sm.length / padded.length);
  const core = sm.slice(seg, sm.length - seg * 2);
  return core.length >= 3 ? core : ring.map((p) => ({ ...p }));
}

/**
 * Centripetal Catmull-Rom interpolation of the spline through p1→p2, using p0
 * and p3 as the neighboring tangent controls. t runs 0 (at p1) to 1 (at p2).
 */
function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  // Centripetal knot spacing (alpha = 0.5) keeps the curve from self-intersecting.
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);

  // Map t in [0,1] onto the [t1, t2] knot interval.
  const tt = t1 + (t2 - t1) * t;

  const a1 = lerpKnot(p0, p1, t0, t1, tt);
  const a2 = lerpKnot(p1, p2, t1, t2, tt);
  const a3 = lerpKnot(p2, p3, t2, t3, tt);

  const b1 = lerpKnot(a1, a2, t0, t2, tt);
  const b2 = lerpKnot(a2, a3, t1, t3, tt);

  return lerpKnot(b1, b2, t1, t2, tt);
}

/** Centripetal knot increment: the square root of the chord length. */
function knot(a: Point, b: Point): number {
  const d = distance(a, b);
  // Guard against coincident control points collapsing a knot interval.
  return Math.sqrt(d) || EPS;
}

/** Linear interpolation between a and b across the knot interval [ta, tb]. */
function lerpKnot(a: Point, b: Point, ta: number, tb: number, t: number): Point {
  const denom = tb - ta;
  const u = Math.abs(denom) < EPS ? 0 : (t - ta) / denom;
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
  };
}

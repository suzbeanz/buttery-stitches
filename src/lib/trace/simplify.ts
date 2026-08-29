import type { Path, Point } from "../../types/project";
import { smoothPath, smoothClosedRing } from "../smooth";
import { polygonArea, polygonPerimeter } from "./classify";

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

/*
 * CORNER-AWARE RING REFINEMENT — the trace pipeline's outline cleanup.
 *
 * The old cleanup (DP at the straighten tolerance, then corner-keeping smooth
 * ON THE SPARSE RESULT) had three measured failure modes:
 *   1. A triangle/quad ring leaves DP with < 5 vertices, which the smoother
 *      treated as "no corners possible" and blob-smoothed — a clean traced
 *      triangle bulged up to 3 mm off its own straight edges.
 *   2. Corner detection by single-vertex turn angle on the SPARSE ring cannot
 *      tell a real shallow corner (a chevron's 135° interior = 45° turn) from
 *      a curve's chord joints (a 5 mm-radius arc's DP chords also meet at
 *      ~50°) — so the threshold sat high (50°) and real corners smoothed away
 *      (135° corners measured rounded to 170°, edges bowed 1.9 mm).
 *   3. The straighten tolerance (0.5 mm) exceeds a thin stroke's own width:
 *      DP collapsed 0.4–0.6 mm strokes into degenerate 3-vertex slivers.
 *
 * This refinement works on the DENSE ring instead: corners are found by the
 * turn measured across fixed-length ARMS walked along the outline, which
 * separates a true corner (the full turn concentrated within a fraction of a
 * millimetre) from a gentle curve (the same turn spread over many
 * millimetres) — the way commercial digitizers pin nodes. Detected corners
 * are pinned, their clipped apexes rebuilt by intersecting straight-line fits
 * of the adjoining edges (the raster + tracer round every sharp tip by
 * 0.3–0.9 mm), each corner-to-corner arc is DP-simplified with its endpoints
 * fixed, and only arcs that kept interior vertices (genuine curves) are
 * Catmull-Rom smoothed. The tolerance is capped at a fraction of the ring's
 * mean width so a thin stroke can never be simplified out of existence.
 */

/** Minimum turn (deg) across the corner arms for a vertex to be pinned as a
 *  true corner. At the 1.25 mm arm this pins interior angles ≤ ~142° while a
 *  curve must be tighter than ~2 mm radius to read as a corner — and such a
 *  tiny curve held as a faceted "corner" deviates by less than a thread width
 *  anyway. The old sparse-ring threshold had to sit at 50°, which rounded off
 *  genuine 135°-interior logo corners. */
export const CORNER_MIN_TURN_DEG = 38;
/** Arm length (mm) for the corner-turn measurement. */
const CORNER_ARM_MM = 1.25;
/** Apex rebuild: fit the adjoining edges over [near, far] mm from the corner
 *  (the near band excludes the rounded tip itself)… */
const APEX_FIT_NEAR_MM = 0.45;
const APEX_FIT_FAR_MM = 2.4;
/** …only when both fits are genuinely straight (rms residual), and never
 *  moving the apex farther than this. */
const APEX_MAX_RESID_MM = 0.16;
const APEX_MAX_SHIFT_MM = 1.2;
/** Simplification tolerance is capped at this fraction of the ring's mean
 *  width so thin strokes survive their own cleanup. */
const THIN_TOL_FRACTION = 0.35;
/** Floor for the width-aware cap — below this, tolerance is raster noise. */
const MIN_TOL_MM = 0.08;
/** Adjacent vertices closer than this collapse into one (trace seams leave
 *  duplicate-ish start/end vertices that poison turn measurements). */
const DEDUPE_MM = 0.02;

/** Ring with the closing duplicate + near-coincident neighbours removed. */
function dedupeRing(ring: Path): Path {
  const out: Path = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < DEDUPE_MM) continue;
    out.push({ ...p });
  }
  while (
    out.length > 1 &&
    Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < DEDUPE_MM
  ) {
    out.pop();
  }
  return out;
}

/** Point at arc distance `dist` from vertex i walking the closed ring in
 *  `dir` (+1/-1), interpolated within the landing segment. */
function walkPoint(ring: Path, i: number, dist: number, dir: 1 | -1): Point {
  const n = ring.length;
  let acc = 0;
  let cur = i;
  for (let steps = 0; steps < n; steps++) {
    const nxt = (cur + dir + n) % n;
    const seg = Math.hypot(ring[nxt].x - ring[cur].x, ring[nxt].y - ring[cur].y);
    if (acc + seg >= dist) {
      const t = seg > 0 ? (dist - acc) / seg : 0;
      return {
        x: ring[cur].x + (ring[nxt].x - ring[cur].x) * t,
        y: ring[cur].y + (ring[nxt].y - ring[cur].y) * t,
      };
    }
    acc += seg;
    cur = nxt;
  }
  return { ...ring[cur] };
}

/** Turn (deg) at vertex i measured across ±`armMm` arms: 0 = straight-through,
 *  90 = right-angle corner. Arm-based measurement reads a staircase or gentle
 *  curve as near-straight while a true corner keeps its full angle. */
function armTurnDeg(ring: Path, i: number, armMm: number): number {
  const p = ring[i];
  const a = walkPoint(ring, i, armMm, -1);
  const b = walkPoint(ring, i, armMm, 1);
  const v1x = a.x - p.x;
  const v1y = a.y - p.y;
  const v2x = b.x - p.x;
  const v2y = b.y - p.y;
  const l = (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)) || 1e-9;
  const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / l));
  return 180 - (Math.acos(dot) * 180) / Math.PI;
}

/** Corner vertices of the dense ring: arm-turn ≥ threshold, non-max suppressed
 *  so each physical corner yields exactly one pinned vertex. */
function detectCorners(ring: Path, armMm: number): number[] {
  const n = ring.length;
  const turns = new Array<number>(n);
  for (let i = 0; i < n; i++) turns[i] = armTurnDeg(ring, i, armMm);
  const segLen = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const b = ring[(i + 1) % n];
    segLen[i] = Math.hypot(b.x - ring[i].x, b.y - ring[i].y);
  }
  const cand: number[] = [];
  for (let i = 0; i < n; i++) if (turns[i] >= CORNER_MIN_TURN_DEG) cand.push(i);
  if (cand.length === 0) return [];
  // Cluster candidates whose separating arc is under one arm; keep each
  // cluster's max-turn vertex. Start after a gap so no cluster wraps split.
  let start = 0;
  for (let k = 0; k < cand.length; k++) {
    const prev = cand[(k - 1 + cand.length) % cand.length];
    let arc = 0;
    for (let i = prev; i !== cand[k]; i = (i + 1) % n) arc += segLen[i];
    if (arc > armMm) {
      start = k;
      break;
    }
  }
  const corners: number[] = [];
  let best = cand[start];
  let prev = cand[start];
  for (let k = 1; k <= cand.length; k++) {
    const idx = cand[(start + k) % cand.length];
    if (k === cand.length) {
      corners.push(best);
      break;
    }
    let arc = 0;
    for (let i = prev; i !== idx; i = (i + 1) % n) arc += segLen[i];
    if (arc > armMm) {
      corners.push(best);
      best = idx;
    } else if (turns[idx] > turns[best]) {
      best = idx;
    }
    prev = idx;
  }
  return corners.sort((a, b) => a - b);
}

/** Total-least-squares line through pts: point on line + unit direction, and
 *  the rms residual. Null when degenerate. */
function fitLine(pts: Point[]): { p: Point; d: Point; rms: number } | null {
  if (pts.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const d = { x: Math.cos(ang), y: Math.sin(ang) };
  let res = 0;
  for (const p of pts) {
    const off = (p.x - mx) * -d.y + (p.y - my) * d.x;
    res += off * off;
  }
  return { p: { x: mx, y: my }, d, rms: Math.sqrt(res / pts.length) };
}

/** Rebuild a corner's clipped apex: fit straight lines to the ring on each
 *  side of the corner (skipping the rounded tip) and move the corner vertex to
 *  their intersection. Falls back to the original vertex whenever either side
 *  isn't straight, the window is too cramped, or the shift is implausible. */
function restoreApex(ring: Path, ci: number, farLimitPrev: number, farLimitNext: number): Point {
  const orig = ring[ci];
  const collect = (dir: 1 | -1, farLimit: number): Point[] => {
    const far = Math.min(APEX_FIT_FAR_MM, farLimit);
    if (far - APEX_FIT_NEAR_MM < 0.5) return [];
    const pts: Point[] = [];
    const steps = 5;
    for (let s = 0; s <= steps; s++) {
      pts.push(walkPoint(ring, ci, APEX_FIT_NEAR_MM + ((far - APEX_FIT_NEAR_MM) * s) / steps, dir));
    }
    return pts;
  };
  const a = fitLine(collect(-1, farLimitPrev));
  const b = fitLine(collect(1, farLimitNext));
  if (!a || !b || a.rms > APEX_MAX_RESID_MM || b.rms > APEX_MAX_RESID_MM) return orig;
  const det = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(det) < 0.2) return orig; // near-parallel: no stable intersection
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / det;
  const apex = { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t };
  if (Math.hypot(apex.x - orig.x, apex.y - orig.y) > APEX_MAX_SHIFT_MM) return orig;
  return apex;
}

/**
 * Clean a traced ring (mm) the corner-aware way: pin true corners (arm-turn
 * detection on the dense outline), rebuild their clipped apexes, straighten
 * each corner-to-corner stretch with DP at a width-capped tolerance, and
 * Catmull-Rom only the stretches that are genuinely curved. With no corners
 * (a blob) it simplifies and smooths the whole ring, like before.
 */
export function refineTracedRing(ring: Path, tolMm: number): Path {
  const pts = dedupeRing(ring);
  const n = pts.length;
  if (n < 4) return pts;
  const area = polygonArea(pts);
  const perim = polygonPerimeter(pts);
  const meanWidth = perim > 0 ? (2 * area) / perim : 0;
  const tol = Math.max(MIN_TOL_MM, Math.min(tolMm, meanWidth * THIN_TOL_FRACTION));
  // The corner arm scales down with the ring's own width: on a 0.5 mm-wide
  // stroke a 1.25 mm arm reaches around the bar's end, reads its two corners
  // as one hairpin, and the suppression collapses them — the end then smooths
  // into a bow. A thin feature's corners live at its own scale.
  const armMm = Math.min(CORNER_ARM_MM, Math.max(0.4, meanWidth * 0.8));
  const corners = detectCorners(pts, armMm);
  if (corners.length === 0) {
    const dp = douglasPeucker(pts, tol);
    return dp.length >= 5 ? smoothClosedRing(dp, 0.6) : dp;
  }
  // Arc length between consecutive corners (for the apex-fit windows).
  const arcBetween = (i: number, j: number): number => {
    let arc = 0;
    for (let k = i; k !== j; k = (k + 1) % n) {
      const b = pts[(k + 1) % n];
      arc += Math.hypot(b.x - pts[k].x, b.y - pts[k].y);
    }
    return arc;
  };
  const refined = pts.slice();
  for (let k = 0; k < corners.length; k++) {
    const ci = corners[k];
    const prevC = corners[(k - 1 + corners.length) % corners.length];
    const nextC = corners[(k + 1) % corners.length];
    const toPrev = corners.length === 1 ? perim : arcBetween(prevC, ci);
    const toNext = corners.length === 1 ? perim : arcBetween(ci, nextC);
    refined[ci] = restoreApex(pts, ci, toPrev * 0.5, toNext * 0.5);
  }
  const out: Path = [];
  for (let k = 0; k < corners.length; k++) {
    const ci = corners[k];
    const cj = corners[(k + 1) % corners.length];
    const arc: Path = [refined[ci]];
    for (let i = (ci + 1) % n; ; i = (i + 1) % n) {
      arc.push(refined[i]);
      if (i === cj) break;
      if (i === ci) break; // single corner: full loop
    }
    if (corners.length === 1) arc.push(refined[ci]); // close the lone-corner loop
    const dp = douglasPeucker(arc, tol);
    // Interior vertices survived DP → the stretch genuinely curves; smooth it.
    // A straight stretch is exactly its two endpoints and stays straight. But
    // never Catmull-Rom across an interior vertex that itself turns sharply —
    // that is a corner the arm suppression missed (two corners of a thin bar's
    // end inside one arm), and smoothing through it bows the edges around it.
    const sharpInterior = dp.some((p, i) => {
      if (i === 0 || i === dp.length - 1) return false;
      const a = dp[i - 1];
      const b = dp[i + 1];
      const l = (Math.hypot(a.x - p.x, a.y - p.y) * Math.hypot(b.x - p.x, b.y - p.y)) || 1e-9;
      const dot = Math.max(-1, Math.min(1, ((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) / l));
      return 180 - (Math.acos(dot) * 180) / Math.PI >= 55;
    });
    const sm = dp.length >= 3 && !sharpInterior ? smoothPath(dp, { maxSegmentMm: 0.6 }) : dp;
    for (let i = 0; i < sm.length - 1; i++) out.push(sm[i]);
  }
  return out.length >= 3 ? out : pts;
}

import type { Path } from "../../types/project";
import { centerlineOf, distance } from "../geometry";
import { runningStitch } from "./running";
import { resampleByCount } from "./resample";
import { tatamiFill } from "./fill";

/**
 * Underlay passes. Underlay is the low-density first pass that stabilizes the
 * fabric before the top stitches go down — it's what separates clean output from
 * amateur, puckered output.
 */

/** Stitch length (mm) for underlay running passes. */
const UNDERLAY_STITCH = 2.5;

/**
 * Row spacing (mm) for the parallel (tatami) underlay pass under a fill. Much
 * wider than a top fill so it only stabilizes the interior — it must never show
 * through the top layer.
 */
const FILL_UNDERLAY_ROW = 2.5;

/** Wider satin columns get an extra edge run down each rail for stability. */
const SATIN_EDGE_RUN_WIDTH = 3;

/**
 * Mean width of a satin column (average rail-to-rail gap). Used to decide when a
 * column is wide enough to need an edge run on top of the centerline run.
 */
function meanColumnWidth(left: Path, right: Path): number {
  const n = Math.min(left.length, right.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += distance(left[i], right[i]);
  return sum / n;
}

/**
 * Fill underlay: two passes that lock the region down before the top tatami.
 *  1. An edge run around the outline so the perimeter cannot creep inward.
 *  2. A low-density parallel (tatami) pass run roughly perpendicular to the top
 *     fill angle, which stops the top rows from sliding along their own
 *     direction and gives them something to bite into.
 *
 * The perpendicular pass uses a wide row spacing so it stays buried under the
 * top layer. `topAngle` is the angle the top fill will be stitched at.
 */
export function fillUnderlay(rings: Path[], topAngle = 0): Path {
  return [...fillEdgeUnderlay(rings), ...fillParallelUnderlay(rings, topAngle)];
}

/**
 * Centerline running underlay for a satin stroke. A run straight down the
 * column's center anchors it to the fabric so the top throws sit flat with loft
 * — the standard underlay for satin lettering (better than tracing the glyph's
 * silhouette, which leaves the column interior unsupported).
 */
export function centerlineUnderlay(centerline: Path): Path {
  return centerline.length >= 2 ? runningStitch(centerline, UNDERLAY_STITCH) : [];
}

/** Edge run around the region outline (pass 1 of the fill underlay). */
export function fillEdgeUnderlay(rings: Path[]): Path {
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  // Close the outline so the edge run returns to its start.
  const closed = [...outer, outer[0]];
  return runningStitch(closed, UNDERLAY_STITCH);
}

/** Low-density parallel pass perpendicular to the top angle (pass 2). */
export function fillParallelUnderlay(rings: Path[], topAngle = 0): Path {
  if (!rings[0] || rings[0].length < 3) return [];
  return tatamiFill(rings, {
    density: FILL_UNDERLAY_ROW,
    angle: topAngle + 90,
    stitchLength: UNDERLAY_STITCH,
  });
}

/**
 * Satin underlay: a centerline running stitch down the column to anchor it so
 * the satin throws sit flat. Wide columns also get an edge run down each rail,
 * because a single centerline cannot hold a broad column's edges from pulling
 * in under the top throws.
 */
export function satinUnderlay(left: Path, right: Path): Path {
  if (left.length < 2 || right.length < 2) return [];
  // Match the rails point-for-point first. `centerlineOf` and the width check
  // pair rails by index, which is only meaningful when both have the same vertex
  // count — not guaranteed for edited or imported satin. Resampling both to a
  // common count keeps the centerline and edge runs aligned to the real column.
  const n = Math.max(left.length, right.length);
  const l = resampleByCount(left, n);
  const r = resampleByCount(right, n);

  const center = centerlineOf(l, r);
  const out = runningStitch(center, UNDERLAY_STITCH);

  if (meanColumnWidth(l, r) >= SATIN_EDGE_RUN_WIDTH) {
    // Run up the right rail and back down the left so the pass ends near the
    // centerline start, keeping travel into the top layer short.
    out.push(...runningStitch(r, UNDERLAY_STITCH));
    out.push(...runningStitch([...l].reverse(), UNDERLAY_STITCH));
  }

  return out;
}

import type { Path } from "../../types/project";
import { centerlineOf, distance } from "../geometry";
import { runningStitch } from "./running";
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
  const center = centerlineOf(left, right);
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
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];

  // Close the outline so the edge run returns to its start.
  const closed = [...outer, outer[0]];
  const edge = runningStitch(closed, UNDERLAY_STITCH);

  // Parallel pass laid perpendicular to the eventual top angle.
  const parallel = tatamiFill(rings, {
    density: FILL_UNDERLAY_ROW,
    angle: topAngle + 90,
    stitchLength: UNDERLAY_STITCH,
  });

  return [...edge, ...parallel];
}

/**
 * Satin underlay: a centerline running stitch down the column to anchor it so
 * the satin throws sit flat. Wide columns also get an edge run down each rail,
 * because a single centerline cannot hold a broad column's edges from pulling
 * in under the top throws.
 */
export function satinUnderlay(left: Path, right: Path): Path {
  if (left.length < 2 || right.length < 2) return [];
  const center = centerlineOf(left, right);
  const out = runningStitch(center, UNDERLAY_STITCH);

  if (meanColumnWidth(left, right) >= SATIN_EDGE_RUN_WIDTH) {
    // Run up the right rail and back down the left so the pass ends near the
    // centerline start, keeping travel into the top layer short.
    out.push(...runningStitch(right, UNDERLAY_STITCH));
    out.push(...runningStitch([...left].reverse(), UNDERLAY_STITCH));
  }

  return out;
}

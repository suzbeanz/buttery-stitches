import type { Path } from "../../types/project";
import { centerlineOf } from "../geometry";
import { runningStitch } from "./running";

/**
 * Underlay passes. Underlay is the low-density first pass that stabilises the
 * fabric before the top stitches go down — it's what separates clean output from
 * amateur, puckered output.
 */

/** Stitch length (mm) for underlay running passes. */
const UNDERLAY_STITCH = 2.5;

/**
 * Fill underlay: a running stitch around the region outline (edge run). Holds
 * the fabric at the edges so the tatami top layer doesn't drag it inward.
 */
export function fillUnderlay(rings: Path[]): Path {
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  // Close the outline so the run returns to its start.
  const closed = [...outer, outer[0]];
  return runningStitch(closed, UNDERLAY_STITCH);
}

/**
 * Satin underlay: a centreline running stitch down the column. Anchors the
 * column so the satin throws sit flat.
 */
export function satinUnderlay(left: Path, right: Path): Path {
  if (left.length < 2 || right.length < 2) return [];
  const center = centerlineOf(left, right);
  return runningStitch(center, UNDERLAY_STITCH);
}

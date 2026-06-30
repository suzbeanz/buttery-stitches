import type { Path } from "../../types/project";
import {
  centerlineOf,
  distance,
  offsetPolyline,
  railsFromCenterline,
  polylineLength,
} from "../geometry";
import { signedArea } from "../trace/classify";
import { runningStitch } from "./running";
import { resampleByCount } from "./resample";
import { staggeredSatin } from "./satin";
import { tatamiFill, tatamiConcaveRuns } from "./fill";

/** Longest safe underlay zig-zag throw (mm); wider columns split the throw. */
const UNDERLAY_MAX_THROW = 6;

/**
 * Underlay passes — the low-density first stitching that stabilizes the fabric
 * and gives the top layer loft. Choosing the right underlay for the stitch type
 * and width (docs/stitch-logic.md §5) is what separates clean output from
 * amateur, puckered output. Underlay runs FIRST, sits INSET from the edge so it
 * never peeks past the top, and stays low-density.
 */

/** Stitch length (mm) for underlay running passes (pro range 1.5–2.0 mm). */
const UNDERLAY_STITCH = 2.0;
/** Row spacing (mm) for a parallel (tatami) underlay pass under a fill — coarse,
 *  well under the top density, so it stabilizes without adding bulk. */
const FILL_UNDERLAY_ROW = 2.5;
/** mm a fill edge run is held inside the shape edge so it hides under the top
 *  (pro inset 0.4–0.6 mm). */
const EDGE_INSET = 0.5;
/** mm a satin edge-walk run sits inside each rail. Pro inset is ~0.35 mm on
 *  straight runs but 0.6–0.7 mm through curves; we use the curve-safe value so
 *  the inset rails don't fold on tight serpentine columns. */
const SATIN_EDGE_INSET = 0.6;
/** Column width (mm) that earns an edge-walk underlay (center-run only below it).
 *  Set at ~2 mm: the thin/mid satin rungs read "rough" on a sew-out with only a
 *  center run under them — the edge walk lays a foundation just inside each rail
 *  so the column's borders set crisp instead of sinking ragged into soft fabric.
 *  Below ~2 mm the inset rails would cross, so those keep the center run alone. */
const SATIN_EDGE_WIDTH = 2.0;
/** Column width (mm) that earns a zig-zag underlay (≥4 mm). */
const SATIN_ZIGZAG_WIDTH = 4;

/** How heavy the underlay should be (set by fabric, see §8). */
export type UnderlayWeight = "light" | "standard" | "heavy";

/** Mean rail-to-rail width of a satin column. */
function meanColumnWidth(left: Path, right: Path): number {
  const n = Math.min(left.length, right.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += distance(left[i], right[i]);
  return sum / n;
}

/** A coarse zig-zag across a rail pair — a stabilizing underlay for wide columns.
 *  Throws wider than a safe length split (so a wide column's underlay never snags). */
function zigzag(left: Path, right: Path, spacing: number): Path {
  const len = (polylineLength(left) + polylineLength(right)) / 2;
  const n = Math.max(2, Math.round(len / Math.max(0.5, spacing)) + 1);
  const l = resampleByCount(left, n);
  const r = resampleByCount(right, n);
  const pairs: [Path[0], Path[0]][] = [];
  for (let i = 0; i < n; i++) pairs.push(i % 2 === 0 ? [l[i], r[i]] : [r[i], l[i]]);
  return staggeredSatin(pairs, UNDERLAY_MAX_THROW);
}

/**
 * Underlay for one satin stroke given its centerline and width, returned as
 * separate runs (the caller jumps between them). Tiered by width and weight:
 *   light             → centerline run only
 *   standard, ≥2 mm   → + edge-walk (a run just inside each rail)
 *   ≥4 mm or heavy    → + a zig-zag across the column
 *
 * Ordering matters: the zig-zag is laid BEFORE the edge walk. If the edge run
 * went down first, the later wide zig-zag would pull it inward and ruin the
 * crisp border — so we stitch zig-zag → edge → (top), the digitizer's rule.
 */
export function columnUnderlay(
  centerline: Path,
  widthMm: number,
  weight: UnderlayWeight = "standard",
): Path[] {
  if (centerline.length < 2) return [];
  const runs: Path[] = [runningStitch(centerline, UNDERLAY_STITCH)];
  if (weight === "light") return runs;

  // A thin/mid column (2–3 mm) qualifies for the edge walk, but the curve-safe
  // 0.6 mm inset leaves ~0.6 mm of each border with no underlay foundation, so the
  // outer satin stitches sink into bare fabric and read soft (the 2 mm rung on the
  // sew-out). Pull the edge walk closer to the rail on narrow columns (the tighter
  // inset only risks folding on WIDE curved columns, which keep 0.6). 1 mm stays
  // center-run only — its rails still cross.
  const edgeInset = widthMm < 3 ? 0.4 : SATIN_EDGE_INSET;
  const railWidth = widthMm - 2 * edgeInset; // rails just inside the edges
  const wantEdge = railWidth > 0.5 && (widthMm >= SATIN_EDGE_WIDTH || weight === "heavy");
  const wantZig = railWidth > 0.5 && (widthMm >= SATIN_ZIGZAG_WIDTH || weight === "heavy");

  if (wantZig) {
    const [l, r] = railsFromCenterline(centerline, railWidth);
    runs.push(zigzag(l, r, UNDERLAY_STITCH));
  }
  if (wantEdge) {
    const [l, r] = railsFromCenterline(centerline, railWidth);
    runs.push(runningStitch(r, UNDERLAY_STITCH));
    runs.push(runningStitch([...l].reverse(), UNDERLAY_STITCH));
  }
  return runs;
}

/**
 * Centerline running underlay for a satin stroke (the lightest tier). Kept for
 * callers that want a single anchoring run.
 */
export function centerlineUnderlay(centerline: Path): Path {
  return centerline.length >= 2 ? runningStitch(centerline, UNDERLAY_STITCH) : [];
}

/** Inset a closed ring inward by `inset` mm; falls back to the ring if degenerate. */
function insetRing(outer: Path, inset: number): Path {
  const closed =
    outer.length >= 2 &&
    outer[0].x === outer[outer.length - 1].x &&
    outer[0].y === outer[outer.length - 1].y
      ? outer
      : [...outer, outer[0]];
  const areaO = Math.abs(signedArea(outer));
  if (areaO < 1) return closed;
  // Inward is whichever offset direction shrinks the area.
  const candidates = [inset, -inset]
    .map((d) => offsetPolyline(closed, d, true))
    .filter((c) => c.length >= 3);
  const shrunk = candidates
    .filter((c) => {
      const a = Math.abs(signedArea(c));
      return a > 1 && a < areaO;
    })
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  return shrunk[0] ?? closed;
}

/**
 * Fill underlay: an inset edge run + one (or two, for heavy) low-density parallel
 * passes the top rows can bite into. Returned as separate runs.
 */
export function fillUnderlayRuns(
  rings: Path[],
  topAngle = 0,
  weight: UnderlayWeight = "standard",
): Path[] {
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  const runs: Path[] = [fillEdgeUnderlay(rings)];
  if (weight !== "light") {
    runs.push(...parallelUnderlayRuns(rings, topAngle));
    if (weight === "heavy") runs.push(...parallelUnderlayRuns(rings, topAngle + 45));
  }
  return runs.filter((r) => r.length >= 2);
}

/** Concavity-aware parallel underlay: per-cell serpentine runs (no straight
 *  connector slashing across a notch). The region is inset first so rows stop
 *  short of the edge and stay buried under the top fill. */
function parallelUnderlayRuns(rings: Path[], topAngle = 0): Path[] {
  if (!rings[0] || rings[0].length < 3) return [];
  const inset = [insetRing(rings[0], EDGE_INSET), ...rings.slice(1)];
  return tatamiConcaveRuns(inset, {
    density: FILL_UNDERLAY_ROW,
    angle: topAngle + 90,
    stitchLength: UNDERLAY_STITCH,
  });
}

/** Legacy combined fill underlay (edge + one parallel) as a single path. */
export function fillUnderlay(rings: Path[], topAngle = 0): Path {
  return [...fillEdgeUnderlay(rings), ...fillParallelUnderlay(rings, topAngle)];
}

/** Edge run around the region, inset ~1 mm so it stays hidden under the top. */
export function fillEdgeUnderlay(rings: Path[]): Path {
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  const inset = insetRing(outer, EDGE_INSET);
  const closed =
    inset[0].x === inset[inset.length - 1].x && inset[0].y === inset[inset.length - 1].y
      ? inset
      : [...inset, inset[0]];
  return runningStitch(closed, UNDERLAY_STITCH);
}

/** Low-density parallel pass perpendicular to the top angle. The region is inset
 *  first so the underlay rows stop SHORT of the edge and stay buried under the top
 *  fill — an underlay row-end reaching the boundary is what pokes a stray "whisker"
 *  past the silhouette on a convex tip. */
export function fillParallelUnderlay(rings: Path[], topAngle = 0): Path {
  if (!rings[0] || rings[0].length < 3) return [];
  const inset = [insetRing(rings[0], EDGE_INSET), ...rings.slice(1)];
  return tatamiFill(inset, {
    density: FILL_UNDERLAY_ROW,
    angle: topAngle + 90,
    stitchLength: UNDERLAY_STITCH,
  });
}

/**
 * Satin underlay for a rail pair, tiered by the column width and fabric weight.
 * Returns separate runs (centerline, edge-walk, zig-zag as warranted).
 */
export function satinUnderlay(
  left: Path,
  right: Path,
  weight: UnderlayWeight = "standard",
): Path[] {
  if (left.length < 2 || right.length < 2) return [];
  const n = Math.max(left.length, right.length);
  const l = resampleByCount(left, n);
  const r = resampleByCount(right, n);
  return columnUnderlay(centerlineOf(l, r), meanColumnWidth(l, r), weight);
}

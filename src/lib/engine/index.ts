import type {
  EmbObject,
  FabricProfile,
  Path,
  Point,
  Project,
} from "../../types/project";
import { resolveParams, fabricProfile } from "../../types/project";
import { effectiveProfile } from "./profile";
import { distance, railsFromCenterline, pathsBounds, offsetPolyline } from "../geometry";
import { runningStitch } from "./running";
import { satinColumn } from "./satin";
import { tatamiFill, tatamiConcaveRuns, multiBlendFill, motifFill, motifRunAlong, carvePoints, splitFillRegions, autoFillAngleForRegions } from "./fill";
import { contourFill } from "./contour";
import { medialColumns, columnsFromCenterlines, satinCoverage, residualRegions, type SatinColumn } from "./medial";
import { turningFill, flowFill, flowAlong } from "./turning";
import { isSmallRoundFill } from "./classify";
import { columnUnderlay, fillUnderlayRuns, satinUnderlay } from "./underlay";
import { dropShortStitches, splitLongTravels } from "./resample";

export * from "./running";
export * from "./satin";
export * from "./fill";
export * from "./resample";

/**
 * One needle event in the assembled design (millimeters).
 *  - `jump`: a travel move with no penetration (positions the needle).
 *  - `trim`: cut the thread before this event.
 *  - `underlay`: part of the stabilizing underlay pass (rendered dimmer).
 */
export interface EngineStitch {
  x: number;
  y: number;
  colorId: string;
  objectId: string;
  jump?: boolean;
  trim?: boolean;
  underlay?: boolean;
  /** machine STOP after this point (appliqué: pause to lay/trim fabric). */
  stop?: boolean;
}

export interface DesignOptions {
  /** travels longer than this (mm) become a jump (default 3) */
  jumpThreshold?: number;
  /** travels longer than this (mm) also trim the thread (default 8) */
  trimThreshold?: number;
  /**
   * Insert automatic lock/tie stitches at the start of each thread run and
   * before every trim (default true). Disable in tests that assert raw counts.
   */
  lockStitches?: boolean;
}

/** Amplitude (mm) of a tie/lock stitch — a tiny zig back and forth. */
const TIE_AMPLITUDE = 0.8;
/** Number of penetrations in one tie/lock cluster. */
const TIE_COUNT = 3;
/** Stitch length (mm) for a travel run connecting nearby same-color shapes. */
const TRAVEL_STITCH = 2.5;
/** Longest same-color gap (mm) we'll sew as a hidden travel UNDER later coverage
 *  rather than trim. Beyond this, a trim is cheaper than the extra thread. */
const MAX_COVERED_TRAVEL = 40;
/** Longest EXPOSED (un-hidden) same-color gap still bridged with a stitched
 *  travel rather than trimmed. Kept small so touching elements connect but
 *  anything that would show as a thread slash across open fabric is cut. */
const EXPOSED_TRAVEL_MAX = 4;
/** Longest gap (mm) bridged with a travel WITHIN one connected fill region (its
 *  own serpentine/spans), so a concave shape connects instead of trimming each
 *  row. Between separate regions, only a hidden or short gap travels. */
const INTRA_REGION_TRAVEL = 25;

/** Even-odd point-in-region test over a fill object's rings (outer + holes). */
function pointInRings(p: Point, rings: Point[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Build a small cluster of real penetrations that lock the thread at `anchor`.
 * The cluster zig-zags toward `toward` and back, ending on `anchor` so the
 * following (or preceding) stitching continues cleanly. The bite is the actual
 * distance to the neighboring penetration, capped at `TIE_AMPLITUDE` — so on
 * dense satin/fill the lock lands exactly ON the first real stitch (hidden under
 * it, never poking past the edge of a small shape), and on sparse running it's a
 * tidy ~0.8 mm tack. Genuine needle penetrations, never jumps, so the machine
 * actually fastens the thread instead of relying on tension alone.
 */
function tieStitches(anchor: Point, toward: Point): Point[] {
  const dx = toward.x - anchor.x;
  const dy = toward.y - anchor.y;
  const len = Math.hypot(dx, dy);
  // Aim the tie along the run direction; fall back to +x for a degenerate point.
  const ux = len > 1e-6 ? dx / len : 1;
  const uy = len > 1e-6 ? dy / len : 0;
  // Bite no further than the real neighbor stitch, so the lock hides under it.
  const bite = Math.min(TIE_AMPLITUDE, len > 1e-6 ? len : TIE_AMPLITUDE);
  const near: Point = { x: anchor.x + ux * bite, y: anchor.y + uy * bite };

  const out: Point[] = [];
  for (let i = 0; i < TIE_COUNT; i++) out.push(i % 2 === 0 ? near : { ...anchor });
  out.push({ ...anchor }); // always finish exactly on the anchor
  return out;
}

/**
 * One continuous run of penetrations the needle sews without lifting. Underlay
 * and top layer are separate runs, and a fill yields a run per disjoint region,
 * so the assembler can jump between them instead of dragging one long stitch
 * (from an edge-run to the fill start, or across the gap between two letters).
 */
export interface StitchRun {
  pts: Point[];
  underlay: boolean;
  /** object-local connected-region index. Travels WITHIN a region connect (a
   *  fill's own serpentine); moves between regions (separate letters/blobs) trim
   *  unless hidden. Default 0 for single-region objects (running/satin). */
  region?: number;
  /** emit a machine STOP after this run (appliqué fabric placement/trim pause). */
  stopAfter?: boolean;
  /** disallow a BARE same-region travel into this run (one that isn't hidden under
   *  a fill). Set for satin columns: connectors between a glyph's columns must run
   *  hidden under the stitching or be trimmed, never slash across a counter. Tatami
   *  rows leave this false so a fill's own spans still bridge a notch. */
  noBareTravel?: boolean;
  /** TRIM across any gap into this run — never bridge it with a stitched travel, not
   *  even a hidden/buried one. Set for top-layer line-art (an outline, a ladder): the
   *  separate strokes shouldn't be linked by thread (a buried connector still shows
   *  where it crosses a gap between strokes), so a clean jump+trim is the right move. */
  trimGaps?: boolean;
  /** override thread color for this run (multi-blend's second color); defaults to
   *  the object's colorId. */
  colorId?: string;
}

/** Push a run if it has any penetrations. */
function addRun(
  runs: StitchRun[],
  pts: Point[],
  underlay: boolean,
  region = 0,
  noBareTravel = false,
  colorId?: string,
  trimGaps = false,
): void {
  if (pts.length > 0) runs.push({ pts, underlay, region, noBareTravel, colorId, trimGaps });
}

/**
 * Minimum fraction of a region a medial satin must cover to be used. Below this
 * the skeleton produced broken/scattered stitches, so we fall back to tatami.
 */
const MIN_SATIN_COVERAGE = 0.82;

/** Coverage bar for an AUTHORED decomposition (lower than the auto gate): the spec
 *  is trusted and the residual fill closes the small wedges where strokes are
 *  authored short of a junction. Below this the spec clearly didn't fit the glyph,
 *  so we fall back to the auto skeleton. */
const AUTHORED_MIN_COVERAGE = 0.65;

/** A region whose larger dimension is below this is a tittle/period/accent — sewn
 *  as one satin block across its long axis, not skeletonized into a cross. */
const SMALL_FEATURE_MM = 3.2;

/** Gradient fillStyle: the sparse edge is this multiple of the dense row spacing. */
const GRADIENT_FILL_MUL = 2.6;

/** Half-width (mm) of a carved relief groove: penetrations within this of a carve
 *  curve are skipped. Thin, so the float across the groove stays machine-safe. */
const CARVE_GROOVE_MM = 0.8;

/**
 * Greedily order a set of independent runs so each starts near where the last
 * ended, reversing a run when its far end is the closer one. Shortens the travel
 * (and so the jumps) between a region's satin strokes without changing any
 * stitch geometry.
 */
function orderByNearest(runs: Point[][], from: Point | null): Point[][] {
  const remaining = runs.filter((r) => r.length > 0);
  const out: Point[][] = [];
  let cursor = from;
  while (remaining.length > 0) {
    let best = 0;
    let bestReversed = false;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      if (!cursor) {
        best = i;
        bestReversed = false;
        break;
      }
      const head = r[0];
      const tail = r[r.length - 1];
      const dHead = Math.hypot(head.x - cursor.x, head.y - cursor.y);
      const dTail = Math.hypot(tail.x - cursor.x, tail.y - cursor.y);
      if (dHead < bestDist) {
        bestDist = dHead;
        best = i;
        bestReversed = false;
      }
      if (dTail < bestDist) {
        bestDist = dTail;
        best = i;
        bestReversed = true;
      }
    }
    const [chosen] = remaining.splice(best, 1);
    const run = bestReversed ? [...chosen].reverse() : chosen;
    out.push(run);
    cursor = run[run.length - 1];
  }
  return twoOptRuns(out, from);
}

/** Largest run count we 2-opt; beyond this the O(n²) passes aren't worth it. */
const TWO_OPT_MAX_RUNS = 400;

/**
 * 2-opt refinement of an ordered set of REVERSIBLE runs (satin columns, fill
 * rows, tatami pieces): repeatedly reverse a sub-sequence when doing so shortens
 * the travel between pieces. Reversing a block flips both its order AND each run
 * (so we enter each from its other end); because run-to-run distance is
 * symmetric, only the two boundary connectors change, giving an O(1) delta per
 * candidate move. This is the "auto-branching" travel optimizer — it cuts the
 * jumps/trims a greedy nearest-neighbour order leaves on the table. Pure geometry.
 */
function twoOptRuns(runs: Point[][], from: Point | null): Point[][] {
  const n = runs.length;
  if (n < 3 || n > TWO_OPT_MAX_RUNS) return runs;
  const arr = runs.slice();
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const head = (r: Point[]) => r[0];
  const tail = (r: Point[]) => r[r.length - 1];
  let improved = true;
  let pass = 0;
  while (improved && pass++ < 8) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      const prevEnd = i === 0 ? from : tail(arr[i - 1]);
      for (let j = i + 1; j < n; j++) {
        const iStart = head(arr[i]);
        const jEnd = tail(arr[j]);
        const nextStart = j + 1 < n ? head(arr[j + 1]) : null;
        // Edges broken: prevEnd→iStart and jEnd→nextStart. After reversing the
        // block [i..j] (order + each run): prevEnd→jEnd and iStart→nextStart.
        const before =
          (prevEnd ? dist(prevEnd, iStart) : 0) + (nextStart ? dist(jEnd, nextStart) : 0);
        const after =
          (prevEnd ? dist(prevEnd, jEnd) : 0) + (nextStart ? dist(iStart, nextStart) : 0);
        if (after + 1e-6 < before) {
          const block = arr.slice(i, j + 1).reverse().map((r) => [...r].reverse());
          arr.splice(i, j - i + 1, ...block);
          improved = true;
        }
      }
    }
  }
  return arr;
}

/** Centroid of a region (mean of its outer ring) — its travel-routing anchor. */
function regionAnchor(region: Point[][]): Point {
  const ring = region[0] ?? [];
  if (ring.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of ring) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / ring.length, y: sy / ring.length };
}

/**
 * Order a fill's regions to minimise the travel between them (auto-branching at
 * the region level): a deterministic nearest-neighbour walk from the top-left
 * region, then 2-opt. Returns the index permutation. Regions otherwise sew in
 * arbitrary trace order, which strands far regions and racks up jumps/trims on
 * scattered fills (polka dots, multi-blob logos, sparse lettering).
 */
function orderByTravel(pts: Point[]): number[] {
  const n = pts.length;
  const idx = pts.map((_, i) => i);
  if (n <= 2 || n > TWO_OPT_MAX_RUNS) return idx;
  const d = (a: number, b: number) => Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
  // Deterministic start: the top-left region.
  let start = 0;
  for (let i = 1; i < n; i++) {
    if (pts[i].y < pts[start].y - 1e-9 || (Math.abs(pts[i].y - pts[start].y) < 1e-9 && pts[i].x < pts[start].x)) start = i;
  }
  const used = new Array(n).fill(false);
  const order = [start];
  used[start] = true;
  for (let k = 1; k < n; k++) {
    const c = order[order.length - 1];
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (!used[i]) {
        const dd = d(c, i);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
    }
    order.push(best);
    used[best] = true;
  }
  let improved = true;
  let pass = 0;
  while (improved && pass++ < 8) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      const prev = i === 0 ? -1 : order[i - 1];
      for (let j = i + 1; j < n; j++) {
        const next = j + 1 < n ? order[j + 1] : -1;
        const a = order[i];
        const b = order[j];
        const before = (prev >= 0 ? d(prev, a) : 0) + (next >= 0 ? d(b, next) : 0);
        const after = (prev >= 0 ? d(prev, b) : 0) + (next >= 0 ? d(a, next) : 0);
        if (after + 1e-6 < before) {
          let lo = i;
          let hi = j;
          while (lo < hi) {
            const t = order[lo];
            order[lo] = order[hi];
            order[hi] = t;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }
  return order;
}

/**
 * Widest stroke (mm) that still reads as clean satin. With density compensation,
 * pull compensation, and staggered split satin all in place, columns up to this
 * width sew as smooth, shiny satin — which is what most lettering (script AND
 * regular capitals) wants. Genuinely broad strokes beyond this (heavy block
 * faces) still fall to a solid tatami fill, exactly like the printed letterform.
 */
const MAX_SATIN_STROKE_MM = 6;

/**
 * Medial-axis satin columns for a region, but only if they'd actually look good:
 * the strokes must be narrow enough to satin cleanly AND the satin must cover
 * the glyph. Otherwise returns `[]` so the caller lays a solid tatami fill —
 * shiny where it helps, crisp and solid where it doesn't, never sloppy.
 */
function acceptableSatin(
  region: Path[],
  density: number,
  pullScale: number,
  authored?: Path[],
): SatinColumn[] {
  // Adaptive skeleton resolution: a fixed 0.4 mm grid is far too coarse for small
  // lettering (a 2.5 mm stroke is barely 6 cells wide, so the skeleton staircases
  // and the rails wobble). Scale the cell to the region so a letter is resolved
  // finely while a big auto-digitized blob stays cheap. Clamped both ways; the
  // medial code caps total cells and falls back to fill if a region is enormous.
  const b = pathsBounds(region);
  const span = b ? Math.min(b.maxX - b.minX, b.maxY - b.minY) : 12;
  const cellMm = Math.max(0.12, Math.min(0.4, span / 60));
  // Small feature (an i/j tittle, a period, an accent) OR a small round dot (a golf
  // ball, an eye): its medial axis is a tiny cross that satins as a criss-cross
  // mess, and tatami leaves rough little rows. Lay ONE clean satin block across its
  // long axis instead.
  if (b) {
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    if (Math.max(w, h) <= SMALL_FEATURE_MM || isSmallRoundFill(region)) {
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const centerline: Point[] =
        w >= h
          ? [{ x: b.minX + w * 0.18, y: cy }, { x: b.maxX - w * 0.18, y: cy }]
          : [{ x: cx, y: b.minY + h * 0.18 }, { x: cx, y: b.maxY - h * 0.18 }];
      const cols = columnsFromCenterlines(region, [centerline], { density, pullScale, cellMm });
      if (cols.length) return cols;
    }
  }
  // Authored decomposition (flagship font): lay a column down each hand-placed
  // centerline. The spec is trusted, and the engine's residual fill closes the
  // small wedges where strokes are authored short of a junction (W/M valleys), so
  // the bar is lower than the auto gate — but still high enough that a spec that
  // mostly missed (matched the wrong region, bad coords) falls back to the auto
  // skeleton rather than sewing something broken.
  if (authored && authored.length) {
    const cols = columnsFromCenterlines(region, authored, { density, pullScale, cellMm });
    if (cols.length && satinCoverage(region, cols.map((c) => c.throws)) >= AUTHORED_MIN_COVERAGE) {
      return cols;
    }
  }
  const columns = medialColumns(region, { density, pullScale, cellMm });
  if (columns.length === 0) return [];

  // Median stroke width across the glyph's strokes; bold/large faces fail this
  // and fall through to a solid fill.
  const widths = columns.map((c) => c.widthMm).sort((a, b) => a - b);
  const medianWidth = widths[widths.length >> 1];
  if (medianWidth > MAX_SATIN_STROKE_MM) return [];

  const coverage = satinCoverage(region, columns.map((c) => c.throws));
  return coverage >= MIN_SATIN_COVERAGE ? columns : [];
}

/** The object's authored satin centerlines whose mid-stroke point falls inside
 *  `region` (so each glyph's hand-authored strokes are matched to its own fill
 *  region). Uses the point at HALF the seed's arc length — not an endpoint, which
 *  for a 2-point stroke sits at a tip/junction and can read as outside the ink. */
function authoredForRegion(object: EmbObject, region: Path[]): Path[] {
  const all = object.satinCenterlines;
  if (!all || all.length === 0) return [];
  return all.filter((cl) => cl.length >= 2 && pointInRings(seedMidpoint(cl), region));
}

/** The point halfway along a polyline by arc length. */
function seedMidpoint(cl: Path): Point {
  let total = 0;
  for (let i = 1; i < cl.length; i++) total += distance(cl[i - 1], cl[i]);
  let half = total / 2;
  for (let i = 1; i < cl.length; i++) {
    const seg = distance(cl[i - 1], cl[i]);
    if (half <= seg) {
      const t = seg > 0 ? half / seg : 0;
      return { x: cl[i - 1].x + (cl[i].x - cl[i - 1].x) * t, y: cl[i - 1].y + (cl[i].y - cl[i - 1].y) * t };
    }
    half -= seg;
  }
  return cl[Math.floor(cl.length / 2)];
}

/**
 * A medial column thinner than this stitches as a single running line, not satin.
 * Kept low so genuinely fine strokes — script faces, serif hairlines, small text —
 * still get a COVERING satin column (crisp, filled) instead of a bare wireframe
 * line; only true hairlines (< 0.6 mm) run as a single line.
 */
const RUNNING_COLUMN_MM = 0.6;

/** Shortest line-art stroke (centerline mm) worth sewing — below this it's a
 *  medial spur/speck that just adds a trim. */
const LINE_ART_MIN_LEN_MM = 2.5;
/** Line-art strokes at/above this width (mm) are RIBBON-filled solid (an outline band,
 *  a tire wall); thinner detail (a hairline, an antenna) is bean-retraced down its
 *  centerline instead — too narrow to fill, but a single pass reads weak. */
const LINE_ART_RIBBON_MIN_MM = 0.9;
/** A thin line-art stroke is retraced forward/back/forward (bean / triple) so the
 *  hairline reads bold and dark instead of a single weak pass. */
const LINE_ART_BEAN_REPEATS = 3;

/** Arc length of a polyline (mm). */
function polylineLength(line: Point[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += distance(line[i - 1], line[i]);
  return s;
}

/**
 * Min-stitch for SATIN runs. Satin is intentionally dense — its row spacing
 * (≈0.3–0.5 mm) is the gap between consecutive same-rail penetrations, below the
 * 0.5 mm general minimum, so thinning at 0.5 mm would shred a column into a sparse
 * zig-zag. But the floor must NOT go so low that the concave edge of a tight curve
 * packs thread (density compensation deliberately bunches the inner rail). At
 * 0.3 mm straight columns keep their full ~0.4 mm density while the sub-0.3 mm
 * inner-curve buildup that clogs the needle is merged away.
 */
const SATIN_MIN_STITCH = 0.3;

/** Densest row spacing (mm) the engine will ever stitch — denser packs/jams. */
const MIN_SAFE_DENSITY = 0.3;

/** How far inside the boundary (mm) a broad fill's finishing edge run sits — far
 *  enough to bury the ragged tatami row-ends and any pull-comp overshoot, close
 *  enough that the fill still reads as filled all the way to its outline. */
const EDGE_RUN_INSET_MM = 0.4;
/** Stitch length (mm) for the edge run — short, so it hugs curves and corners. */
const EDGE_RUN_STITCH_MM = 2;

/** Signed area (shoelace) of a ring; sign encodes winding. */
function ringSignedArea(ring: Path): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return s / 2;
}

/** Offset a closed ring INWARD (toward its interior) by `inset` mm — picks the
 *  offset direction that shrinks the area, so it works regardless of winding. */
function insetRingInward(ring: Path, inset: number): Path {
  const closed = distance(ring[0], ring[ring.length - 1]) < 1e-9 ? ring : [...ring, ring[0]];
  const a = offsetPolyline(closed, inset, true);
  const b = offsetPolyline(closed, -inset, true);
  return Math.abs(ringSignedArea(a)) <= Math.abs(ringSignedArea(b)) ? a : b;
}

/**
 * A finishing EDGE RUN for a broad fill: a clean running outline that traces each
 * boundary just inside the edge. Laid on TOP of the fill, it caps the slightly
 * ragged ends of tatami rows (and hides pull-comp overshoot) so the silhouette
 * reads crisp and rounded end-caps close — exactly the boundary pass a digitizer
 * walks around a fill by hand. Outer contours only (capping the visible edge);
 * holes are left to the fill's own clean scan boundary.
 */
function fillEdgeRuns(region: Path[], stitchLength: number): Point[][] {
  const out: Point[][] = [];
  for (const ring of region) {
    if (ring.length < 3 || ringSignedArea(ring) <= 0) continue; // outer rings only
    const inset = insetRingInward(ring, EDGE_RUN_INSET_MM);
    if (inset.length < 3) continue;
    out.push(runningStitch(inset, stitchLength));
  }
  return out;
}

/** Retrace a running line `repeats` times (alternating direction) for a bean /
 *  triple stitch. The shared turnaround vertex is dropped each pass so no two
 *  consecutive penetrations coincide (they'd otherwise collapse). */
function beanPath(line: Point[], repeats: number): Point[] {
  if (line.length < 2) return line;
  let out = [...line];
  for (let i = 1; i < repeats; i++) {
    const pass = i % 2 === 1 ? [...line].reverse() : [...line];
    out = out.concat(pass.slice(1));
  }
  return out;
}

/** Fill a medial column with parallel passes running ALONG the stroke — interpolated
 *  between its two smoothed edge rails — instead of satin throws ACROSS it. The passes
 *  follow the smooth centerline, so a stroke fills as a clean solid band and a ring
 *  fills as clean concentric loops (a tire), with none of satin's radial starburst on
 *  a wide ring nor region-contour's wobble from tracing the jagged boundary. The passes
 *  alternate direction and join into ONE continuous serpentine (the next pass is a
 *  density-step away at the same end), so the whole stroke sews as a single run — no
 *  travel tangle between dozens of separate rows. */
function ribbonFill(c: SatinColumn, density: number, stitchLength: number): Point[] {
  const L = c.left;
  const R = c.right;
  const n = Math.min(L.length, R.length);
  if (n < 2) return runningStitch(c.centerline, stitchLength);
  const levels = Math.max(1, Math.round(c.widthMm / density));
  let path: Point[] = [];
  for (let k = 0; k <= levels; k++) {
    const t = k / levels;
    const line: Point[] = [];
    for (let i = 0; i < n; i++) line.push({ x: L[i].x + (R[i].x - L[i].x) * t, y: L[i].y + (R[i].y - L[i].y) * t });
    path = path.concat(k % 2 === 0 ? line : line.reverse());
  }
  return runningStitch(path, stitchLength);
}

/**
 * The runs for a single object. Splitting a fill into its regions (and underlay
 * from top) here is what lets `generateDesign` jump between them. The `fabric`
 * profile bends density / pull-comp / underlay weight (docs/stitch-logic.md §8).
 */
export function generateObjectRuns(
  object: EmbObject,
  fabric: FabricProfile = fabricProfile(undefined),
): StitchRun[] {
  const p = resolveParams(object.type, object.params);
  // Hard machine-safety floor on row spacing: no matter what the user (or the
  // fabric multiplier) asks for, never pack rows tighter than this — denser than
  // ~0.3 mm just builds a ridge of thread that jams the needle. The validator
  // still WARNS on the requested density; this protects the actual stitch-out.
  const density = Math.max(MIN_SAFE_DENSITY, p.density * fabric.densityMul);
  const pullComp = p.pullComp * fabric.pullMul;
  // Push (lengthwise) distortion tracks fabric stretch like pull does.
  const pushComp = p.pushComp * fabric.pullMul;
  // Underlay heaviness: a per-object override wins over the fabric default.
  const weight = p.underlayWeight === "auto" ? fabric.underlay : p.underlayWeight;
  // Pile rides longer stitches above its loops; other fabrics keep the drawn
  // length. (The MIN floor in resample still protects against sub-mm stitches.)
  const stitchLength = p.stitchLength * fabric.stitchLenMul;
  const runs: StitchRun[] = [];

  if (object.type === "running") {
    // Raw (imported) stitches are emitted exactly as stored — no resampling, no
    // bean — so an imported design's penetrations are preserved verbatim.
    if (p.raw) {
      addRun(runs, (object.paths[0] ?? []).map((q) => ({ ...q })), false);
      return runs;
    }
    // Motif run: repeat a decorative motif along the line instead of a plain run.
    if (p.motifRun && p.motifRun !== "none") {
      const strokes = motifRunAlong(object.paths[0] ?? [], { motifId: p.motifRun, sizeMm: p.motifSizeMm });
      for (const stroke of strokes) addRun(runs, dropShortStitches(runningStitch(stroke, stitchLength), undefined, true), false);
      return runs;
    }
    const line = dropShortStitches(runningStitch(object.paths[0] ?? [], stitchLength), undefined, true);
    // Bean / triple stitch: retrace the line N times (forward/back/forward) for a
    // bold, durable outline. The repeats land in the same holes but are never
    // CONSECUTIVE (the turnarounds skip the shared vertex), so they survive the
    // coincident-collapse and read as a heavier line.
    addRun(runs, p.beanRepeats >= 3 ? beanPath(line, p.beanRepeats) : line, false);
    return runs;
  }

  if (object.type === "satin") {
    const [left, right] = object.paths;
    if (!left || !right) return runs;
    if (p.underlay) {
      for (const run of satinUnderlay(left, right, weight)) {
        addRun(runs, dropShortStitches(run, SATIN_MIN_STITCH), true);
      }
    }
    addRun(
      runs,
      dropShortStitches(satinColumn(left, right, { density, pullComp, push: pushComp }), SATIN_MIN_STITCH),
      false,
    );
    return runs;
  }

  // Appliqué: stitch the OUTLINE as a placement run → STOP (operator lays the
  // appliqué fabric) → tackdown run → STOP (operator trims the excess) → satin
  // cover that finishes the raw edge. One object, the whole production sequence.
  if (p.applique) {
    return appliqueRuns(object.paths, density, pullComp, stitchLength);
  }

  // fill — underlay then top, per connected region. Keeping each pass a separate
  // run lets the assembler jump between them. Strokes satin along their medial
  // axis (very thin ones run as a single line); broad areas use tatami; the
  // medial pass falls back to tatami where satin won't cover cleanly.
  const satin = p.fillStyle === "satin";
  const motifMode = p.fillStyle === "motif";
  const blendMode = p.fillStyle === "blend" && !!p.blendColorId;
  const tracedRegions = splitFillRegions(object.paths);
  // Sew the regions in travel-minimising order (auto-branching) rather than trace
  // order, so a scattered fill doesn't strand far regions and rack up jumps.
  const regionOrder = orderByTravel(tracedRegions.map(regionAnchor));
  const regions = regionOrder.map((i) => tracedRegions[i]);
  // ONE grain angle for the whole object so every tatami region flows the same
  // way — a word or multi-blob logo reads as a single piece, not a patchwork of
  // differently-angled letters (stitch-direction continuity). The user's Angle
  // field offsets it. A painted Direction (directionDeg) is an ABSOLUTE override:
  // the user has told us which way the stitches run, so skip the auto grain.
  const manualDirection = p.directionDeg != null;
  const tatamiAngle = manualDirection
    ? p.directionDeg!
    : autoFillAngleForRegions(regions, p.angle);
  // A painted flow curve (normalized to the object's bbox) the rows follow. Map it
  // back to mm here so it rides the object's current position/size.
  const flowSpineMm: Point[] | null = (() => {
    if (!p.flowPath || p.flowPath.length < 2) return null;
    const b = pathsBounds(object.paths);
    if (!b) return null;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    return p.flowPath.map(([nx, ny]) => ({ x: b.minX + nx * w, y: b.minY + ny * h }));
  })();
  regions.forEach((region, regionIdx) => {
    const columns = satin
      ? acceptableSatin(region, density, fabric.pullMul, authoredForRegion(object, region))
      : [];
    const usingSatin = columns.length > 0;
    const contour = !usingSatin && p.fillStyle === "contour";
    const travelMax = usingSatin ? 8 : 6;
    // Satin and contour rows are dense like satin; tatami uses the general floor.
    const minStitch = usingSatin || contour ? SATIN_MIN_STITCH : undefined;
    // Tatami flows along the object's shared grain. Underlay follows the same angle.
    const fillAngle = usingSatin ? p.angle : tatamiAngle;

    let cursor: Point | null = null;
    if (p.underlay && !motifMode) {
      // Satin: tiered underlay per column (center / edge-walk / zig-zag by width).
      // Tatami: inset edge run + perpendicular pass(es). (Motif fills are open and
      // decorative — no underlay.)
      const ulRuns = usingSatin
        ? columns.flatMap((c) => columnUnderlay(c.centerline, c.widthMm, weight))
        : contour
          ? // A contour fill follows the shape's curve, so its underlay should too —
            // sparse echo loops that hug the band instead of a parallel pass that
            // would bridge (and trim across) the hole of a ring.
            contourFill(region, { density: Math.max(1.6, density * 3.5) })
          : fillUnderlayRuns(region, fillAngle, weight);
      for (const run of ulRuns) {
        for (const sub of splitLongTravels(run, travelMax)) {
          const u = dropShortStitches(sub);
          addRun(runs, u, true, regionIdx, usingSatin);
          if (u.length) cursor = u[u.length - 1];
        }
      }
    }

    // Multi-blend (two-thread ombré): lay the tatami grid as two colour layers
    // that fade A→B across the shape, sewn as separate colours (one thread change).
    if (blendMode) {
      const { a, b } = multiBlendFill(region, {
        density,
        angle: fillAngle,
        stitchLength: p.fillStitchLength,
        pullCompMm: pullComp,
      });
      for (const [path, colId] of [
        [a, object.colorId] as const,
        [b, p.blendColorId!] as const,
      ]) {
        for (const sub of orderByNearest(splitLongTravels(path, travelMax), cursor)) {
          const r = dropShortStitches(sub);
          addRun(runs, r, false, regionIdx, false, colId);
          if (r.length) cursor = r[r.length - 1];
        }
      }
      return; // this region is fully sewn as two colour layers
    }

    // Top layer. Satin: hairline columns become a single running line, the rest
    // satin. Contour: rings that echo the outline. Otherwise a tatami fill (also
    // the fallback when contour can't seat a ring in a too-thin shape).
    let tops: Point[][];
    // Tatami pieces from the concavity-aware boustrophedon are pre-ordered and
    // already connected INSIDE the region, so any move between them that the
    // assembler would have to add is exposed-only → must trim, never slash. We
    // flag those runs noBareTravel so the assembler trims an exposed gap instead
    // of drawing a stray thread across open fabric.
    let tatamiNoBareTravel = false;
    // Contour loops are sewn in a deliberate outer→inner spiral; preserving that
    // order (not re-sorting) keeps each ring one density-step from the next so they
    // connect with a hidden travel instead of a trimmed hop across the band.
    let contourSpiral = false;
    // True when a line-art object is rendered as a SOLID ribbon fill (parallel passes
    // along each stroke). It sews through the general ordered path below, not the satin
    // emission path, and gets no residual tatami fill.
    let lineArtFill = false;
    if (usingSatin) {
      // Line-art: drop medial-axis SPURS (tiny centerline stubs off a blobby
      // region) — they sew as 1-stitch specks that only add trims and clutter.
      const keep = p.lineArt
        ? columns.filter((c) => polylineLength(c.centerline) >= LINE_ART_MIN_LEN_MM)
        : columns;
      if (p.lineArt) {
        // Auto-traced line-art — a cartoon's bold black linework (the silhouette
        // outline, the tire rings, the ladder, window frames) — reads as SOLID shapes,
        // not thin pen lines. Fill each medial column with parallel passes running
        // ALONG the stroke (interpolated between its smoothed rails): a clean solid
        // BAND for an outline, clean CONCENTRIC rings for a tire wall. Because the
        // passes follow the SMOOTH centerline, there's none of satin's radial starburst
        // (throws ACROSS a wide ring) nor region-contour's wavy nested loops (which
        // trace the jagged boundary). A degenerate column with no rails falls back to
        // its centerline so a hairline still sews.
        tops = keep.map((c) =>
          c.widthMm < LINE_ART_RIBBON_MIN_MM
            ? beanPath(runningStitch(c.centerline, stitchLength), LINE_ART_BEAN_REPEATS)
            : ribbonFill(c, density, stitchLength),
        );
        tatamiNoBareTravel = true; // a fill: order for shortest travel, never slash a bare gap
        lineArtFill = true;
      } else {
        const runMax = RUNNING_COLUMN_MM;
        tops = keep.map((c) =>
          c.widthMm < runMax
            ? runningStitch(c.centerline, stitchLength)
            : c.throws,
        );
      }
    } else if (contour) {
      const echo = contourFill(region, { density });
      tops = echo.length
        ? echo
        : tatamiConcaveRuns(region, { density, angle: fillAngle, stitchLength: p.fillStitchLength, pullCompMm: pullComp });
      if (echo.length) contourSpiral = true;
      else tatamiNoBareTravel = true;
    } else if (motifMode) {
      // Motif fill: tile a decorative motif across the region (no underlay).
      tops = motifFill(region, { motifId: p.motif, sizeMm: p.motifSizeMm, angle: tatamiAngle });
    } else if (p.fillStyle === "gradient" || (p.carve && p.carve !== "none")) {
      // Gradient/ombré ramps row spacing across the shape, and carve skips
      // penetrations along a relief groove — both read across the WHOLE shape, so
      // they use the single-serpentine tatami rather than per-cell decomposition.
      const gradient = p.fillStyle === "gradient" ? GRADIENT_FILL_MUL : undefined;
      let top = tatamiFill(region, { density, angle: fillAngle, stitchLength: p.fillStitchLength, pullCompMm: pullComp, gradient });
      if (p.carve && p.carve !== "none") {
        const curves = motifFill(region, { motifId: p.carve, sizeMm: p.motifSizeMm, angle: tatamiAngle });
        top = carvePoints(top, curves, CARVE_GROOVE_MM);
      }
      tops = [top];
    } else {
      // Plain broad fill. A curved, elongated shape gets a TURNING fill whose rows
      // follow the form (banner, leaf, crescent); everything else uses the
      // concavity-aware tatami. turningFill returns null when it isn't a good fit.
      // Only an ISOLATED shape turns, though: across a multi-region object — a word
      // of letters, a scattered mark — a per-letter turning direction reads as a
      // patchwork (and can fan an odd diagonal across a letter), so those fill with
      // the object's one shared tatami grain instead.
      const fillOpts = { density, angle: fillAngle, stitchLength: p.fillStitchLength, pullCompMm: pullComp };
      // Precedence: a painted FLOW CURVE wins (the user drew the grain); else a
      // painted straight Direction (handled via the angle, so skip turning/flow);
      // else the AUTO flows — a clean single-spine band turns (turningFill), a
      // branchy/organic shape flows along its limbs (flowFill); else concavity-aware
      // tatami. Every path declines (→ null) and self-validates to never slash.
      const userFlow = flowSpineMm ? flowAlong(region, flowSpineMm, fillOpts) : null;
      const turned =
        userFlow ??
        (!manualDirection && !flowSpineMm && regions.length === 1
          ? (turningFill(region, fillOpts) ?? flowFill(region, fillOpts))
          : null);
      tops = turned ?? tatamiConcaveRuns(region, fillOpts);
      tatamiNoBareTravel = true;
    }

    // Sew the fill's pieces nearest-neighbor from where the underlay left off,
    // for the shortest travel between them (pure reordering; geometry unchanged).
    // Satin orders whole columns (so each column's zig-zag stays one continuous
    // throw sequence) then splits. Tatami/contour split the fill path into
    // machine-safe pieces FIRST, then order those — so a concave shape's spans
    // connect with short travels instead of leaping (and trimming) across it.
    if (usingSatin && !lineArtFill) {
      // A true satin fill tatami-fills any interior the satin left bare — the small
      // patches at stroke crossings and 3-way junctions where columns are trimmed
      // back so they don't fan. Without this a self-crossing script loop (the 'l' in
      // "hello") shows a hole. Laid first so the satin sits on top at the seams.
      // (Line-art renders as a ribbon fill via lineArtFill and skips this path.)
      for (const patch of residualRegions(region, tops)) {
        const fill = tatamiFill([patch], {
          density,
          angle: tatamiAngle,
          stitchLength: p.fillStitchLength,
          pullCompMm: pullComp,
        });
        for (const sub of orderByNearest(splitLongTravels(fill, travelMax), cursor)) {
          const r = dropShortStitches(sub);
          addRun(runs, r, false, regionIdx, true);
          if (r.length) cursor = r[r.length - 1];
        }
      }
      // Both satin and line-art forbid a BARE travel: a stitched move across the
      // open gap between two branches would show as a thread slash (and for the
      // top-layer line-art it's never really hidden). Continuity instead comes from
      // chaining nearby centerlines into one pass; anything left trims (invisible).
      for (const run of orderByNearest(tops, cursor)) {
        for (const sub of splitLongTravels(run, travelMax)) {
          const r = dropShortStitches(sub, minStitch);
          addRun(runs, r, false, regionIdx, true);
          if (r.length) cursor = r[r.length - 1];
        }
      }
    } else {
      const subRuns = tops.flatMap((run) => splitLongTravels(run, travelMax));
      // Contour keeps its spiral order; everything else is re-sorted for the
      // shortest travel between pieces.
      const ordered = contourSpiral ? subRuns : orderByNearest(subRuns, cursor);
      // Contour rings step ~one density between loops (drawn as ordinary stitches),
      // but a region of DISCONNECTED blobs (e.g. two eyes + a nose as one object)
      // must not draw a bare connector across the open gap between them — so, like
      // the boustrophedon, contour suppresses bare travels (they route under
      // same-colour coverage or trim).
      const noBare = tatamiNoBareTravel || contourSpiral;
      for (const sub of ordered) {
        const r = dropShortStitches(sub, minStitch);
        // Line-art is separate top-layer strokes — trim across the gaps between them
        // (a buried connector would show where it crosses bare fabric), so it sews
        // clean with no stray travel threads.
        addRun(runs, r, false, regionIdx, noBare, undefined, lineArtFill);
        if (r.length) cursor = r[r.length - 1];
      }
      // Finishing edge run: walk the boundary just inside the edge so the fill's
      // row-ends are capped and the silhouette (and its end-caps) read crisp. (Skip
      // for line-art — the ribbon already follows the edges; retracing the whole
      // network boundary only adds travel.)
      const edgeRuns = lineArtFill ? [] : orderByNearest(fillEdgeRuns(region, EDGE_RUN_STITCH_MM), cursor);
      for (const run of edgeRuns) {
        for (const sub of splitLongTravels(run, travelMax)) {
          const r = dropShortStitches(sub);
          addRun(runs, r, false, regionIdx);
          if (r.length) cursor = r[r.length - 1];
        }
      }
    }
  });
  return runs;
}

/** Satin cover width (mm) laid over an appliqué edge to finish the raw fabric. */
const APPLIQUE_COVER_MM = 3;
/** Stitch length (mm) for appliqué placement + tackdown running passes. */
const APPLIQUE_RUN_MM = 2.5;

/**
 * Appliqué sequence for a closed shape (per region, using the outer ring):
 *   1) placement run around the edge  → STOP (lay the appliqué fabric)
 *   2) tackdown run around the edge   → STOP (trim the excess)
 *   3) satin cover over the edge      (finishes the raw edge)
 * Each phase is its own run; STOPs ride on the run that precedes them.
 */
function appliqueRuns(
  paths: Path[],
  density: number,
  pullComp: number,
  _stitchLength: number,
): StitchRun[] {
  const runs: StitchRun[] = [];
  const regions = splitFillRegions(paths);
  // Outer ring of each region, closed into a loop for the running passes.
  const rings = regions
    .map((r) => r.find((ring) => ring.length >= 3))
    .filter((r): r is Path => !!r)
    .map((r) => [...r, r[0]]);
  if (rings.length === 0) return runs;

  const pushRun = (pts: Point[], stopAfter: boolean) => {
    if (pts.length > 0) runs.push({ pts, underlay: false, stopAfter });
  };

  // 1) Placement run (all regions), STOP after the last.
  rings.forEach((ring, i) => {
    pushRun(dropShortStitches(runningStitch(ring, APPLIQUE_RUN_MM), undefined, true), i === rings.length - 1);
  });
  // 2) Tackdown run (all regions), STOP after the last.
  rings.forEach((ring, i) => {
    pushRun(dropShortStitches(runningStitch(ring, APPLIQUE_RUN_MM), undefined, true), i === rings.length - 1);
  });
  // 3) Satin cover over each edge (centered on the outline).
  for (const ring of rings) {
    const [left, right] = railsFromCenterline(ring, APPLIQUE_COVER_MM);
    pushRun(dropShortStitches(satinColumn(left, right, { density, pullComp, push: 0 }), SATIN_MIN_STITCH), false);
  }
  return runs;
}

/** The combined underlay + top-layer penetrations for an object (all regions). */
export function generateObjectStitches(
  object: EmbObject,
): { underlay: Point[]; main: Point[] } {
  const runs = generateObjectRuns(object);
  return {
    underlay: runs.filter((r) => r.underlay).flatMap((r) => r.pts),
    main: runs.filter((r) => !r.underlay).flatMap((r) => r.pts),
  };
}

/** An object together with its generated runs, the unit of travel routing. */
interface ObjGroup {
  object: EmbObject;
  runs: StitchRun[];
}

const groupStart = (g: ObjGroup): Point => g.runs[0].pts[0];
const groupEnd = (g: ObjGroup): Point => {
  const last = g.runs[g.runs.length - 1].pts;
  return last[last.length - 1];
};

/**
 * Order object-groups to minimize travel. Color blocks (maximal runs of the same
 * thread color, in their original sequence) are preserved so the color order and
 * layering never change; inside each block the objects are sewn nearest-neighbor,
 * continuing from where the previous block left off. A whole object's runs stay
 * together and in order (underlay before top), so only the travel between objects
 * is optimized — never the stitching within one.
 */
function routeGroups(groups: ObjGroup[]): ObjGroup[] {
  const out: ObjGroup[] = [];
  let cursor: Point | null = null;
  let i = 0;
  while (i < groups.length) {
    let j = i;
    while (j < groups.length && groups[j].object.colorId === groups[i].object.colorId) j++;
    const remaining = groups.slice(i, j);
    while (remaining.length > 0) {
      let best = 0;
      if (cursor) {
        let bestDist = Infinity;
        for (let k = 0; k < remaining.length; k++) {
          const s = groupStart(remaining[k]);
          const d = Math.hypot(s.x - cursor.x, s.y - cursor.y);
          if (d < bestDist) {
            bestDist = d;
            best = k;
          }
        }
      }
      const [chosen] = remaining.splice(best, 1);
      out.push(chosen);
      cursor = groupEnd(chosen);
    }
    i = j;
  }
  return out;
}

/**
 * Assemble every visible object (in stitch order) into one ordered stream of
 * needle events, inserting jumps for long travels, trims on color changes and
 * long jumps. Hidden objects are skipped — what you see is what you sew.
 *
 * This single representation drives both the on-canvas simulator and the
 * exporter, so the preview and the file can never disagree.
 */
export function generateDesign(
  project: Project,
  opts: DesignOptions = {},
): EngineStitch[] {
  const jumpThreshold = opts.jumpThreshold ?? 3;
  // Longest EXPOSED (un-hidden) same-color gap still bridged rather than trimmed;
  // `trimThreshold` overrides it (kept for tests/fabric tuning).
  const exposedMax = opts.trimThreshold ?? EXPOSED_TRAVEL_MAX;
  const lockStitches = opts.lockStitches ?? true;
  // First pass: expand each visible object into its runs (a fill contributes one
  // run per region), keeping only runs that actually produce penetrations. Keep
  // the runs grouped per object so travel routing can reorder whole objects.
  const fabric = effectiveProfile(project.fabric, project.threadWeight);
  const groups = project.objects
    .filter((o) => o.visible)
    .map((object) => ({
      object,
      runs: generateObjectRuns(object, fabric).filter((r) => r.pts.length > 0),
    }))
    .filter((g) => g.runs.length > 0);

  // Route the objects to shorten travel: within each maximal block of same-color
  // objects, sew them nearest-neighbor instead of in array order. Color blocks
  // stay in their original sequence, so layering and color order are unchanged —
  // this only cuts the jump/trim distance between same-color shapes.
  const drawn = routeGroups(groups).flatMap((g) =>
    g.runs.map((run) => ({
      object: g.object,
      pts: run.pts,
      underlay: run.underlay,
      region: run.region ?? 0,
      stopAfter: run.stopAfter,
      noBareTravel: run.noBareTravel ?? false,
      trimGaps: run.trimGaps ?? false,
      colorId: run.colorId ?? g.object.colorId,
    })),
  );

  // Coverage map: a travel is acceptable only if it stays HIDDEN — i.e. the whole
  // connector lies under a SAME-COLOUR fill region (so the travel thread is truly
  // buried, not sitting on top of a different colour as a slash). A move across
  // open fabric — or over only other colours — is trimmed instead.
  const fills = drawn
    .map((d) => d.object)
    .filter((o, i, arr) => o.type === "fill" && arr.findIndex((x) => x.id === o.id) === i);
  // Sew order: the index at which each object's stitching first appears. A fill
  // hides a travel only if it ends up ON TOP of it — i.e. it's the SAME colour
  // (invisible either way) or it's sewn LATER (laid over the travel). A different
  // colour sewn EARLIER sits under the travel, so the travel would show on it.
  const drawOrder = new Map<string, number>();
  drawn.forEach((d, i) => {
    if (!drawOrder.has(d.object.id)) drawOrder.set(d.object.id, i);
  });
  /** True if a `colorId` travel from a→b stays hidden: every point lies under a
   *  fill that is the same colour or sewn after `afterOrder` (so it's on top). */
  function coveredBetween(a: Point, b: Point, colorId: string, afterOrder: number): boolean {
    const cover = fills.filter(
      (o) => o.colorId === colorId || (drawOrder.get(o.id) ?? -1) > afterOrder,
    );
    if (cover.length === 0) return false;
    const samples = Math.max(2, Math.ceil(distance(a, b) / 1.5));
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      let covered = false;
      for (const o of cover) {
        if (pointInRings(p, o.paths)) {
          covered = true;
          break;
        }
      }
      if (!covered) return false;
    }
    return true;
  }

  // ── Travel-under-coverage router ──────────────────────────────────────────
  // A hand digitizer almost never trims to cross a gap inside the design: they
  // run the thread UNDER nearby stitching and come back up where the next piece
  // begins. We do the same — before cutting a same-color move, look for a path
  // from here to the next start that stays hidden under SAME-COLOUR fill, and if
  // one exists (and isn't absurdly long) sew it as a buried travel instead.
  //
  // Coverage must be same-colour: a dark travel routed under a lighter fill would
  // sit ON TOP of it and show as a slash. So we rasterize a coverage grid PER
  // colour (lazily, cached) and only bury a move where its own colour already
  // covers the path. The straight test above stays exact — this only kicks in
  // where a straight bridge would show.
  const COVERAGE_CELL = 1.0; // mm
  const ROUTE_CAP = 60; // mm: longest buried detour worth sewing to dodge a trim
  type Grid = { minX: number; minY: number; w: number; h: number; g: Uint8Array };
  const covByColor = new Map<string, Grid | null>();
  function coverage(colorId: string): Grid | null {
    const cached = covByColor.get(colorId);
    if (cached !== undefined) return cached;
    const mine = fills.filter((o) => o.colorId === colorId);
    if (mine.length === 0) {
      covByColor.set(colorId, null);
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const o of mine) {
      for (const ring of o.paths) {
        for (const p of ring) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
    }
    if (!isFinite(minX)) {
      covByColor.set(colorId, null);
      return null;
    }
    minX -= 1;
    minY -= 1;
    maxX += 1;
    maxY += 1;
    const w = Math.ceil((maxX - minX) / COVERAGE_CELL) + 1;
    const h = Math.ceil((maxY - minY) / COVERAGE_CELL) + 1;
    if (w * h > 4_000_000) {
      covByColor.set(colorId, null); // guard against a pathological hoop size
      return null;
    }
    const g = new Uint8Array(w * h);
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const p = { x: minX + gx * COVERAGE_CELL, y: minY + gy * COVERAGE_CELL };
        for (const o of mine) {
          if (pointInRings(p, o.paths)) {
            g[gy * w + gx] = 1;
            break;
          }
        }
      }
    }
    const grid = { minX, minY, w, h, g };
    covByColor.set(colorId, grid);
    return grid;
  }
  const cellCovered = (c: Grid, gx: number, gy: number) =>
    gx >= 0 && gy >= 0 && gx < c.w && gy < c.h && c.g[gy * c.w + gx] === 1;
  /** Nearest covered cell to a world point, within a few cells (else null). */
  function snapCell(c: Grid, p: Point): number | null {
    const cx = Math.round((p.x - c.minX) / COVERAGE_CELL);
    const cy = Math.round((p.y - c.minY) / COVERAGE_CELL);
    for (let r = 0; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (cellCovered(c, cx + dx, cy + dy)) return (cy + dy) * c.w + (cx + dx);
        }
      }
    }
    return null;
  }
  /** Does the straight segment p→q stay over covered cells (grid line-of-sight)? */
  function gridClear(c: Grid, p: Point, q: Point): boolean {
    const steps = Math.max(1, Math.ceil(distance(p, q) / (COVERAGE_CELL * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const gx = Math.round((p.x + (q.x - p.x) * t - c.minX) / COVERAGE_CELL);
      const gy = Math.round((p.y + (q.y - p.y) * t - c.minY) / COVERAGE_CELL);
      if (!cellCovered(c, gx, gy)) return false;
    }
    return true;
  }
  /**
   * A buried polyline from a to b (inclusive) that stays under coverage, or null
   * if none is found within {@link ROUTE_CAP}. A* over covered cells, line-of-sight
   * simplified so the travel is a few long legs rather than a staircase.
   */
  function routeUnderCoverage(a: Point, b: Point, colorId: string): Point[] | null {
    const c = coverage(colorId);
    if (!c) return null;
    const startCell = snapCell(c, a);
    const goalCell = snapCell(c, b);
    if (startCell === null || goalCell === null) return null;
    const { w, h } = c;
    const gxOf = (i: number) => i % w;
    const gyOf = (i: number) => Math.floor(i / w);
    const ptOf = (i: number): Point => ({ x: c.minX + gxOf(i) * COVERAGE_CELL, y: c.minY + gyOf(i) * COVERAGE_CELL });
    const goalP = ptOf(goalCell);
    const gScore = new Float32Array(w * h).fill(Infinity);
    const came = new Int32Array(w * h).fill(-1);
    // Binary min-heap of cells keyed by f = g + heuristic.
    const heap: { f: number; i: number }[] = [];
    const push = (f: number, i: number) => {
      heap.push({ f, i });
      let k = heap.length - 1;
      while (k > 0) {
        const par = (k - 1) >> 1;
        if (heap[par].f <= heap[k].f) break;
        [heap[par], heap[k]] = [heap[k], heap[par]];
        k = par;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && heap[l].f < heap[m].f) m = l;
          if (r < heap.length && heap[r].f < heap[m].f) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    gScore[startCell] = 0;
    push(distance(ptOf(startCell), goalP), startCell);
    let explored = 0;
    let found = false;
    while (heap.length) {
      const { i: cur } = pop();
      if (cur === goalCell) {
        found = true;
        break;
      }
      if (++explored > 60_000) break;
      const cgx = gxOf(cur);
      const cgy = gyOf(cur);
      const base = gScore[cur];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ngx = cgx + dx;
          const ngy = cgy + dy;
          if (!cellCovered(c, ngx, ngy)) continue;
          const ni = ngy * w + ngx;
          const step = (dx === 0 || dy === 0 ? 1 : Math.SQRT2) * COVERAGE_CELL;
          const ng = base + step;
          if (ng < gScore[ni] && ng <= ROUTE_CAP) {
            gScore[ni] = ng;
            came[ni] = cur;
            push(ng + distance(ptOf(ni), goalP), ni);
          }
        }
      }
    }
    if (!found) return null;
    // Reconstruct cell path (goal → start), then line-of-sight simplify.
    const cells: number[] = [];
    for (let i = goalCell; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const centers = cells.map(ptOf);
    const way: Point[] = [a];
    let anchor = a;
    for (let k = 1; k < centers.length; k++) {
      if (!gridClear(c, anchor, centers[k])) {
        anchor = centers[k - 1];
        way.push(anchor);
      }
    }
    way.push(b);
    // Drop waypoints that sit essentially on a or b (avoid a tiny end zigzag).
    const cleaned = way.filter(
      (p, idx) => idx === 0 || idx === way.length - 1 || (distance(p, a) > COVERAGE_CELL && distance(p, b) > COVERAGE_CELL),
    );
    let len = 0;
    for (let k = 1; k < cleaned.length; k++) len += distance(cleaned[k - 1], cleaned[k]);
    return len <= ROUTE_CAP ? cleaned : null;
  }

  const out: EngineStitch[] = [];
  let prevPoint: Point | null = null;
  // The penetration just before prevPoint, so a tie-off can retrace BACKWARD
  // along the stitches it just sewed (a hidden lock) instead of biting forward
  // toward the next shape across the trim.
  let prevToward: Point | null = null;
  let prevColor: string | null = null;
  let prevRegionKey: string | null = null;

  drawn.forEach((d, di) => {
    const { object, pts } = d;
    const col = d.colorId; // effective thread color (multi-blend overrides per run)
    const colorChanged = col !== prevColor;
    const start = pts[0];

    // Travel from where we left off to this object's first penetration.
    let trimmed = false;
    if (prevPoint) {
      const gap = distance(prevPoint, start);
      // PREMIUM RULE: a same-color move is sewn as a stitched travel only when it
      // won't show as a thread slash — i.e. it stays WITHIN one connected fill
      // region (its own serpentine), OR it's hidden under some fill, OR it's a
      // short hop between touching elements. A move across OPEN fabric (between
      // letters or separate shapes) is trimmed; color changes always trim.
      const regionKey = `${object.id}#${d.region}`;
      const sameRegion = regionKey === prevRegionKey;
      const intraTravel =
        !colorChanged &&
        sameRegion &&
        !d.noBareTravel &&
        gap > jumpThreshold &&
        gap <= INTRA_REGION_TRAVEL;
      const hiddenTravel =
        !colorChanged &&
        !d.trimGaps &&
        gap > jumpThreshold &&
        gap <= MAX_COVERED_TRAVEL &&
        coveredBetween(prevPoint, start, col, drawOrder.get(object.id) ?? di);
      const shortTravel =
        !colorChanged && !d.noBareTravel && !d.trimGaps && gap > jumpThreshold && gap <= exposedMax;
      // Direct (straight) travel when the move is already safe to stitch.
      let travelPath: Point[] | null =
        intraTravel || hiddenTravel || shortTravel ? [prevPoint, start] : null;
      // Otherwise, before trimming a same-color move, try to route it UNDER the
      // design's coverage and bury the travel (the pro move) instead of cutting.
      if (!travelPath && !d.trimGaps && !colorChanged && gap > jumpThreshold && gap <= ROUTE_CAP) {
        travelPath = routeUnderCoverage(prevPoint, start, col);
      }
      if (travelPath) {
        const travel = runningStitch(travelPath, TRAVEL_STITCH);
        for (const pt of travel.slice(1, -1)) {
          out.push({ x: pt.x, y: pt.y, colorId: col, objectId: object.id });
        }
      } else if (colorChanged || gap > jumpThreshold) {
        // Exposed long move or a color change → cut the thread (clean finish).
        trimmed = true;
        // A trim ends the previous thread run — tie it off by retracing back
        // along the stitches just sewn (falling back to the next start only if
        // the finished run was a single point).
        if (lockStitches && trimmed) {
          pushTie(out, prevPoint, prevToward ?? start, prevColorObj(drawn, di));
        }
        out.push({
          x: start.x,
          y: start.y,
          colorId: col,
          objectId: object.id,
          jump: true,
          trim: trimmed,
        });
      }
    }

    // Tie in at the first penetration of every new thread run.
    const startsRun = di === 0 || trimmed;
    if (lockStitches && startsRun) {
      pushTie(out, start, pts[1] ?? start, { id: object.id, colorId: col });
    }

    pts.forEach((pt) => {
      out.push({
        x: pt.x,
        y: pt.y,
        colorId: col,
        objectId: object.id,
        underlay: d.underlay,
      });
    });

    // Appliqué STOP: pause the machine here (lay or trim the fabric) at the last
    // penetration of this run, same thread continues afterward.
    if (d.stopAfter && pts.length > 0) {
      const last = pts[pts.length - 1];
      out.push({ x: last.x, y: last.y, colorId: col, objectId: object.id, stop: true });
    }

    prevPoint = pts[pts.length - 1];
    prevToward = pts.length > 1 ? pts[pts.length - 2] : pts[0];
    prevColor = col;
    prevRegionKey = `${object.id}#${d.region}`;
  });

  // Tie off the very end of the final thread run.
  if (lockStitches && prevPoint) {
    const lastObj = drawn[drawn.length - 1].object;
    const lastPts = drawn[drawn.length - 1].pts;
    const toward = lastPts.length > 1 ? lastPts[lastPts.length - 2] : prevPoint;
    pushTie(out, prevPoint, toward, { id: lastObj.id, colorId: lastObj.colorId });
  }

  return capStitchLength(collapseCoincident(out));
}

/** Longest a single drawn stitch may be (mm). Professional output keeps every
 *  stitch short (~≤5 mm) so nothing floats loose or snags; we split anything
 *  longer into equal sub-stitches along the same line. */
const MAX_STITCH_MM = 5;

/** Split any drawn run longer than {@link MAX_STITCH_MM} into equal sub-stitches.
 *  Jumps, trims, stops, and colour changes are boundaries — never split across
 *  them. The inserted points lie ON the original line, so coverage is unchanged. */
function capStitchLength(design: EngineStitch[]): EngineStitch[] {
  const out: EngineStitch[] = [];
  for (const s of design) {
    const prev = out[out.length - 1];
    if (
      prev &&
      !prev.jump &&
      !prev.trim &&
      !prev.stop &&
      !s.jump &&
      !s.trim &&
      !s.stop &&
      prev.colorId === s.colorId
    ) {
      const L = Math.hypot(s.x - prev.x, s.y - prev.y);
      if (L > MAX_STITCH_MM) {
        const n = Math.ceil(L / MAX_STITCH_MM);
        for (let k = 1; k < n; k++) {
          const t = k / n;
          out.push({ ...s, x: prev.x + (s.x - prev.x) * t, y: prev.y + (s.y - prev.y) * t });
        }
      }
    }
    out.push(s);
  }
  return out;
}

/** Two penetrations closer than this (mm) would punch the same hole. */
const COINCIDENT_EPS = 0.05;

/**
 * Drop a penetration that lands on the exact same spot as the one before it
 * (same color, neither a jump) — the needle would punch the same hole twice,
 * nesting thread and stressing the needle. These slip in where a tie cluster
 * ends on the anchor that the following run also starts on, or where a fill span
 * is narrower than the stitch spacing. Jumps and trims are always preserved.
 */
function collapseCoincident(design: EngineStitch[]): EngineStitch[] {
  const out: EngineStitch[] = [];
  for (const s of design) {
    const prev = out[out.length - 1];
    if (
      prev &&
      !prev.jump &&
      !s.jump &&
      !s.trim &&
      !s.stop && // never collapse away a machine STOP (appliqué pause)
      prev.colorId === s.colorId &&
      Math.hypot(s.x - prev.x, s.y - prev.y) < COINCIDENT_EPS
    ) {
      continue;
    }
    out.push(s);
  }
  return out;
}

/** Identify the object whose run is ending just before index `di`. */
function prevColorObj(
  drawn: { object: EmbObject; colorId: string }[],
  di: number,
): { id: string; colorId: string } {
  const prev = drawn[di - 1] ?? drawn[di];
  return prev ? { id: prev.object.id, colorId: prev.colorId } : { id: "", colorId: "" };
}

/** Append a tie/lock cluster of real penetrations to `out`. */
function pushTie(
  out: EngineStitch[],
  anchor: Point,
  toward: Point,
  owner: { id: string; colorId: string },
): void {
  for (const pt of tieStitches(anchor, toward)) {
    out.push({ x: pt.x, y: pt.y, colorId: owner.colorId, objectId: owner.id });
  }
}

let designCache: { project: Project; design: EngineStitch[] } | null = null;

/**
 * The assembled design for a project, memoized by project reference. The project
 * is replaced immutably on every edit, so this computes the design once per
 * change and shares it across every consumer (the canvas preview, design
 * validation, the exporter, the worksheet) instead of each regenerating it.
 */
export function designFor(project: Project): EngineStitch[] {
  if (designCache && designCache.project === project) return designCache.design;
  const design = generateDesign(project);
  designCache = { project, design };
  return design;
}

/** Number of actual penetrations (excludes jumps). */
export function countStitches(design: EngineStitch[]): number {
  return design.reduce((n, s) => n + (s.jump ? 0 : 1), 0);
}

/** Number of thread/color changes in the design. */
export function countColorChanges(design: EngineStitch[]): number {
  let changes = 0;
  let prev: string | null = null;
  for (const s of design) {
    if (s.colorId !== prev) {
      if (prev !== null) changes++;
      prev = s.colorId;
    }
  }
  return changes;
}

import type {
  EmbObject,
  FabricProfile,
  Path,
  Point,
  Project,
} from "../../types/project";
import { resolveParams, fabricProfile } from "../../types/project";
import { effectiveProfile } from "./profile";
import { distance, railsFromCenterline, pathsBounds } from "../geometry";
import { runningStitch } from "./running";
import { satinColumn } from "./satin";
import { tatamiFill, motifFill, motifRunAlong, carvePoints, splitFillRegions, autoFillAngleForRegions } from "./fill";
import { contourFill } from "./contour";
import { medialColumns, satinCoverage, residualRegions, type SatinColumn } from "./medial";
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
}

/** Push a run if it has any penetrations. */
function addRun(
  runs: StitchRun[],
  pts: Point[],
  underlay: boolean,
  region = 0,
  noBareTravel = false,
): void {
  if (pts.length > 0) runs.push({ pts, underlay, region, noBareTravel });
}

/**
 * Minimum fraction of a region a medial satin must cover to be used. Below this
 * the skeleton produced broken/scattered stitches, so we fall back to tatami.
 */
const MIN_SATIN_COVERAGE = 0.82;

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
  return out;
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
function acceptableSatin(region: Path[], density: number, pullScale: number): SatinColumn[] {
  // Adaptive skeleton resolution: a fixed 0.4 mm grid is far too coarse for small
  // lettering (a 2.5 mm stroke is barely 6 cells wide, so the skeleton staircases
  // and the rails wobble). Scale the cell to the region so a letter is resolved
  // finely while a big auto-digitized blob stays cheap. Clamped both ways; the
  // medial code caps total cells and falls back to fill if a region is enormous.
  const b = pathsBounds(region);
  const span = b ? Math.min(b.maxX - b.minX, b.maxY - b.minY) : 12;
  const cellMm = Math.max(0.12, Math.min(0.4, span / 60));
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

/**
 * A medial column thinner than this stitches as a single running line, not satin.
 * Kept low so genuinely fine strokes — script faces, serif hairlines, small text —
 * still get a COVERING satin column (crisp, filled) instead of a bare wireframe
 * line; only true hairlines (< 0.6 mm) run as a single line.
 */
const RUNNING_COLUMN_MM = 0.6;

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
  const regions = splitFillRegions(object.paths);
  // ONE grain angle for the whole object so every tatami region flows the same
  // way — a word or multi-blob logo reads as a single piece, not a patchwork of
  // differently-angled letters (stitch-direction continuity). The user's Angle
  // field offsets it.
  const tatamiAngle = autoFillAngleForRegions(regions, p.angle);
  regions.forEach((region, regionIdx) => {
    const columns = satin ? acceptableSatin(region, density, fabric.pullMul) : [];
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
        : fillUnderlayRuns(region, fillAngle, weight);
      for (const run of ulRuns) {
        for (const sub of splitLongTravels(run, travelMax)) {
          const u = dropShortStitches(sub);
          addRun(runs, u, true, regionIdx, usingSatin);
          if (u.length) cursor = u[u.length - 1];
        }
      }
    }

    // Top layer. Satin: hairline columns become a single running line, the rest
    // satin. Contour: rings that echo the outline. Otherwise a tatami fill (also
    // the fallback when contour can't seat a ring in a too-thin shape).
    let tops: Point[][];
    if (usingSatin) {
      tops = columns.map((c) =>
        c.widthMm < RUNNING_COLUMN_MM
          ? runningStitch(c.centerline, stitchLength)
          : c.throws,
      );
    } else if (contour) {
      const echo = contourFill(region, { density });
      tops = echo.length
        ? echo
        : [tatamiFill(region, { density, angle: fillAngle, stitchLength: p.fillStitchLength, pullCompMm: pullComp })];
    } else if (motifMode) {
      // Motif fill: tile a decorative motif across the region (no underlay).
      tops = motifFill(region, { motifId: p.motif, sizeMm: p.motifSizeMm, angle: tatamiAngle });
    } else {
      // Gradient fillStyle ramps row spacing across the shape for a shaded look.
      const gradient = p.fillStyle === "gradient" ? GRADIENT_FILL_MUL : undefined;
      let top = tatamiFill(region, { density, angle: fillAngle, stitchLength: p.fillStitchLength, pullCompMm: pullComp, gradient });
      // True relief carving: skip needle penetrations along the carve motif so the
      // surrounding fill floats over un-stitched grooves.
      if (p.carve && p.carve !== "none") {
        const curves = motifFill(region, { motifId: p.carve, sizeMm: p.motifSizeMm, angle: tatamiAngle });
        top = carvePoints(top, curves, CARVE_GROOVE_MM);
      }
      tops = [top];
    }

    // Sew the fill's pieces nearest-neighbor from where the underlay left off,
    // for the shortest travel between them (pure reordering; geometry unchanged).
    // Satin orders whole columns (so each column's zig-zag stays one continuous
    // throw sequence) then splits. Tatami/contour split the fill path into
    // machine-safe pieces FIRST, then order those — so a concave shape's spans
    // connect with short travels instead of leaping (and trimming) across it.
    if (usingSatin) {
      // Tatami-fill any interior the satin left bare — the small patches at stroke
      // crossings and 3-way junctions where columns are trimmed back so they don't
      // fan. Without this a self-crossing script loop (the 'l' in "hello") shows a
      // hole. Laid first so the satin sits on top at the seams.
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
      for (const run of orderByNearest(tops, cursor)) {
        for (const sub of splitLongTravels(run, travelMax)) {
          addRun(runs, dropShortStitches(sub, minStitch), false, regionIdx, true);
        }
      }
    } else {
      const subRuns = tops.flatMap((run) => splitLongTravels(run, travelMax));
      for (const sub of orderByNearest(subRuns, cursor)) {
        addRun(runs, dropShortStitches(sub, minStitch), false, regionIdx);
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
    })),
  );

  // Coverage map: a travel is acceptable only if it stays HIDDEN — i.e. the whole
  // connector lies under a fill region (its own shape's fill, or another's),
  // regardless of stitch order. A travel across OPEN fabric (e.g. between the
  // letters of a word) would show as a thread slash, so it is trimmed instead.
  const fills = drawn
    .map((d) => d.object)
    .filter((o, i, arr) => o.type === "fill" && arr.findIndex((x) => x.id === o.id) === i);
  /** True if the whole segment a→b lies under some fill region (hidden). */
  function coveredBetween(a: Point, b: Point): boolean {
    if (fills.length === 0) return false;
    const samples = Math.max(2, Math.ceil(distance(a, b) / 1.5));
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      let covered = false;
      for (const o of fills) {
        if (pointInRings(p, o.paths)) {
          covered = true;
          break;
        }
      }
      if (!covered) return false;
    }
    return true;
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
    const colorChanged = object.colorId !== prevColor;
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
        gap > jumpThreshold &&
        gap <= MAX_COVERED_TRAVEL &&
        coveredBetween(prevPoint, start);
      const shortTravel =
        !colorChanged && !d.noBareTravel && gap > jumpThreshold && gap <= exposedMax;
      if (intraTravel || hiddenTravel || shortTravel) {
        const travel = runningStitch([prevPoint, start], TRAVEL_STITCH);
        for (const pt of travel.slice(1, -1)) {
          out.push({ x: pt.x, y: pt.y, colorId: object.colorId, objectId: object.id });
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
          colorId: object.colorId,
          objectId: object.id,
          jump: true,
          trim: trimmed,
        });
      }
    }

    // Tie in at the first penetration of every new thread run.
    const startsRun = di === 0 || trimmed;
    if (lockStitches && startsRun) {
      pushTie(out, start, pts[1] ?? start, { id: object.id, colorId: object.colorId });
    }

    pts.forEach((pt) => {
      out.push({
        x: pt.x,
        y: pt.y,
        colorId: object.colorId,
        objectId: object.id,
        underlay: d.underlay,
      });
    });

    // Appliqué STOP: pause the machine here (lay or trim the fabric) at the last
    // penetration of this run, same thread continues afterward.
    if (d.stopAfter && pts.length > 0) {
      const last = pts[pts.length - 1];
      out.push({ x: last.x, y: last.y, colorId: object.colorId, objectId: object.id, stop: true });
    }

    prevPoint = pts[pts.length - 1];
    prevToward = pts.length > 1 ? pts[pts.length - 2] : pts[0];
    prevColor = object.colorId;
    prevRegionKey = `${object.id}#${d.region}`;
  });

  // Tie off the very end of the final thread run.
  if (lockStitches && prevPoint) {
    const lastObj = drawn[drawn.length - 1].object;
    const lastPts = drawn[drawn.length - 1].pts;
    const toward = lastPts.length > 1 ? lastPts[lastPts.length - 2] : prevPoint;
    pushTie(out, prevPoint, toward, { id: lastObj.id, colorId: lastObj.colorId });
  }

  return collapseCoincident(out);
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
  drawn: { object: EmbObject }[],
  di: number,
): { id: string; colorId: string } {
  const prev = (drawn[di - 1] ?? drawn[di])?.object;
  return prev ? { id: prev.id, colorId: prev.colorId } : { id: "", colorId: "" };
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

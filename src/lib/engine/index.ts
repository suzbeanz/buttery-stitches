import type {
  EmbObject,
  FabricProfile,
  Path,
  Point,
  Project,
} from "../../types/project";
import { resolveParams, fabricProfile } from "../../types/project";
import { distance } from "../geometry";
import { runningStitch } from "./running";
import { satinColumn } from "./satin";
import { tatamiFill, splitFillRegions, autoFillAngle } from "./fill";
import { contourFill } from "./contour";
import { medialColumns, satinCoverage, type SatinColumn } from "./medial";
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

/**
 * Build a small cluster of real penetrations that lock the thread at `anchor`.
 * The cluster zig-zags ~`TIE_AMPLITUDE` mm toward `toward` and back, ending on
 * `anchor` so the following (or preceding) stitching continues cleanly. These
 * are genuine needle penetrations, never jumps, so the machine actually
 * fastens the thread instead of relying on tension alone.
 */
function tieStitches(anchor: Point, toward: Point): Point[] {
  const dx = toward.x - anchor.x;
  const dy = toward.y - anchor.y;
  const len = Math.hypot(dx, dy);
  // Aim the tie along the run direction; fall back to +x for a degenerate point.
  const ux = len > 1e-6 ? dx / len : 1;
  const uy = len > 1e-6 ? dy / len : 0;
  const near: Point = { x: anchor.x + ux * TIE_AMPLITUDE, y: anchor.y + uy * TIE_AMPLITUDE };

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
}

/** Push a run if it has any penetrations. */
function addRun(runs: StitchRun[], pts: Point[], underlay: boolean): void {
  if (pts.length > 0) runs.push({ pts, underlay });
}

/**
 * Minimum fraction of a region a medial satin must cover to be used. Below this
 * the skeleton produced broken/scattered stitches, so we fall back to tatami.
 */
const MIN_SATIN_COVERAGE = 0.82;

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
  const columns = medialColumns(region, { density, pullScale });
  if (columns.length === 0) return [];

  // Median stroke width across the glyph's strokes; bold/large faces fail this
  // and fall through to a solid fill.
  const widths = columns.map((c) => c.widthMm).sort((a, b) => a - b);
  const medianWidth = widths[widths.length >> 1];
  if (medianWidth > MAX_SATIN_STROKE_MM) return [];

  const coverage = satinCoverage(region, columns.map((c) => c.throws));
  return coverage >= MIN_SATIN_COVERAGE ? columns : [];
}

/** A medial column thinner than this stitches as a single running line, not satin. */
const RUNNING_COLUMN_MM = 1.2;

/**
 * Min-stitch for SATIN runs. Satin is intentionally dense — its row spacing
 * (≈0.3–0.5 mm) is the gap between consecutive same-rail penetrations, well below
 * the 0.5 mm general minimum. Thinning satin at 0.5 mm would cull every other
 * throw and shred a smooth column into a sparse, spiky zig-zag, so satin keeps a
 * much smaller floor (only truly coincident punches are dropped, by the assembler).
 */
const SATIN_MIN_STITCH = 0.15;

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
  const density = p.density * fabric.densityMul;
  const pullComp = p.pullComp * fabric.pullMul;
  const weight = fabric.underlay;
  const runs: StitchRun[] = [];

  if (object.type === "running") {
    addRun(runs, dropShortStitches(runningStitch(object.paths[0] ?? [], p.stitchLength)), false);
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
      dropShortStitches(satinColumn(left, right, { density, pullComp }), SATIN_MIN_STITCH),
      false,
    );
    return runs;
  }

  // fill — underlay then top, per connected region. Keeping each pass a separate
  // run lets the assembler jump between them. Strokes satin along their medial
  // axis (very thin ones run as a single line); broad areas use tatami; the
  // medial pass falls back to tatami where satin won't cover cleanly.
  const satin = p.fillStyle === "satin";
  for (const region of splitFillRegions(object.paths)) {
    const columns = satin ? acceptableSatin(region, density, fabric.pullMul) : [];
    const usingSatin = columns.length > 0;
    const contour = !usingSatin && p.fillStyle === "contour";
    const travelMax = usingSatin ? 8 : 6;
    // Satin and contour rows are dense like satin; tatami uses the general floor.
    const minStitch = usingSatin || contour ? SATIN_MIN_STITCH : undefined;
    // Tatami flows along the region's grain (off-axis for roundish shapes), with
    // the user's Angle field as an offset. Underlay follows the same angle.
    const fillAngle = usingSatin ? p.angle : autoFillAngle(region, p.angle);

    let cursor: Point | null = null;
    if (p.underlay) {
      // Satin: tiered underlay per column (center / edge-walk / zig-zag by width).
      // Tatami: inset edge run + perpendicular pass(es).
      const ulRuns = usingSatin
        ? columns.flatMap((c) => columnUnderlay(c.centerline, c.widthMm, weight))
        : fillUnderlayRuns(region, fillAngle, weight);
      for (const run of ulRuns) {
        for (const sub of splitLongTravels(run, travelMax)) {
          const u = dropShortStitches(sub);
          addRun(runs, u, true);
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
          ? runningStitch(c.centerline, p.stitchLength)
          : c.throws,
      );
    } else if (contour) {
      const echo = contourFill(region, { density });
      tops = echo.length ? echo : [tatamiFill(region, { density, angle: fillAngle })];
    } else {
      tops = [tatamiFill(region, { density, angle: fillAngle })];
    }

    // Sew the strokes nearest-neighbor from where the underlay left off, for the
    // shortest travel between them (pure reordering; geometry unchanged).
    const ordered = usingSatin ? orderByNearest(tops, cursor) : tops;
    for (const run of ordered) {
      for (const sub of splitLongTravels(run, travelMax)) {
        addRun(runs, dropShortStitches(sub, minStitch), false);
      }
    }
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
  { jumpThreshold = 3, trimThreshold = 8, lockStitches = true }: DesignOptions = {},
): EngineStitch[] {
  // First pass: expand each visible object into its runs (a fill contributes one
  // run per region), keeping only runs that actually produce penetrations. The
  // travel logic below then jumps/trims between consecutive runs — including
  // between the disjoint regions of a single fill.
  const fabric = fabricProfile(project.fabric);
  const drawn = project.objects
    .filter((o) => o.visible)
    .flatMap((object) =>
      generateObjectRuns(object, fabric).map((run) => ({
        object,
        pts: run.pts,
        underlay: run.underlay,
      })),
    )
    .filter((d) => d.pts.length > 0);

  const out: EngineStitch[] = [];
  let prevPoint: Point | null = null;
  let prevColor: string | null = null;

  drawn.forEach((d, di) => {
    const { object, pts } = d;
    const colorChanged = object.colorId !== prevColor;
    const start = pts[0];

    // Travel from where we left off to this object's first penetration.
    let trimmed = false;
    if (prevPoint) {
      const gap = distance(prevPoint, start);
      if (colorChanged || gap > jumpThreshold) {
        trimmed = colorChanged || gap > trimThreshold;
        // A trim ends the previous thread run — tie it off where we left it.
        if (lockStitches && trimmed) pushTie(out, prevPoint, start, prevColorObj(drawn, di));
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

    prevPoint = pts[pts.length - 1];
    prevColor = object.colorId;
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
  const prev = drawn[di - 1].object;
  return { id: prev.id, colorId: prev.colorId };
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

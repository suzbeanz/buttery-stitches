import type { EmbObject, Point, Project } from "../../types/project";
import { resolveParams } from "../../types/project";
import { distance } from "../geometry";
import { runningStitch } from "./running";
import { satinColumn } from "./satin";
import { tatamiFill, columnSatinFill, splitFillRegions } from "./fill";
import {
  fillEdgeUnderlay,
  fillParallelUnderlay,
  satinUnderlay,
} from "./underlay";
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
 * The runs for a single object. Splitting a fill into its regions (and underlay
 * from top) here is what lets `generateDesign` jump between them.
 */
export function generateObjectRuns(object: EmbObject): StitchRun[] {
  const p = resolveParams(object.type, object.params);
  const runs: StitchRun[] = [];

  if (object.type === "running") {
    addRun(runs, dropShortStitches(runningStitch(object.paths[0] ?? [], p.stitchLength)), false);
    return runs;
  }

  if (object.type === "satin") {
    const [left, right] = object.paths;
    if (!left || !right) return runs;
    if (p.underlay) addRun(runs, dropShortStitches(satinUnderlay(left, right)), true);
    addRun(
      runs,
      dropShortStitches(satinColumn(left, right, { density: p.density, pullComp: p.pullComp })),
      false,
    );
    return runs;
  }

  // fill — edge + parallel underlay, then top, per connected region. Keeping
  // each pass a separate run lets the assembler jump between them rather than
  // dragging a long stitch from the edge run to the fill start. Lettering uses
  // satin columns (smooth + shiny); broad areas use tatami. The top pass is also
  // split wherever it would travel across a counter/gap, so those become jumps
  // instead of long stitches.
  const satin = p.fillStyle === "satin";
  const topFill = satin ? columnSatinFill : tatamiFill;
  const travelMax = satin ? 8 : 6;
  for (const region of splitFillRegions(object.paths)) {
    if (p.underlay) {
      addRun(runs, dropShortStitches(fillEdgeUnderlay(region)), true);
      // The parallel pass crosses counters too, so split its travels as well.
      for (const sub of splitLongTravels(fillParallelUnderlay(region, p.angle), travelMax)) {
        addRun(runs, dropShortStitches(sub), true);
      }
    }
    const top = topFill(region, { density: p.density, angle: p.angle });
    for (const sub of splitLongTravels(top, travelMax)) {
      addRun(runs, dropShortStitches(sub), false);
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
  const drawn = project.objects
    .filter((o) => o.visible)
    .flatMap((object) =>
      generateObjectRuns(object).map((run) => ({
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

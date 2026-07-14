import type { Project } from "../../types/project";
import type { EngineStitch } from "./index";

/**
 * Design info / production estimate (the "design info" + estimator), derived
 * purely from the generated stitch stream. Used by the Check panel and the
 * printable worksheet so the user sees what they're about to run before
 * exporting.
 *
 * The runtime model lives here as the SINGLE source of truth — the worksheet
 * imports it so the two figures the user sees can never disagree (they used to:
 * 700 spm here vs 600 spm in the worksheet).
 */

/** Assumed sewing speed for the runtime estimate (stitches/min). A mid-range
 *  home/commercial average; export and worksheet share this number. */
export const STITCHES_PER_MIN = 700;
/** Seconds of overhead per color change (trim, change, re-thread/positioning). */
export const COLOR_CHANGE_SEC = 25;
/** Seconds per trim (thread cut + tie). */
export const TRIM_SEC = 2;
/** Rough bobbin (under-thread) consumption as a fraction of top-thread length.
 *  The bobbin only shows on the underside, so it draws far less than the top;
 *  ~⅓ is the common shop rule of thumb. Clearly an estimate, not a measurement. */
export const BOBBIN_RATIO = 1 / 3;

/** Shared runtime estimate (minutes): sewing time + change/trim overhead. */
export function estimateRuntimeMin(
  stitches: number,
  colorChanges: number,
  trims: number,
): number {
  return (
    stitches / STITCHES_PER_MIN +
    (colorChanges * COLOR_CHANGE_SEC + trims * TRIM_SEC) / 60
  );
}

/** Per-thread breakdown for the worksheet's spool-ordering column. */
export interface ColorUsage {
  colorId: string;
  stitches: number;
  /** top thread laid for this color (mm). */
  threadLengthMm: number;
}

export interface DesignInfo {
  stitches: number;
  jumps: number;
  trims: number;
  colors: number;
  /** total top thread actually laid down (mm) — stitched segments, excludes jumps. */
  threadLengthMm: number;
  /** rough bobbin/under-thread consumption (mm) — an estimate (~⅓ of top). */
  bobbinLengthMm: number;
  /** rough run time in minutes (sewing + color-change/trim overhead). */
  runtimeMin: number;
  widthMm: number;
  heightMm: number;
  /** the design's stitched extent fits inside the hoop. */
  withinHoop: boolean;
  /** per-color stitch count + thread length, in sew order. */
  perColor: ColorUsage[];
}

export function designInfo(design: EngineStitch[], project: Project): DesignInfo {
  let stitches = 0;
  let jumps = 0;
  let trims = 0;
  let threadLengthMm = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let prev: EngineStitch | null = null;

  // Per-color accumulation (keyed by colorId; a color sewn in two blocks folds
  // into one entry so the spool total is right).
  const usage = new Map<string, ColorUsage>();
  const usageFor = (id: string): ColorUsage => {
    let u = usage.get(id);
    if (!u) {
      u = { colorId: id, stitches: 0, threadLengthMm: 0 };
      usage.set(id, u);
    }
    return u;
  };

  for (const s of design) {
    if (s.jump) jumps++;
    if (s.trim) trims++;
    const isStitch = !s.jump && !s.trim && !s.stop;
    if (isStitch) {
      stitches++;
      const u = usageFor(s.colorId);
      u.stitches++;
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y;
      if (prev && !prev.jump && !prev.trim && !prev.stop && prev.colorId === s.colorId) {
        const seg = Math.hypot(s.x - prev.x, s.y - prev.y);
        threadLengthMm += seg;
        u.threadLengthMm += seg;
      }
    }
    prev = s;
  }

  const colors = usage.size;
  const colorChanges = Math.max(0, colors - 1);
  const runtimeMin = estimateRuntimeMin(stitches, colorChanges, trims);

  const widthMm = maxX >= minX ? maxX - minX : 0;
  const heightMm = maxY >= minY ? maxY - minY : 0;
  const withinHoop =
    stitches === 0 || (widthMm <= project.hoop.wMm + 1e-6 && heightMm <= project.hoop.hMm + 1e-6);

  return {
    stitches,
    jumps,
    trims,
    colors,
    threadLengthMm,
    bobbinLengthMm: threadLengthMm * BOBBIN_RATIO,
    runtimeMin,
    widthMm,
    heightMm,
    withinHoop,
    perColor: [...usage.values()],
  };
}

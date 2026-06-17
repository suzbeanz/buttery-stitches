import type { Project } from "../../types/project";
import type { EngineStitch } from "./index";

/**
 * Design info / production estimate (Wilcom's "design info" + estimator), derived
 * purely from the generated stitch stream. Used by the Check panel so the user
 * sees what they're about to run before exporting.
 */

/** Assumed sewing speed for the runtime estimate (stitches/min). */
const STITCHES_PER_MIN = 700;
/** Seconds of overhead per color change (trim, change, re-thread/positioning). */
const COLOR_CHANGE_SEC = 25;
/** Seconds per trim (thread cut + tie). */
const TRIM_SEC = 2;

export interface DesignInfo {
  stitches: number;
  jumps: number;
  trims: number;
  colors: number;
  /** total thread actually laid down (mm) — stitched segments, excludes jumps. */
  threadLengthMm: number;
  /** rough run time in minutes (sewing + color-change/trim overhead). */
  runtimeMin: number;
  widthMm: number;
  heightMm: number;
  /** the design's stitched extent fits inside the hoop. */
  withinHoop: boolean;
}

export function designInfo(design: EngineStitch[], project: Project): DesignInfo {
  let stitches = 0;
  let jumps = 0;
  let trims = 0;
  let threadLengthMm = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let prev: EngineStitch | null = null;

  for (const s of design) {
    if (s.jump) jumps++;
    if (s.trim) trims++;
    const isStitch = !s.jump && !s.trim && !s.stop;
    if (isStitch) {
      stitches++;
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y;
      if (prev && !prev.jump && !prev.trim && !prev.stop && prev.colorId === s.colorId) {
        threadLengthMm += Math.hypot(s.x - prev.x, s.y - prev.y);
      }
    }
    prev = s;
  }

  const colors = new Set(design.map((s) => s.colorId)).size;
  const colorChanges = Math.max(0, colors - 1);
  const runtimeMin =
    stitches / STITCHES_PER_MIN +
    (colorChanges * COLOR_CHANGE_SEC + trims * TRIM_SEC) / 60;

  const widthMm = maxX >= minX ? maxX - minX : 0;
  const heightMm = maxY >= minY ? maxY - minY : 0;
  const withinHoop =
    stitches === 0 || (widthMm <= project.hoop.wMm + 1e-6 && heightMm <= project.hoop.hMm + 1e-6);

  return { stitches, jumps, trims, colors, threadLengthMm, runtimeMin, widthMm, heightMm, withinHoop };
}

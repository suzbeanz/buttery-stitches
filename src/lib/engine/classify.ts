import type { Path } from "../../types/project";
import { polygonArea, polygonPerimeter } from "../trace/classify";

/**
 * Which stitch a closed region wants — the core digitizer decision
 * (docs/stitch-logic.md §2). Driven by the region's mean STROKE width, computed
 * holes-aware so a ring like the letter "o" reads as its band width (a thin
 * stroke → satin), not the diameter of its outer circle (which would look broad).
 *
 *   width < runningMax            → running (a hairline / single line)
 *   runningMax ≤ width ≤ satinMax → satin   (a stroke to lay shiny columns down)
 *   width > satinMax              → tatami  (a broad area to fill)
 *
 * This is the coarse call; the engine's medial-axis + coverage check makes the
 * final satin-vs-tatami decision per region (a solid blob skeletonizes poorly and
 * falls back to tatami even if its mean width is small).
 */
export type StitchKind = "running" | "satin" | "tatami";

export interface ClassifyOptions {
  /** below this mean width (mm) a region is a hairline → running. */
  runningMaxWidthMm?: number;
  /** above this mean width (mm) a region is broad → tatami. */
  satinMaxWidthMm?: number;
}

/** Mean stroke width (mm) of a region: 2·netArea / totalPerimeter, holes-aware. */
export function meanStrokeWidthMm(rings: Path[]): number {
  const usable = rings.filter((r) => r.length >= 3);
  if (usable.length === 0) return 0;
  const outer = usable[0];
  const holes = usable.slice(1);
  const netArea =
    polygonArea(outer) - holes.reduce((s, h) => s + polygonArea(h), 0);
  const totalPer =
    polygonPerimeter(outer) + holes.reduce((s, h) => s + polygonPerimeter(h), 0);
  if (totalPer <= 0 || netArea <= 0) return 0;
  return (2 * netArea) / totalPer;
}

export function classifyRegion(rings: Path[], opts: ClassifyOptions = {}): StitchKind {
  const runningMax = opts.runningMaxWidthMm ?? 1.2;
  const satinMax = opts.satinMaxWidthMm ?? 7;
  const width = meanStrokeWidthMm(rings);
  if (width <= 0) return "tatami";
  if (width < runningMax) return "running";
  if (width <= satinMax) return "satin";
  return "tatami";
}

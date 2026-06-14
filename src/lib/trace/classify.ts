import type { Path, StitchType } from "../../types/project";
import { distance } from "../geometry";

/** Signed area of a closed polygon (shoelace). */
export function signedArea(path: Path): number {
  let sum = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(path: Path): number {
  return Math.abs(signedArea(path));
}

/** Perimeter of a closed polygon. */
export function polygonPerimeter(path: Path): number {
  let p = 0;
  for (let i = 0; i < path.length; i++) {
    p += distance(path[i], path[(i + 1) % path.length]);
  }
  return p;
}

export interface ClassifyOptions {
  /** shapes thinner than this mean width become running stitches (default 1.2) */
  runningMaxWidth?: number;
  /** shapes smaller than this are noise to be dropped (default 2 mm²) */
  minAreaMm2?: number;
  /** a thin shape is only a real stroke if at least this long (default 6 mm);
   *  shorter thin shapes are anti-aliasing fringe and are dropped. */
  runningMinLengthMm?: number;
}

export interface Classification {
  type: StitchType;
  areaMm2: number;
  meanWidthMm: number;
}

/**
 * Classify a traced region (mm polygon) into a stitch type.
 *
 * Mean width ≈ 2·area / perimeter — for a long thin shape this is its actual
 * width, so it's a good "is this a stroke or a blob?" signal. Broad shapes become
 * fills; genuinely long thin shapes become running stitches. Crucially, SHORT
 * thin shapes are the anti-aliasing fringe between color regions, not real
 * strokes, so they are dropped — that's what keeps an auto-digitized logo to a
 * handful of clean objects instead of dozens of sliver outlines.
 *
 * Returns `null` for shapes that are noise (too small, or short fringe).
 */
export function classifyShape(
  path: Path,
  opts: ClassifyOptions = {},
): Classification | null {
  const runningMaxWidth = opts.runningMaxWidth ?? 1.2;
  const minArea = opts.minAreaMm2 ?? 2;
  const runningMinLength = opts.runningMinLengthMm ?? 6;

  const area = polygonArea(path);
  if (area < minArea) return null;

  const perimeter = polygonPerimeter(path);
  const meanWidth = perimeter > 0 ? (2 * area) / perimeter : 0;

  if (meanWidth < runningMaxWidth) {
    // Thin: a real stroke only if it's long enough; otherwise it's fringe noise.
    const length = perimeter / 2; // ≈ length for a long thin shape
    if (length < runningMinLength) return null;
    return { type: "running", areaMm2: area, meanWidthMm: meanWidth };
  }

  return { type: "fill", areaMm2: area, meanWidthMm: meanWidth };
}

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
  /** shapes smaller than this are noise to be dropped (default 1 mm²) */
  minAreaMm2?: number;
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
 * width, so it's a good "is this a stroke or a blob?" signal. Thin shapes become
 * running stitches; everything else is a fill. (Auto-satin needs medial-axis
 * extraction and is intentionally deferred — users can convert a fill to satin
 * with one click in the editor.)
 *
 * Returns `null` for shapes below the noise threshold (despeckle).
 */
export function classifyShape(
  path: Path,
  opts: ClassifyOptions = {},
): Classification | null {
  const runningMaxWidth = opts.runningMaxWidth ?? 1.2;
  const minArea = opts.minAreaMm2 ?? 1;

  const area = polygonArea(path);
  if (area < minArea) return null;

  const perimeter = polygonPerimeter(path);
  const meanWidth = perimeter > 0 ? (2 * area) / perimeter : 0;

  const type: StitchType = meanWidth < runningMaxWidth ? "running" : "fill";
  return { type, areaMm2: area, meanWidthMm: meanWidth };
}

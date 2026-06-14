import type { EmbObject } from "../types/project";
import { pathsBounds, translatePaths, type Bounds } from "./geometry";

/**
 * Document layout: design sizing and hoop fitting.
 *
 * Resizing scales the millimetre *geometry*, never the stitches. Because the
 * engine regenerates stitches from geometry at a fixed density, a larger design
 * automatically gets proportionally more stitches (re-densification) — scaling
 * raw stitch points, which destroys density, is exactly what we avoid.
 */

/** Bounding box of every object's paths. */
export function designBounds(objects: EmbObject[]): Bounds | null {
  return pathsBounds(objects.flatMap((o) => o.paths));
}

/** Scale all object paths about a pivot (sx/sy may differ if aspect unlocked). */
export function scaleAllPaths(
  objects: EmbObject[],
  sx: number,
  sy: number,
  pivot: { x: number; y: number },
): EmbObject[] {
  return objects.map((o) => ({
    ...o,
    paths: o.paths.map((path) =>
      path.map((p) => ({
        x: pivot.x + (p.x - pivot.x) * sx,
        y: pivot.y + (p.y - pivot.y) * sy,
      })),
    ),
  }));
}

/** Translate all object paths. */
export function translateAllPaths(
  objects: EmbObject[],
  dx: number,
  dy: number,
): EmbObject[] {
  return objects.map((o) => ({ ...o, paths: translatePaths(o.paths, dx, dy) }));
}

/** Current design width/height in mm (0 if empty). */
export function designSize(objects: EmbObject[]): { w: number; h: number } {
  const b = designBounds(objects);
  if (!b) return { w: 0, h: 0 };
  return { w: b.maxX - b.minX, h: b.maxY - b.minY };
}

/**
 * Uniformly scale the design so it fills `margin` of the hoop, then centre it.
 * Uniform scaling keeps stitch quality (a non-uniform squash would distort
 * satin widths and fill angles).
 */
export function fitToHoop(
  objects: EmbObject[],
  hoop: { wMm: number; hMm: number },
  margin = 0.9,
): EmbObject[] {
  const b = designBounds(objects);
  if (!b) return objects;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  if (bw <= 0 || bh <= 0) return objects;

  const factor = Math.min((hoop.wMm * margin) / bw, (hoop.hMm * margin) / bh);
  const pivot = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const scaled = scaleAllPaths(objects, factor, factor, pivot);

  const nb = designBounds(scaled)!;
  const dx = hoop.wMm / 2 - (nb.minX + nb.maxX) / 2;
  const dy = hoop.hMm / 2 - (nb.minY + nb.maxY) / 2;
  return translateAllPaths(scaled, dx, dy);
}

/**
 * Resize the design to a target width (mm), uniformly, about its centre.
 * Returns the objects unchanged if there's nothing to scale.
 */
export function resizeToWidth(
  objects: EmbObject[],
  targetWMm: number,
): EmbObject[] {
  const { w } = designSize(objects);
  if (w <= 0 || targetWMm <= 0) return objects;
  const factor = targetWMm / w;
  const b = designBounds(objects)!;
  const pivot = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  return scaleAllPaths(objects, factor, factor, pivot);
}

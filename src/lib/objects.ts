import type { EmbObject, Path, StitchType } from "../types/project";
import { newId } from "./id";
import { defaultObjectName } from "./project";
import {
  railsFromCenterline,
  centerlineOf,
  distance,
} from "./geometry";

/** Default satin column width (mm) when building rails from a centerline. */
export const DEFAULT_SATIN_WIDTH = 4;

/**
 * Build an EmbObject of the given type from a drawn path of points (mm).
 *  - running: the path is used as-is (open polyline).
 *  - fill:    the path is the region outline (closed when stitched/rendered).
 *  - satin:   the path is treated as a centerline; we derive a left/right rail
 *             pair so the geometry matches the data model.
 */
export function makeObject(
  type: StitchType,
  drawn: Path,
  colorId: string,
): EmbObject {
  let paths: Path[];
  if (type === "satin") {
    const [left, right] = railsFromCenterline(drawn, DEFAULT_SATIN_WIDTH);
    paths = [left, right];
  } else {
    paths = [drawn];
  }
  return {
    id: newId("obj"),
    name: defaultObjectName(type),
    type,
    colorId,
    paths,
    params: {},
    visible: true,
  };
}

/** Minimum points a drawing of this type needs before it can be committed. */
export function minPointsFor(type: StitchType): number {
  return type === "fill" ? 3 : 2;
}

/**
 * Build an EmbObject from already-formed paths (used by auto-digitize, where a
 * fill may carry holes). Unlike makeObject, the paths are taken verbatim.
 */
export function makeObjectFromPaths(
  type: StitchType,
  paths: Path[],
  colorId: string,
  name?: string,
): EmbObject {
  return {
    id: newId("obj"),
    name: name ?? defaultObjectName(type),
    type,
    colorId,
    paths,
    params: {},
    visible: true,
  };
}

/**
 * Current satin column width (mm): the average gap between corresponding rail
 * points. Returns the default when the geometry isn't a usable rail pair.
 */
export function satinWidthOf(paths: Path[]): number {
  if (paths.length < 2) return DEFAULT_SATIN_WIDTH;
  const [left, right] = paths;
  const n = Math.min(left.length, right.length);
  if (n === 0) return DEFAULT_SATIN_WIDTH;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += distance(left[i], right[i]);
  return sum / n;
}

/**
 * Re-derive a satin rail pair at a new column width, keeping the centerline
 * (the midline of the existing rails) fixed.
 */
export function setSatinWidth(paths: Path[], widthMm: number): Path[] {
  if (paths.length < 2) return paths;
  const center = centerlineOf(paths[0], paths[1]);
  const [left, right] = railsFromCenterline(center, Math.max(0.2, widthMm));
  return [left, right];
}

/**
 * Convert an object's geometry to match a new stitch type so the paths always
 * satisfy the type's invariant (satin = rail pair, running/fill = one polyline).
 * Returns the patch to apply; if the type is unchanged, returns {}.
 *
 *  - → satin:        treat the first path as a centerline and build rails.
 *  - satin → other:  collapse the rail pair back to its centerline.
 *  - running ↔ fill: geometry is identical (open vs closed is a render concern).
 */
export function convertObjectType(
  object: EmbObject,
  newType: StitchType,
): Partial<EmbObject> {
  if (newType === object.type) return {};

  if (newType === "satin") {
    const width =
      object.type === "satin" ? satinWidthOf(object.paths) : DEFAULT_SATIN_WIDTH;
    const center = object.paths[0] ?? [];
    const [left, right] = railsFromCenterline(center, width);
    return { type: newType, paths: [left, right] };
  }

  if (object.type === "satin") {
    const center =
      object.paths.length >= 2
        ? centerlineOf(object.paths[0], object.paths[1])
        : (object.paths[0] ?? []);
    return { type: newType, paths: [center] };
  }

  // running <-> fill: same points.
  return { type: newType };
}

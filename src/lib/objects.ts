import type { EmbObject, NodePath, Path, StitchType } from "../types/project";
import { newId } from "./id";
import { densifyRing, translateNodes } from "./nodes";
import { defaultObjectName } from "./project";
import {
  railsFromCenterline,
  centerlineOf,
  distance,
  translatePaths,
} from "./geometry";

/** Default satin column width (mm) when building rails from a centerline. */
export const DEFAULT_SATIN_WIDTH = 4;

/**
 * Expand a set of selected ids to include every group-mate: selecting one member
 * of a group selects the whole group (so they move/align/delete together).
 */
export function expandGroups(objects: EmbObject[], ids: string[]): string[] {
  const want = new Set(ids);
  const groups = new Set<string>();
  for (const o of objects) {
    if (o.groupId && want.has(o.id)) groups.add(o.groupId);
  }
  if (groups.size === 0) return ids;
  const out = new Set(ids);
  for (const o of objects) {
    if (o.groupId && groups.has(o.groupId)) out.add(o.id);
  }
  // Preserve document order for stable, predictable selection.
  return objects.filter((o) => out.has(o.id)).map((o) => o.id);
}

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

/** Whether an object's rings are closed loops (fills) for densify/editing. */
export function isClosedType(type: StitchType): boolean {
  return type === "fill";
}

/** Densify a node model into the polyline `paths` the engine consumes. */
export function pathsFromNodes(nodes: NodePath[], closed: boolean): Path[] {
  return nodes.map((ring) => densifyRing(ring, closed));
}

/**
 * Build a node-backed object (running line or fill) from the user's placed
 * control nodes. The editable nodes are kept on the object; `paths` is densified
 * from them so the engine/exporter stay oblivious. `smooth` seeds every node's
 * curve flag (the Curve toggle at draw time).
 */
export function makeNodeObject(
  type: "running" | "fill",
  points: Path,
  colorId: string,
  smooth: boolean,
): EmbObject {
  const closed = isClosedType(type);
  const nodes: NodePath[] = [points.map((p) => ({ x: p.x, y: p.y, smooth }))];
  return {
    id: newId("obj"),
    name: defaultObjectName(type),
    type,
    colorId,
    nodes,
    paths: pathsFromNodes(nodes, closed),
    params: {},
    visible: true,
  };
}

/**
 * Deep-copy an object with a fresh id, optionally shifted by (dx, dy) mm. Used
 * for copy/paste and duplicate so the clone is fully independent of the original.
 */
export function cloneObject(
  object: EmbObject,
  dxMm = 0,
  dyMm = 0,
): EmbObject {
  return {
    ...object,
    id: newId("obj"),
    paths: translatePaths(object.paths, dxMm, dyMm),
    nodes: object.nodes ? translateNodes(object.nodes, dxMm, dyMm) : undefined,
    params: { ...object.params },
    visible: true,
  };
}

/** Minimum points a drawing of this type needs before it can be committed. */
export function minPointsFor(type: StitchType): number {
  return type === "fill" ? 3 : 2;
}

/**
 * Build a satin column from two user-drawn rails (Wilcom's "Input B"). railB is
 * flipped if it runs opposite to railA, so corresponding points pair up and the
 * column doesn't twist into a bow-tie. Rails are kept verbatim, so the width can
 * vary freely along the column (calligraphic strokes, tapered borders).
 */
export function makeSatinFromRails(railA: Path, railB: Path, colorId: string): EmbObject {
  if (railA.length < 2 || railB.length < 2) {
    return makeObjectFromPaths("satin", [railA, railB], colorId);
  }
  const a0 = railA[0];
  const aN = railA[railA.length - 1];
  const b0 = railB[0];
  const bN = railB[railB.length - 1];
  const straight = distance(a0, b0) + distance(aN, bN);
  const flipped = distance(a0, bN) + distance(aN, b0);
  const right = flipped < straight ? [...railB].reverse() : railB;
  return makeObjectFromPaths("satin", [railA, right], colorId);
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
    // A satin column needs a real centerline (≥2 points) to build rails from.
    // For degenerate geometry, just retype without inventing empty rails.
    if (center.length < 2) return { type: newType };
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

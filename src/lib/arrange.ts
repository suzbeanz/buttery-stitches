import type { EmbObject, Hoop } from "../types/project";
import { pathsBounds, translatePaths, type Bounds } from "./geometry";
import { translateNodes } from "./nodes";

/** Translate an object's paths and (if present) its editable nodes together. */
function shiftObject(o: EmbObject, dx: number, dy: number): EmbObject {
  return {
    ...o,
    paths: translatePaths(o.paths, dx, dy),
    nodes: o.nodes ? translateNodes(o.nodes, dx, dy) : undefined,
  };
}

/**
 * Align & distribute — pure layout helpers. Each returns a NEW objects array
 * (only the selected objects are translated), so the caller commits it in one
 * undo step. All millimeters.
 */

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeAxis = "h" | "v";

interface Item {
  o: EmbObject;
  b: Bounds;
}

function selectedItems(objects: EmbObject[], ids: string[]): Item[] {
  const want = new Set(ids);
  const out: Item[] = [];
  for (const o of objects) {
    if (!want.has(o.id)) continue;
    const b = pathsBounds(o.paths);
    if (b) out.push({ o, b });
  }
  return out;
}

/** Combined bounding box of several items. */
function unionBounds(items: Item[]): Bounds {
  return items.reduce(
    (acc, { b }) => ({
      minX: Math.min(acc.minX, b.minX),
      minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX),
      maxY: Math.max(acc.maxY, b.maxY),
    }),
    { ...items[0].b },
  );
}

const cx = (b: Bounds) => (b.minX + b.maxX) / 2;
const cy = (b: Bounds) => (b.minY + b.maxY) / 2;

/** How far to move an item's bounds so its `edge` matches the reference box. */
function offsetFor(b: Bounds, edge: AlignEdge, ref: Bounds): { dx: number; dy: number } {
  switch (edge) {
    case "left":
      return { dx: ref.minX - b.minX, dy: 0 };
    case "right":
      return { dx: ref.maxX - b.maxX, dy: 0 };
    case "hcenter":
      return { dx: cx(ref) - cx(b), dy: 0 };
    case "top":
      return { dx: 0, dy: ref.minY - b.minY };
    case "bottom":
      return { dx: 0, dy: ref.maxY - b.maxY };
    case "vcenter":
      return { dx: 0, dy: cy(ref) - cy(b) };
  }
}

/**
 * Align the selected objects to a shared edge. With 2+ selected the reference is
 * the selection's combined box; with exactly 1 it's the hoop (so a lone object
 * can be centered/cornered in the frame).
 */
export function alignObjects(
  objects: EmbObject[],
  ids: string[],
  edge: AlignEdge,
  hoop: Hoop,
): EmbObject[] {
  const items = selectedItems(objects, ids);
  if (items.length === 0) return objects;
  const ref: Bounds =
    items.length >= 2
      ? unionBounds(items)
      : { minX: 0, minY: 0, maxX: hoop.wMm, maxY: hoop.hMm };

  const move = new Map<string, { dx: number; dy: number }>();
  for (const it of items) move.set(it.o.id, offsetFor(it.b, edge, ref));

  return objects.map((o) => {
    const m = move.get(o.id);
    return m && (m.dx !== 0 || m.dy !== 0)
      ? shiftObject(o, m.dx, m.dy)
      : o;
  });
}

/**
 * Evenly space the centers of 3+ selected objects between the two extreme ones
 * (which stay put). Fewer than 3 selected is a no-op.
 */
export function distributeObjects(
  objects: EmbObject[],
  ids: string[],
  axis: DistributeAxis,
): EmbObject[] {
  const items = selectedItems(objects, ids);
  if (items.length < 3) return objects;
  const center = axis === "h" ? cx : cy;
  const sorted = [...items].sort((a, b) => center(a.b) - center(b.b));
  const first = center(sorted[0].b);
  const last = center(sorted[sorted.length - 1].b);
  const step = (last - first) / (sorted.length - 1);

  const move = new Map<string, { dx: number; dy: number }>();
  sorted.forEach((it, i) => {
    if (i === 0 || i === sorted.length - 1) return; // ends stay fixed
    const target = first + step * i;
    const delta = target - center(it.b);
    move.set(it.o.id, axis === "h" ? { dx: delta, dy: 0 } : { dx: 0, dy: delta });
  });

  return objects.map((o) => {
    const m = move.get(o.id);
    return m && (m.dx !== 0 || m.dy !== 0)
      ? shiftObject(o, m.dx, m.dy)
      : o;
  });
}

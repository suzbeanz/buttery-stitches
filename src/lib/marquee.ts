import type { Bounds } from "./geometry";

/**
 * Pure helpers for drag-to-select (marquee). The canvas draws a rubber-band
 * rectangle while the user drags on empty space; these functions turn that
 * rectangle into a set of selected object ids. Everything is axis-aligned in the
 * same millimeter space as object bounds, so it is fully unit-testable.
 */

/** An axis-aligned rectangle (a normalized Bounds). */
export type Rect = Bounds;

/** Build a normalized rectangle from two opposite corners (any drag direction). */
export function rectFromPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Rect {
  return {
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  };
}

/** True when the rectangle overlaps (touches or contains) the bounds. */
export function rectIntersectsBounds(rect: Rect, b: Bounds): boolean {
  return (
    rect.minX <= b.maxX &&
    b.minX <= rect.maxX &&
    rect.minY <= b.maxY &&
    b.minY <= rect.maxY
  );
}

/** Longest side of the rectangle in mm — used to tell a real drag from a click. */
export function rectSpanMm(rect: Rect): number {
  return Math.max(rect.maxX - rect.minX, rect.maxY - rect.minY);
}

/**
 * Ids of every object the marquee touches, in the given object order. Selecting
 * by *intersection* (not full containment) matches what users expect from a
 * lasso: graze an object and it's in.
 */
export function marqueeSelect(
  rect: Rect,
  objects: { id: string; b: Bounds }[],
): string[] {
  return objects.filter((o) => rectIntersectsBounds(rect, o.b)).map((o) => o.id);
}

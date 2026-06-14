/**
 * Pure alignment / snapping math, all in millimeters.
 *
 * Given the bounding box of the object being moved, a list of other objects'
 * bounds, and the hoop size, {@link snap} finds the nearest alignment candidate
 * within a threshold and returns the offset (dx, dy) needed to align to it,
 * along with the mm positions of the guide lines that became active so the UI
 * can draw them.
 *
 * No React / DOM / store / Konva dependency — plain geometry for unit testing.
 */

import type { Bounds } from "./geometry";

export interface SnapResult {
  /** mm to add to the moving object's x to align it. 0 when no x snap. */
  dx: number;
  /** mm to add to the moving object's y to align it. 0 when no y snap. */
  dy: number;
  /** mm x-positions of the vertical guide lines that became active. */
  guidesX: number[];
  /** mm y-positions of the horizontal guide lines that became active. */
  guidesY: number[];
}

export interface HoopSize {
  wMm: number;
  hMm: number;
}

/** The three reference positions along one axis of a bounding box. */
function edgesX(b: Bounds): [number, number, number] {
  return [b.minX, (b.minX + b.maxX) / 2, b.maxX];
}

function edgesY(b: Bounds): [number, number, number] {
  return [b.minY, (b.minY + b.maxY) / 2, b.maxY];
}

/**
 * Find the best single-axis snap. Tests each of the moving box's three edge
 * positions against every candidate line, picks the pair with the smallest
 * absolute gap within `threshold`, and returns the offset to apply plus the
 * candidate line position that became active. Returns null when nothing is
 * close enough.
 */
function bestAxisSnap(
  moving: [number, number, number],
  candidates: number[],
  threshold: number,
): { offset: number; guide: number } | null {
  let best: { offset: number; guide: number; dist: number } | null = null;
  for (const m of moving) {
    for (const c of candidates) {
      const offset = c - m;
      const dist = Math.abs(offset);
      if (dist > threshold) continue;
      if (!best || dist < best.dist) {
        best = { offset, guide: c, dist };
      }
    }
  }
  if (!best) return null;
  return { offset: best.offset, guide: best.guide };
}

/**
 * Compute the snap offset and active guides for a moving bounding box.
 *
 * Candidate vertical lines (x): hoop left (0), hoop center (w/2), hoop right
 * (w), and each target's left / center / right. Candidate horizontal lines (y):
 * hoop top (0), hoop center (h/2), hoop bottom (h), and each target's top /
 * center / bottom.
 *
 * The nearest candidate within `thresholdMm` to any of the moving box's own
 * edges/center wins per axis. When nothing is within threshold the axis is a
 * no-op (offset 0, no guide).
 */
export function snap(
  movingBounds: Bounds,
  targets: Bounds[],
  hoop: HoopSize,
  thresholdMm: number,
): SnapResult {
  const candX: number[] = [0, hoop.wMm / 2, hoop.wMm];
  const candY: number[] = [0, hoop.hMm / 2, hoop.hMm];
  for (const t of targets) {
    candX.push(...edgesX(t));
    candY.push(...edgesY(t));
  }

  const xSnap = bestAxisSnap(edgesX(movingBounds), candX, thresholdMm);
  const ySnap = bestAxisSnap(edgesY(movingBounds), candY, thresholdMm);

  return {
    dx: xSnap ? xSnap.offset : 0,
    dy: ySnap ? ySnap.offset : 0,
    guidesX: xSnap ? [xSnap.guide] : [],
    guidesY: ySnap ? [ySnap.guide] : [],
  };
}

import type { Path, Point } from "../../types/project";
import { distance, polylineLength } from "../geometry";
import { resampleByCount, capSegmentLength } from "./resample";

export interface SatinOptions {
  /** mm between zig-zag rows */
  density: number;
  /** mm added to the column width to compensate for fabric pull-in */
  pullComp: number;
  /** widths above this (mm) are too long for a single satin throw */
  maxWidth?: number;
}

/** Largest column width before a satin stitch should really be a fill. */
export const SATIN_MAX_WIDTH = 7;

function widen(l: Point, r: Point, by: number): [Point, Point] {
  const d = distance(l, r) || 1;
  const ux = (r.x - l.x) / d;
  const uy = (r.y - l.y) / d;
  const h = by / 2;
  return [
    { x: l.x - ux * h, y: l.y - uy * h },
    { x: r.x + ux * h, y: r.y + uy * h },
  ];
}

/**
 * Satin column: given a left/right rail pair, march along both in lock-step and
 * zig-zag across, one throw per `density` step. Pull compensation widens the
 * column; throws wider than a safe stitch length are split so no single stitch
 * is dangerously long (a long satin throw snags and loosens).
 */
export function satinColumn(
  left: Path,
  right: Path,
  { density, pullComp, maxWidth = SATIN_MAX_WIDTH }: SatinOptions,
): Path {
  if (left.length < 2 || right.length < 2) return [];

  const avgLen = (polylineLength(left) + polylineLength(right)) / 2;
  const steps = Math.max(1, Math.round(avgLen / Math.max(0.05, density)));
  const n = steps + 1;

  const lp = resampleByCount(left, n);
  const rp = resampleByCount(right, n);

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    let [l, r] = [lp[i], rp[i]];
    if (pullComp > 0) [l, r] = widen(l, r, pullComp);
    // Interleave rails: L0,R0,L1,R1,… → across throws with a short diagonal
    // advance between them.
    out.push(l, r);
  }

  // Cap throw length so very wide columns become split (running) satin.
  return capSegmentLength(out, maxWidth);
}

import type { EmbObject, Path, Point } from "../../types/project";
import { polygonArea } from "./classify";

/**
 * STACK-DON'T-CARVE — the professional layering rule for small features.
 *
 * The trace carves every feature out of its parent (the golf ball becomes a
 * HOLE in the green, the eyes become holes in the face) and sews the feature
 * into the opening. Professional designs measurably do the opposite for small
 * details: the parent fills SOLID and the detail is sewn ON TOP (the reference
 * packs show 12–17% of sewn cells covered by 2+ color blocks). Stacking has no
 * color boundary to gap when the thread pulls, tolerates registration drift,
 * and leaves the parent a simpler outline that fills with cleaner rows.
 *
 * Rule: a hole in an earlier-sewn fill is REMOVED (the fill goes solid) when
 * it is small — in absolute terms and relative to its parent — AND later-sewn
 * objects actually cover it (the hole exists because a feature was traced
 * there). A hole that shows fabric on purpose (a donut's middle after
 * background removal) has no later coverage and is kept. Two stacked layers of
 * 40wt over a small area is standard practice; the size caps keep it that way.
 */

/** Holes larger than this (mm²) are never filled — stacking a big region
 *  doubles thread over too much area. Exported so the cleanup pass's knockdown
 *  respects the same boundary and doesn't re-carve what the trace stacked. */
export const STACK_MAX_FEATURE_MM2 = 150;
/** A hole is only stacked when it is a small fraction of its parent's ink. */
const STACK_MAX_PARENT_FRACTION = 0.25;
/** Fraction of the hole's area later objects must cover for it to count as an
 *  occupied feature (vs a deliberate see-through opening). */
const STACK_MIN_OCCUPANCY = 0.7;

/** Even-odd point-in-ring. */
function inRing(p: Point, ring: Path): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function inRings(p: Point, rings: Path[]): boolean {
  let inside = false;
  for (const r of rings) if (inRing(p, r)) inside = !inside;
  return inside;
}

/** Fraction of `ring`'s interior covered by any of the `covers` objects,
 *  estimated on a coarse grid (~1mm or finer for small holes). */
function occupancy(ring: Path, covers: EmbObject[]): number {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const step = Math.max(0.4, Math.min(1, (maxX - minX) / 12, (maxY - minY) / 12));
  let inside = 0;
  let covered = 0;
  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      const p = { x, y };
      if (!inRing(p, ring)) continue;
      inside++;
      if (covers.some((o) => inRings(p, o.paths))) covered++;
    }
  }
  return inside === 0 ? 0 : covered / inside;
}

/**
 * Fill small occupied holes of earlier-sewn fills, in place. Objects arrive in
 * sew order; each fill's hole rings are tested against the objects sewn after
 * it. Returns the same array.
 */
export function stackSmallFeatures(objects: EmbObject[]): EmbObject[] {
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj.type !== "fill" || obj.params?.lineArt === true || obj.paths.length < 2) continue;
    const later = objects.slice(i + 1).filter((j) => j.type === "fill" || j.type === "satin");
    if (later.length === 0) continue;
    // The outer ring is the largest by area; every other ring is a hole.
    const areas = obj.paths.map((r) => Math.abs(polygonArea(r)));
    const outerIdx = areas.indexOf(Math.max(...areas));
    const netArea = areas[outerIdx] - areas.reduce((s, a, k) => (k === outerIdx ? s : s + a), 0);
    const keep = obj.paths.filter((ring, k) => {
      if (k === outerIdx) return true;
      const holeArea = areas[k];
      if (holeArea > STACK_MAX_FEATURE_MM2) return true;
      if (holeArea > STACK_MAX_PARENT_FRACTION * Math.max(1e-6, netArea)) return true;
      if (occupancy(ring, later) < STACK_MIN_OCCUPANCY) return true; // see-through opening
      return false; // a small occupied feature → fill solid, feature stacks on top
    });
    if (keep.length !== obj.paths.length) obj.paths = keep;
  }
  return objects;
}

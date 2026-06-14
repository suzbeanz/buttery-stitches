import type { Point } from "../../types/project";
import type { EngineStitch } from "./index";

/** A contiguous run of penetrations to draw as one polyline. */
export interface RenderSegment {
  colorId: string;
  underlay: boolean;
  points: Point[];
}

/**
 * Split a design (up to `upTo` events) into polyline segments for drawing.
 * Jumps lift the needle and break the line; color and underlay boundaries
 * start a new segment so each can be styled independently. Pure, so the
 * simulator's frame-by-frame redraw stays predictable and testable.
 */
export function designToSegments(
  design: EngineStitch[],
  upTo: number = design.length,
): RenderSegment[] {
  const segs: RenderSegment[] = [];
  let cur: RenderSegment | null = null;
  const n = Math.max(0, Math.min(upTo, design.length));

  for (let i = 0; i < n; i++) {
    const s = design[i];
    if (s.jump) {
      cur = null; // pen up — break the stroke
      continue;
    }
    if (!cur || cur.colorId !== s.colorId || cur.underlay !== !!s.underlay) {
      cur = { colorId: s.colorId, underlay: !!s.underlay, points: [] };
      segs.push(cur);
    }
    cur.points.push({ x: s.x, y: s.y });
  }
  return segs;
}

/** The needle position after `upTo` events (the last real penetration). */
export function needleAt(design: EngineStitch[], upTo: number): Point | null {
  const n = Math.max(0, Math.min(upTo, design.length));
  for (let i = n - 1; i >= 0; i--) {
    if (!design[i].jump) return { x: design[i].x, y: design[i].y };
  }
  return null;
}

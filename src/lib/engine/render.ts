import type { Point } from "../../types/project";
import type { EngineStitch } from "./index";

/** A contiguous run of penetrations to draw as one polyline. */
export interface RenderSegment {
  colorId: string;
  underlay: boolean;
  /** buried connector stitches — drawn de-emphasised like underlay. */
  travel: boolean;
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
  // `upTo` is fractional during playback — floor it so indices stay integers.
  const n = Math.max(0, Math.min(Math.floor(upTo), design.length));

  for (let i = 0; i < n; i++) {
    const s = design[i];
    if (s.jump) {
      cur = null; // pen up — break the stroke
      continue;
    }
    if (!cur || cur.colorId !== s.colorId || cur.underlay !== !!s.underlay || cur.travel !== !!s.travel) {
      cur = { colorId: s.colorId, underlay: !!s.underlay, travel: !!s.travel, points: [] };
      segs.push(cur);
    }
    cur.points.push({ x: s.x, y: s.y });
  }
  return segs;
}

/**
 * Incrementally extend a previous {@link designToSegments} result to a larger
 * `upTo` — the playback fast-path. The simulator advances `upTo` every animation
 * frame; re-walking the whole design from 0 allocated a fresh segment list per
 * frame (O(n) per frame, O(n²) per playback, GC churn at 50k+ stitches).
 *
 * MUTATES `prev.segs` (appends points/segments in place) and returns it — the
 * caller owns the cache and must rebuild via designToSegments whenever the
 * design changes or `upTo` moves backwards (scrubbing left). Equivalence with a
 * fresh full walk is pinned by tests.
 */
export function extendSegments(
  design: EngineStitch[],
  prev: { upTo: number; segs: RenderSegment[] },
  upTo: number,
): { upTo: number; segs: RenderSegment[] } {
  const from = Math.max(0, Math.min(Math.floor(prev.upTo), design.length));
  const n = Math.max(0, Math.min(Math.floor(upTo), design.length));
  const segs = prev.segs;
  // Resume state: the open segment is the last one, unless the boundary event
  // (a jump) closed it — replaying design[from-1] tells us which.
  let cur: RenderSegment | null = segs.length > 0 ? segs[segs.length - 1] : null;
  if (from > 0 && design[from - 1]?.jump) cur = null;
  for (let i = from; i < n; i++) {
    const s = design[i];
    if (s.jump) {
      cur = null;
      continue;
    }
    if (!cur || cur.colorId !== s.colorId || cur.underlay !== !!s.underlay || cur.travel !== !!s.travel) {
      cur = { colorId: s.colorId, underlay: !!s.underlay, travel: !!s.travel, points: [] };
      segs.push(cur);
    }
    cur.points.push({ x: s.x, y: s.y });
  }
  prev.upTo = n;
  return prev;
}

/** The needle position after `upTo` events (the last real penetration). */
export function needleAt(design: EngineStitch[], upTo: number): Point | null {
  // Floor `upTo` (fractional during playback) so `i` is always an integer index;
  // design[fractional] is undefined and would throw on `.jump`.
  const n = Math.max(0, Math.min(Math.floor(upTo), design.length));
  for (let i = n - 1; i >= 0; i--) {
    if (!design[i].jump) return { x: design[i].x, y: design[i].y };
  }
  return null;
}

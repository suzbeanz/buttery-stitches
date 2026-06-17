import type { Path, Point } from "../../types/project";
import { polygonArea, polygonPerimeter } from "../trace/classify";

/**
 * Which stitch a closed region wants — the core digitizer decision
 * (docs/stitch-logic.md §2). Driven by the region's mean STROKE width, computed
 * holes-aware so a ring like the letter "o" reads as its band width (a thin
 * stroke → satin), not the diameter of its outer circle (which would look broad).
 *
 *   width < runningMax            → running (a hairline / single line)
 *   runningMax ≤ width ≤ satinMax → satin   (a stroke to lay shiny columns down)
 *   width > satinMax              → tatami  (a broad area to fill)
 *
 * Mean width alone is fooled by a crinkly boundary: a big blob with a frilly
 * outline (traced fur, foliage) has a huge perimeter, so 2·area/perimeter comes
 * out tiny and the blob masquerades as a thin stroke. We guard with the region's
 * largest INSCRIBED thickness — a true stroke/ring is thin everywhere, a blob is
 * locally fat — so broad areas stay tatami no matter how frilly their edge.
 *
 * This is the coarse call; the engine's medial-axis + coverage check makes the
 * final satin-vs-tatami decision per region.
 */
export type StitchKind = "running" | "satin" | "tatami";

export interface ClassifyOptions {
  /** below this mean width (mm) a region is a hairline → running. */
  runningMaxWidthMm?: number;
  /** above this mean width (mm) a region is broad → tatami. */
  satinMaxWidthMm?: number;
}

/** Mean stroke width (mm) of a region: 2·netArea / totalPerimeter, holes-aware. */
export function meanStrokeWidthMm(rings: Path[]): number {
  const usable = rings.filter((r) => r.length >= 3);
  if (usable.length === 0) return 0;
  const outer = usable[0];
  const holes = usable.slice(1);
  const netArea =
    polygonArea(outer) - holes.reduce((s, h) => s + polygonArea(h), 0);
  const totalPer =
    polygonPerimeter(outer) + holes.reduce((s, h) => s + polygonPerimeter(h), 0);
  if (totalPer <= 0 || netArea <= 0) return 0;
  return (2 * netArea) / totalPer;
}

/** Even-odd point-in-region test over a region's rings (outer + holes). */
function pointInRings(p: Point, rings: Path[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Squared distance from point p to segment a→b. */
function distSqToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + t * dx - p.x;
  const cy = a.y + t * dy - p.y;
  return cx * cx + cy * cy;
}

/**
 * True if the region holds an inscribed circle of radius > `radiusMm` anywhere —
 * i.e. it is locally thicker than `2·radiusMm`. Samples a grid finer than the
 * threshold so even a thin band gets interior samples, and bails the instant a
 * fat point is found (a broad blob exits almost immediately).
 */
function isLocallyThicker(rings: Path[], radiusMm: number): boolean {
  const outer = rings.find((r) => r.length >= 3);
  if (!outer) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const usable = rings.filter((r) => r.length >= 3);
  const step = Math.max(0.4, radiusMm * 0.7); // sample finer than the threshold
  const r2 = radiusMm * radiusMm;
  for (let y = minY + step / 2; y <= maxY; y += step) {
    for (let x = minX + step / 2; x <= maxX; x += step) {
      const p = { x, y };
      if (!pointInRings(p, usable)) continue;
      let near = Infinity;
      for (const ring of usable) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const d = distSqToSeg(p, ring[i], ring[j]);
          if (d < near) near = d;
        }
        if (near <= r2) break; // this point is close to an edge; not fat here
      }
      if (near > r2) return true; // an inscribed circle bigger than radiusMm fits
    }
  }
  return false;
}

export function classifyRegion(rings: Path[], opts: ClassifyOptions = {}): StitchKind {
  const runningMax = opts.runningMaxWidthMm ?? 1.2;
  const satinMax = opts.satinMaxWidthMm ?? 7;
  const width = meanStrokeWidthMm(rings);
  if (width <= 0) return "tatami";
  // A frilly-edged blob has a tiny mean width but is fat inside — a broad fill,
  // not a stroke. If it holds an inscribed circle wider than the satin cap, it's
  // tatami regardless of what the perimeter-derived width claims.
  if (isLocallyThicker(rings, satinMax / 2)) return "tatami";
  if (width < runningMax) return "running";
  if (width <= satinMax) return "satin";
  return "tatami";
}

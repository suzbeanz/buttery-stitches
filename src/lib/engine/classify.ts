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
 * True if the region is BROADLY thick — a large fraction of its interior holds an
 * inscribed circle bigger than `2·radiusMm` — i.e. a fat blob, not a stroke. We
 * measure the FRACTION of interior area that is fat rather than bailing on the
 * first fat point: a thin branched stroke (a mast meeting its boom, the bar of a
 * "t") has one chunky junction but is thin nearly everywhere, so it stays a stroke
 * and is satined, while a frilly-edged blob — fat almost everywhere despite a tiny
 * perimeter-derived mean width — is correctly caught as tatami.
 */
export function isBroadlyThick(rings: Path[], radiusMm: number): boolean {
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
  let inside = 0;
  let fat = 0;
  for (let y = minY + step / 2; y <= maxY; y += step) {
    for (let x = minX + step / 2; x <= maxX; x += step) {
      const p = { x, y };
      if (!pointInRings(p, usable)) continue;
      inside++;
      let near = Infinity;
      for (const ring of usable) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const d = distSqToSeg(p, ring[i], ring[j]);
          if (d < near) near = d;
        }
        if (near <= r2) break; // close to an edge; not fat here
      }
      if (near > r2) fat++;
    }
  }
  // A stroke is thin nearly everywhere — even a branched one is only fat at a
  // junction (a few % of its area); a holey/frilly blob is fat across a big chunk
  // of its body. Measured fat fractions: a mast+boom ~0.03, a fur-like holey blob
  // ~0.23, a solid disc ~0.68 — so ~0.15 separates strokes from fills with margin.
  return inside > 0 && fat / inside >= 0.15;
}

/** Largest a small round feature (a dot, an eye, a golf ball) may be and still
 *  sew SMOOTH as a single satin block — tatami at this size is short, jagged rows. */
export const ROUND_DOT_MAX_MM = 8;

/**
 * Is this region a small, compact, roundish blob — a golf ball, an eye, a polka
 * dot — that reads far smoother as one satin block than as rough little tatami
 * rows? It must be a SINGLE simple ring (no holes/islands), no bigger than
 * {@link ROUND_DOT_MAX_MM}, roughly as wide as it is tall, and genuinely filled
 * (not a thin frame or sliver). Used by `fix` to pick satin and by the engine to
 * lay the block.
 */
export function isSmallRoundFill(rings: Path[]): boolean {
  const usable = rings.filter((r) => r.length >= 3);
  if (usable.length !== 1) return false;
  const ring = usable[0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const maxDim = Math.max(w, h);
  const minDim = Math.min(w, h);
  if (maxDim > ROUND_DOT_MAX_MM || minDim < 2) return false; // too big, or a sliver
  if (minDim / maxDim < 0.6) return false; // elongated → satin its medial, not a block
  // Compact: it fills its bounding box like a disc/blob, not a thin ring or cross.
  return Math.abs(polygonArea(ring)) / (w * h) >= 0.5;
}

export function classifyRegion(rings: Path[], opts: ClassifyOptions = {}): StitchKind {
  const runningMax = opts.runningMaxWidthMm ?? 1.2;
  const satinMax = opts.satinMaxWidthMm ?? 7;
  const width = meanStrokeWidthMm(rings);
  if (width <= 0) return "tatami";
  // A frilly-edged blob has a tiny mean width but is fat inside — a broad fill,
  // not a stroke. If it holds an inscribed circle wider than the satin cap, it's
  // tatami regardless of what the perimeter-derived width claims.
  if (isBroadlyThick(rings, satinMax / 2)) return "tatami";
  if (width < runningMax) return "running";
  if (width <= satinMax) return "satin";
  return "tatami";
}

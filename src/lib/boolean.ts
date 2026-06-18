import type { Path, Point } from "../types/project";
import { marchingSquares, simplify } from "./paintbucket";

/**
 * Boolean operations on polygon sets (union / intersect / subtract) — the
 * foundation for building a logo from primitives, and reused by appliqué and
 * relief carving.
 *
 * We do it on a raster, like the paint bucket: rasterize each operand's filled
 * interior (even-odd over its rings, so holes cut), combine the two masks with
 * the boolean operator, then trace the result back to polygons with marching
 * squares and simplify. This is fully robust — no fragile planar-map / shared-
 * edge / collinear degenerate cases that sink an exact polygon clipper — and at a
 * fine cell it's well within embroidery tolerance (stitches are ~0.4 mm). Pure
 * and deterministic: same shapes in, same rings out, every time.
 */

export type BoolOp = "union" | "intersect" | "subtract";

const MAX_CELLS = 6_000_000;

/** Even-odd test: is `p` inside the area bounded by `rings` (outer + holes)? */
function inside(p: Point, rings: Path[]): boolean {
  let on = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        on = !on;
      }
    }
  }
  return on;
}

function bounds(paths: Path[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of paths) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Polygon area (shoelace), absolute value. */
function area(ring: Path): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return Math.abs(s) / 2;
}

/**
 * Combine two polygon sets (each a list of rings, outer + holes) with `op`.
 * Returns the result as rings (outer + holes), in mm — ready to drop onto a fill
 * object (which fills with the even-odd / nonzero rule, so holes cut correctly).
 */
export function booleanOp(a: Path[], b: Path[], op: BoolOp, cellMm = 0.2): Path[] {
  const cell = Math.max(0.08, cellMm);
  // For subtract the result lives inside A; otherwise span both operands.
  const bb = op === "subtract" ? bounds(a) : bounds([...a, ...b]);
  if (!bb) return [];
  const pad = 2;
  const W = Math.max(3, Math.ceil((bb.maxX - bb.minX) / cell) + pad * 2 + 1);
  const H = Math.max(3, Math.ceil((bb.maxY - bb.minY) / cell) + pad * 2 + 1);
  if (W * H > MAX_CELLS) return [];
  const ox = bb.minX - pad * cell;
  const oy = bb.minY - pad * cell;

  const mask = new Uint8Array(W * H);
  let any = false;
  for (let gy = 0; gy < H; gy++) {
    const py = oy + gy * cell;
    for (let gx = 0; gx < W; gx++) {
      const p = { x: ox + gx * cell, y: py };
      const inA = inside(p, a);
      const inB = inside(p, b);
      const hit = op === "union" ? inA || inB : op === "intersect" ? inA && inB : inA && !inB;
      if (hit) {
        mask[gy * W + gx] = 1;
        any = true;
      }
    }
  }
  if (!any) return [];

  // Trace the result mask, convert to mm, simplify (drop the raster stair-steps,
  // keep corners), and drop specks.
  const minArea = Math.max(1, (3 * cell) ** 2);
  return marchingSquares(mask, W, H)
    .map((ring) => simplify(ring.map((q) => ({ x: ox + q.x * cell, y: oy + q.y * cell })), cell * 0.9))
    .filter((r) => r.length >= 3 && area(r) >= minArea);
}

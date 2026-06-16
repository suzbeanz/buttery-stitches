import type { Path, Point } from "../types/project";

/**
 * Paint-bucket fill. Given the outlines already on the canvas and a click point,
 * find the connected area that contains the click (bounded by those outlines and
 * the working area), and return its boundary as clean fill rings.
 *
 * It works on a raster so it's robust to any tangle of overlapping lines (no
 * fragile planar-map math): rasterize the outlines as barriers, flood-fill from
 * the click across open cells, then trace the filled mask's boundary with
 * marching squares and simplify it into smooth polygons. Pure + unit-testable.
 */

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const MAX_CELLS = 4_000_000;

/** Fill the region containing `at`, bounded by `outlines` and `bounds`. Returns
 *  the region's rings (mm), or null if the click is on a line or the region is
 *  too small to be meaningful. */
export function bucketFill(
  outlines: Path[],
  at: Point,
  bounds: Bounds,
  cellMm = 0.4,
): Path[] | null {
  const cell = Math.max(0.1, cellMm);
  const W = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / cell) + 1);
  const H = Math.max(2, Math.ceil((bounds.maxY - bounds.minY) / cell) + 1);
  if (W * H > MAX_CELLS) return null;

  const gx = (x: number) => (x - bounds.minX) / cell;
  const gy = (y: number) => (y - bounds.minY) / cell;
  const inGrid = (i: number, j: number) => i >= 0 && i < W && j >= 0 && j < H;
  const at1 = (i: number, j: number) => j * W + i;

  // 1. Rasterize every outline segment as a barrier (a 1-cell-thick wall).
  const barrier = new Uint8Array(W * H);
  const mark = (i: number, j: number) => {
    if (inGrid(i, j)) barrier[at1(i, j)] = 1;
  };
  for (const ring of outlines) {
    for (let k = 0; k < ring.length - 1; k++) {
      rasterizeSegment(gx(ring[k].x), gy(ring[k].y), gx(ring[k + 1].x), gy(ring[k + 1].y), mark);
    }
  }

  // 2. Flood-fill from the click across non-barrier cells (4-connected).
  const si = Math.round(gx(at.x));
  const sj = Math.round(gy(at.y));
  if (!inGrid(si, sj) || barrier[at1(si, sj)]) return null;
  const fill = new Uint8Array(W * H);
  const stack = [at1(si, sj)];
  fill[at1(si, sj)] = 1;
  let count = 0;
  while (stack.length) {
    const c = stack.pop()!;
    count++;
    const i = c % W;
    const j = (c - i) / W;
    const push = (ni: number, nj: number) => {
      if (inGrid(ni, nj)) {
        const n = at1(ni, nj);
        if (!fill[n] && !barrier[n]) {
          fill[n] = 1;
          stack.push(n);
        }
      }
    };
    push(i - 1, j);
    push(i + 1, j);
    push(i, j - 1);
    push(i, j + 1);
  }
  if (count < 4) return null;

  // 3. Trace the filled mask boundary, convert to mm, simplify.
  const rings = marchingSquares(fill, W, H).map((ring) =>
    simplify(
      ring.map((p) => ({ x: bounds.minX + p.x * cell, y: bounds.minY + p.y * cell })),
      cell * 0.9,
    ),
  );
  return rings.filter((r) => r.length >= 3);
}

/** Mark every cell a grid-space segment passes through (DDA), 1-cell thick. */
function rasterizeSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mark: (i: number, j: number) => void,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const i = Math.round(x0 + dx * t);
    const j = Math.round(y0 + dy * t);
    mark(i, j);
  }
}

/**
 * Binary marching squares: trace the boundary between filled (1) and empty (0)
 * cells in `mask` (W×H) at the 0.5 iso-level. Returns closed rings in grid
 * coordinates (edge-midpoint resolution). Handles holes (returns a ring each).
 */
function marchingSquares(mask: Uint8Array, W: number, H: number): Path[] {
  const at1 = (i: number, j: number) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : mask[j * W + i]);
  const key = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
  // Each segment connects two edge-midpoints; build an adjacency map for chaining.
  const next = new Map<string, Point>();
  const start = new Map<string, Point>();
  const addSeg = (a: Point, b: Point) => {
    next.set(key(a.x, a.y), b);
    start.set(key(a.x, a.y), a);
  };
  for (let j = -1; j < H; j++) {
    for (let i = -1; i < W; i++) {
      const tl = at1(i, j);
      const tr = at1(i + 1, j);
      const br = at1(i + 1, j + 1);
      const bl = at1(i, j + 1);
      const code = tl | (tr << 1) | (br << 2) | (bl << 3);
      const top: Point = { x: i + 0.5, y: j };
      const right: Point = { x: i + 1, y: j + 0.5 };
      const bottom: Point = { x: i + 0.5, y: j + 1 };
      const left: Point = { x: i, y: j + 0.5 };
      // Oriented so the filled region stays on a consistent side (CW rings).
      switch (code) {
        case 1: addSeg(left, top); break;
        case 2: addSeg(top, right); break;
        case 3: addSeg(left, right); break;
        case 4: addSeg(right, bottom); break;
        case 5: addSeg(left, bottom); addSeg(right, top); break;
        case 6: addSeg(top, bottom); break;
        case 7: addSeg(left, bottom); break;
        case 8: addSeg(bottom, left); break;
        case 9: addSeg(bottom, top); break;
        case 10: addSeg(top, left); addSeg(bottom, right); break;
        case 11: addSeg(bottom, right); break;
        case 12: addSeg(right, left); break;
        case 13: addSeg(right, top); break;
        case 14: addSeg(top, left); break;
        default: break; // 0 and 15: no boundary
      }
    }
  }
  // Chain segments into closed rings.
  const rings: Path[] = [];
  const visited = new Set<string>();
  for (const startKey of next.keys()) {
    if (visited.has(startKey)) continue;
    const ring: Path = [];
    let k: string | undefined = startKey;
    let guard = 0;
    while (k && !visited.has(k) && guard++ < next.size + 1) {
      visited.add(k);
      const a = start.get(k)!;
      ring.push({ x: a.x, y: a.y });
      const b = next.get(k);
      if (!b) break;
      k = key(b.x, b.y);
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Douglas–Peucker simplification (keeps the ring's shape, drops stair-steps). */
function simplify(points: Path, epsilon: number): Path {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistance(points[i], points[lo], points[hi]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

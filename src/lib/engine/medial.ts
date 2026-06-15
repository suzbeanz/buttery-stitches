import type { Path, Point } from "../../types/project";
import { orientByDepth } from "./fill";
import { satinColumn } from "./satin";
import { polylineLength } from "../geometry";
import { douglasPeucker } from "../trace/simplify";
import { smoothPath } from "../smooth";

/**
 * Auto-satin via the medial axis. Real embroidery lettering is satin columns that
 * follow each stroke's centerline — so we rasterize a fill region, distance
 * transform it, thin it to a one-pixel skeleton, then lay a variable-width satin
 * column down each skeleton branch (width sampled from the distance transform).
 * This gives smooth, shiny strokes that follow curves, unlike a fixed-angle fill.
 *
 * Pure (operates on a grid built from the polygon) and unit-testable. Returns one
 * run of penetrations per branch; the caller jumps between them.
 */

interface Grid {
  w: number;
  h: number;
  cellMm: number;
  ox: number; // mm x of cell (0,0) center
  oy: number;
  cells: Uint8Array; // 1 = inside the region
}

/** Winding number of `p` w.r.t. the oriented rings (non-zero = inside). */
function inside(px: number, py: number, rings: Path[]): boolean {
  let w = 0;
  for (const ring of rings) {
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % m];
      if (a.y <= py) {
        if (b.y > py && (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x) > 0) w++;
      } else if (b.y <= py && (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x) < 0) {
        w--;
      }
    }
  }
  return w !== 0;
}

function rasterize(rings: Path[], cellMm: number): Grid | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings)
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  if (!Number.isFinite(minX)) return null;

  const pad = 2;
  const w = Math.ceil((maxX - minX) / cellMm) + pad * 2 + 1;
  const h = Math.ceil((maxY - minY) / cellMm) + pad * 2 + 1;
  if (w < 3 || h < 3 || w * h > 4_000_000) return null;
  const ox = minX - pad * cellMm;
  const oy = minY - pad * cellMm;

  const cells = new Uint8Array(w * h);
  for (let gy = 0; gy < h; gy++) {
    const py = oy + gy * cellMm;
    for (let gx = 0; gx < w; gx++) {
      const px = ox + gx * cellMm;
      if (inside(px, py, rings)) cells[gy * w + gx] = 1;
    }
  }
  return { w, h, cellMm, ox, oy, cells };
}

/** Chamfer distance transform (3,4) in cell units; 0 outside. */
function distanceTransform(g: Grid): Float32Array {
  const { w, h, cells } = g;
  const dt = new Float32Array(w * h);
  const BIG = 1e6;
  for (let i = 0; i < w * h; i++) dt[i] = cells[i] ? BIG : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : dt[y * w + x]);
  // forward
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!cells[y * w + x]) continue;
      let v = dt[y * w + x];
      v = Math.min(v, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
      dt[y * w + x] = v;
    }
  // backward
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      if (!cells[y * w + x]) continue;
      let v = dt[y * w + x];
      v = Math.min(v, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
      dt[y * w + x] = v;
    }
  for (let i = 0; i < w * h; i++) dt[i] /= 3; // normalize so orthogonal step = 1
  return dt;
}

/** Zhang–Suen thinning to a 1-cell skeleton. */
function thin(g: Grid): Uint8Array {
  const { w, h } = g;
  const s = g.cells.slice();
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : s[y * w + x]);
  let changed = true;
  const toClear: number[] = [];
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      toClear.length = 0;
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          if (!s[y * w + x]) continue;
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y),
            p5 = at(x + 1, y + 1), p6 = at(x, y + 1), p7 = at(x - 1, y + 1),
            p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
          const nb = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (nb < 2 || nb > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let trans = 0;
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) trans++;
          if (trans !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          toClear.push(y * w + x);
        }
      if (toClear.length) {
        changed = true;
        for (const idx of toClear) s[idx] = 0;
      }
    }
  }
  return s;
}

/** Trace a skeleton into polylines of cell coords, split at junctions. */
function traceSkeleton(skel: Uint8Array, w: number, h: number): [number, number][][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : skel[y * w + x]);
  const deg = (x: number, y: number) => {
    let d = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(x + dx, y + dy)) d++;
    return d;
  };
  const visited = new Uint8Array(w * h);
  const lines: [number, number][][] = [];

  const walk = (sx: number, sy: number) => {
    let x = sx, y = sy;
    const line: [number, number][] = [[x, y]];
    visited[y * w + x] = 1;
    for (;;) {
      let nx = -1, ny = -1;
      for (let dy = -1; dy <= 1 && nx < 0; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const cx = x + dx, cy = y + dy;
          if (at(cx, cy) && !visited[cy * w + cx]) { nx = cx; ny = cy; break; }
        }
      if (nx < 0) break;
      visited[ny * w + nx] = 1;
      line.push([nx, ny]);
      x = nx; y = ny;
      if (deg(x, y) > 2) break; // stop at a junction
    }
    if (line.length >= 2) lines.push(line);
  };

  // Start from endpoints/junctions first, then any leftover loops.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (skel[y * w + x] && !visited[y * w + x]) {
        const d = deg(x, y);
        if (d === 1 || d > 2) walk(x, y);
      }
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (skel[y * w + x] && !visited[y * w + x]) walk(x, y);

  return lines;
}

/** Unit normal at point i of a centerline (average of adjacent segment normals). */
function normalAt(line: Point[], i: number): Point {
  const prev = i > 0 ? line[i - 1] : line[i];
  const next = i < line.length - 1 ? line[i + 1] : line[i];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

export interface MedialOptions {
  density: number;
  /** grid cell size in mm (default 0.5). */
  cellMm?: number;
}

/**
 * Build satin columns down the medial axis of a fill region. Returns one run of
 * penetrations per skeleton branch, or `[]` if the region is too small/degenerate
 * to skeletonize (the caller then falls back to a column fill).
 */
export function medialSatin(rings: Path[], opts: MedialOptions): Path[] {
  const cellMm = opts.cellMm ?? 0.5;
  const oriented = orientByDepth(rings);
  const grid = rasterize(oriented, cellMm);
  if (!grid) return [];

  const dt = distanceTransform(grid);
  const skel = thin(grid);
  const branches = traceSkeleton(skel, grid.w, grid.h);

  const runs: Path[] = [];
  for (const branch of branches) {
    if (branch.length < 2) continue;
    // Raw centerline in mm from the skeleton cells.
    const raw: Point[] = branch.map(([gx, gy]) => ({
      x: grid.ox + gx * cellMm,
      y: grid.oy + gy * cellMm,
    }));
    // Prune thinning spurs — tiny branches that aren't real strokes.
    if (polylineLength(raw) < 1.5) continue;

    // Consistent column width: the median half-width along the branch, so the
    // satin reads as an even, deliberate column instead of wobbling per pixel.
    const halves = branch
      .map(([gx, gy]) => Math.max(cellMm, dt[gy * grid.w + gx] * cellMm))
      .sort((a, b) => a - b);
    const half = halves[halves.length >> 1];

    // Clean the centerline: drop the pixel staircase, then smooth it.
    const center = smoothPath(douglasPeucker(raw, cellMm * 1.2), { maxSegmentMm: 0.8 });
    if (center.length < 2) continue;

    const left: Point[] = [];
    const right: Point[] = [];
    for (let i = 0; i < center.length; i++) {
      const n = normalAt(center, i);
      left.push({ x: center[i].x + n.x * half, y: center[i].y + n.y * half });
      right.push({ x: center[i].x - n.x * half, y: center[i].y - n.y * half });
    }
    const pts = satinColumn(left, right, { density: opts.density, pullComp: 0 });
    if (pts.length >= 2) runs.push(pts);
  }
  return runs;
}

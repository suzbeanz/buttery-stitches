import type { Path, Point } from "../../types/project";
import { orientByDepth } from "./fill";
import { rasterize, distanceTransform, type Grid } from "./medial";
import { resampleByDistance } from "./resample";

/**
 * Contour ("echo") fill: instead of straight parallel rows, lay rings that ECHO
 * the shape's own outline, marching inward. On an organic form — a leaf, a petal,
 * a paisley — this flows with the silhouette and reads far richer than a flat
 * tatami (docs/stitch-logic.md §7).
 *
 * The rings are iso-distance contours of the region's distance transform, so they
 * stay evenly spaced, never self-intersect (the failure mode of naive polygon
 * offsetting on a concave shape), and handle holes for free (distance is measured
 * to the nearest boundary, inner or outer). Pure and unit-testable.
 */

const DEFAULT_CELL_MM = 0.3;
const DEFAULT_STITCH_MM = 3;

export interface ContourOptions {
  /** mm between successive rings (the fill density). */
  density: number;
  /** mm between penetrations along a ring (default 3). */
  stitchLength?: number;
  /** grid cell size in mm (default 0.3); finer = smoother rings. */
  cellMm?: number;
}

/** Marching-squares edge-pair table, corners TL,TR,BR,BL; edges T,R,B,L = 0..3. */
const EDGE_TABLE: number[][][] = [
  [], [[3, 0]], [[0, 1]], [[3, 1]],
  [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]],
  [[2, 3]], [[2, 0]], [[0, 1], [2, 3]], [[2, 1]],
  [[1, 3]], [[1, 0]], [[0, 3]], [],
];

/** Trace the iso-contour of field `f` at `level` into closed mm polylines. */
function isoContours(
  f: (gx: number, gy: number) => number,
  w: number,
  h: number,
  level: number,
  ptAt: (gx: number, gy: number) => Point,
): Path[] {
  const segs: [Point, Point][] = [];
  // Crossing point on an edge of cell (x,y); edge 0=T,1=R,2=B,3=L.
  const corners = (x: number, y: number) => [
    [x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1],
  ];
  const edgePoint = (x: number, y: number, edge: number): Point => {
    const c = corners(x, y);
    const [a, b] = [
      [c[0], c[1]], // T
      [c[1], c[2]], // R
      [c[2], c[3]], // B
      [c[3], c[0]], // L
    ][edge];
    const va = f(a[0], a[1]);
    const vb = f(b[0], b[1]);
    const denom = vb - va;
    const t = Math.abs(denom) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, (level - va) / denom));
    const pa = ptAt(a[0], a[1]);
    const pb = ptAt(b[0], b[1]);
    return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
  };

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const idx =
        (f(x, y) >= level ? 1 : 0) |
        (f(x + 1, y) >= level ? 2 : 0) |
        (f(x + 1, y + 1) >= level ? 4 : 0) |
        (f(x, y + 1) >= level ? 8 : 0);
      for (const [ea, eb] of EDGE_TABLE[idx]) {
        segs.push([edgePoint(x, y, ea), edgePoint(x, y, eb)]);
      }
    }
  }
  return chainSegments(segs, DEFAULT_CELL_MM * 0.25);
}

/** Stitch undirected segments into polylines by matching shared endpoints. */
function chainSegments(segs: [Point, Point][], q: number): Path[] {
  const key = (p: Point) => `${Math.round(p.x / q)},${Math.round(p.y / q)}`;
  const adj = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      (adj.get(k) ?? adj.set(k, []).get(k)!).push(i);
    }
  });
  const used = new Array(segs.length).fill(false);
  const out: Path[] = [];

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const line: Point[] = [segs[i][0], segs[i][1]];
    // Extend forward from the tail until we can't (or we loop back).
    for (;;) {
      const tail = line[line.length - 1];
      const cands = adj.get(key(tail)) ?? [];
      const next = cands.find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = true;
      const [a, b] = segs[next];
      line.push(key(a) === key(tail) ? b : a);
    }
    if (line.length >= 3) out.push(line);
  }
  return out;
}

/**
 * Build echo-fill rings for a region. Returns one penetration run per ring,
 * outermost first; `[]` if the shape is too thin to hold even one ring (the
 * caller then falls back to a tatami fill).
 */
export function contourFill(rings: Path[], opts: ContourOptions): Path[] {
  const oriented = orientByDepth(rings);
  if (oriented.length === 0 || oriented[0].length < 3) return [];
  const cellMm = opts.cellMm ?? DEFAULT_CELL_MM;
  const density = Math.max(0.2, opts.density);
  const stitch = opts.stitchLength ?? DEFAULT_STITCH_MM;

  const grid: Grid | null = rasterize(oriented, cellMm);
  if (!grid) return [];
  const dt = distanceTransform(grid); // cell units
  const { w, h } = grid;
  const fieldMm = (gx: number, gy: number) => dt[gy * w + gx] * cellMm;
  const ptAt = (gx: number, gy: number): Point => ({
    x: grid.ox + gx * cellMm,
    y: grid.oy + gy * cellMm,
  });

  let maxMm = 0;
  for (let i = 0; i < dt.length; i++) maxMm = Math.max(maxMm, dt[i] * cellMm);
  if (maxMm < density) return [];

  const runs: Path[] = [];
  // Rings every `density` mm in from the edge (the first sits half a row in).
  for (let level = density * 0.6; level < maxMm; level += density) {
    for (const loop of isoContours(fieldMm, w, h, level, ptAt)) {
      // Close the ring, then resample to the stitch length along it.
      const closed = [...loop, loop[0]];
      const run = resampleByDistance(closed, stitch);
      if (run.length >= 3) runs.push(run);
    }
  }
  return runs;
}

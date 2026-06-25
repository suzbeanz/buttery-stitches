import type { Path, Point } from "../../types/project";
import { orientByDepth, MIN_FILL_DENSITY } from "./fill";
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

const DEFAULT_CELL_MM = 0.2;
const DEFAULT_STITCH_MM = 3;
/** Ring step as a fraction of density. Rings nominally one density apart would JUST
 *  touch a same-width thread — but the distance-transform raster jitters ring radii
 *  by ~a cell, so any drift opens a gap. Stepping a touch tighter gives the margin
 *  that keeps a contour fill covered; with the finer 0.2mm cell a 0.9 margin suffices (disc-contour 94.2% → 96.2% at ~+2% stitches). */
const CONTOUR_STEP_FRAC = 0.9;

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
  // Adaptive grid: a fixed 0.3 mm cell makes a big (100 mm+) region a 400×400+
  // grid that's rasterized AND distance-transformed AND marched per level — slow,
  // and twice over (the underlay contours too). Coarsen the cell with the region's
  // size so a large band stays interactive while small lettering keeps fine cells.
  let cellMm = opts.cellMm;
  if (cellMm === undefined) {
    let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
    for (const p of oriented[0]) {
      if (p.x < mnX) mnX = p.x;
      if (p.y < mnY) mnY = p.y;
      if (p.x > mxX) mxX = p.x;
      if (p.y > mxY) mxY = p.y;
    }
    const maxDim = Math.max(mxX - mnX, mxY - mnY);
    cellMm = Math.max(DEFAULT_CELL_MM, Math.min(0.6, maxDim / 220));
  }
  const density = Math.max(MIN_FILL_DENSITY, opts.density);
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
  // Gather every contour loop with its depth level (outer loops first). Skip
  // pinhead loops (the field's local maxima collapse to a point at the medial
  // axis) — they add no coverage but, as their own 2–3 stitch run, force a trim.
  const minPerim = Math.max(3, density * 4);
  const perim = (pts: Point[]): number => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return s;
  };
  const loops: { level: number; pts: Point[] }[] = [];
  for (let level = density * 0.6; level < maxMm; level += density * CONTOUR_STEP_FRAC) {
    for (const loop of isoContours(fieldMm, w, h, level, ptAt)) {
      if (loop.length >= 3 && perim(loop) >= minPerim) loops.push({ level, pts: loop });
    }
  }
  if (loops.length === 0) return [];

  // A contour loop is a CYCLE, so it can start anywhere — and a band (an annulus,
  // a ring of text) has TWO loops per distance level (one each side of the
  // midline), so sorting by level alone interleaves the two sides and every loop
  // hops across the band. Instead, chain the loops by spatial nearest-neighbour
  // from the outermost one: that walks edge → midline → opposite edge as one
  // near-spiral, so consecutive rings sit ~one density apart and connect with a
  // tiny hidden step instead of a trimmed jump across the shape.
  const cx = loops.reduce((s, l) => s + l.pts[0].x, 0) / loops.length;
  const cy = loops.reduce((s, l) => s + l.pts[0].y, 0) / loops.length;
  const centroidOf = (pts: Point[]): Point => {
    let x = 0;
    let y = 0;
    for (const p of pts) {
      x += p.x;
      y += p.y;
    }
    return { x: x / pts.length, y: y / pts.length };
  };
  // Seed with the loop whose centroid is farthest from the shape's centre — the
  // outermost ring — so the spiral runs outside-in.
  const cents = loops.map((l) => centroidOf(l.pts));
  const used = new Array(loops.length).fill(false);
  let curIdx = 0;
  let farthest = -1;
  for (let i = 0; i < loops.length; i++) {
    const d = (cents[i].x - cx) ** 2 + (cents[i].y - cy) ** 2;
    if (d > farthest) {
      farthest = d;
      curIdx = i;
    }
  }

  let cursor: Point | null = null;
  for (let n = 0; n < loops.length; n++) {
    if (n > 0) {
      // Pick the nearest unused loop (by closest vertex to the cursor).
      let best = Infinity;
      let bestI = -1;
      for (let i = 0; i < loops.length; i++) {
        if (used[i]) continue;
        for (const p of loops[i].pts) {
          const d = (p.x - cursor!.x) ** 2 + (p.y - cursor!.y) ** 2;
          if (d < best) {
            best = d;
            bestI = i;
          }
        }
      }
      curIdx = bestI;
    }
    used[curIdx] = true;
    const pts = loops[curIdx].pts;
    // Rotate the loop to BEGIN at the point nearest the cursor (tiny step in).
    let startIdx = 0;
    if (cursor) {
      let best = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].x - cursor.x;
        const dy = pts[i].y - cursor.y;
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          startIdx = i;
        }
      }
    }
    const rotated = startIdx === 0 ? pts : [...pts.slice(startIdx), ...pts.slice(0, startIdx)];
    const closed = [...rotated, rotated[0]];
    const run = resampleByDistance(closed, stitch);
    if (run.length >= 3) {
      runs.push(run);
      cursor = run[run.length - 1]; // ≈ the loop's start, where the needle ends up
    }
  }
  return runs;
}

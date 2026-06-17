import type { Path, Point } from "../../types/project";
import { orientByDepth } from "./fill";
import { polylineLength } from "../geometry";
import { polygonArea } from "../trace/classify";
import { resampleByDistance } from "./resample";
import { douglasPeucker } from "../trace/simplify";
import { smoothPath } from "../smooth";
import { autoPullCompMm, autoSatinDensity, staggeredSatin } from "./satin";
import { marchingSquares, simplify } from "../paintbucket";

/** Longest single satin throw (mm) before it is split for safety. */
const MAX_THROW_MM = 7;
/** Shortest stroke (mm) worth satining; below this it is thinning noise. */
const MIN_BRANCH_MM = 2;

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
export type { Grid };

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

export function rasterize(rings: Path[], cellMm: number): Grid | null {
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
export function distanceTransform(g: Grid): Float32Array {
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

/**
 * Trace a skeleton into stroke polylines. Unlike a naive split-at-every-junction
 * tracer (which shatters an s or a serif stem into stubby fragments that don't
 * satin cleanly), this builds the skeleton's graph and then CHAINS the little
 * segments straight through each junction — at a junction it continues onto the
 * segment whose direction best lines up with where it was heading. The result is
 * a handful of long, smooth strokes per glyph instead of a pile of fragments.
 */
function traceSkeleton(skel: Uint8Array, w: number, h: number): [number, number][][] {
  const at = (i: number) => skel[i];
  const X = (i: number) => i % w;
  const Y = (i: number) => Math.floor(i / w);
  const neighbors = (i: number): number[] => {
    const x = X(i), y = Y(i);
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ax = x + dx, ay = y + dy;
        if (ax >= 0 && ay >= 0 && ax < w && ay < h && at(ay * w + ax)) out.push(ay * w + ax);
      }
    return out;
  };
  const degI = (i: number) => neighbors(i).length;
  const isNode = (i: number) => skel[i] && degI(i) !== 2; // endpoint or junction

  // --- 1. Extract segments: deg-2 chains between two nodes. -------------------
  const segs: number[][] = [];
  const seen = new Set<string>(); // `${node}->${firstStep}` so each is walked once
  for (let i = 0; i < w * h; i++) {
    if (!isNode(i)) continue;
    for (const start of neighbors(i)) {
      const key = `${i}->${start}`;
      if (seen.has(key)) continue;
      const cells = [i];
      let prev = i, cur = start;
      for (;;) {
        cells.push(cur);
        if (isNode(cur)) break;
        const next = neighbors(cur).find((n) => n !== prev);
        if (next === undefined) break;
        prev = cur;
        cur = next;
        if (cells.length > w * h) break; // safety
      }
      seen.add(key);
      seen.add(`${cells[cells.length - 1]}->${cells[cells.length - 2]}`);
      if (cells.length >= 2) segs.push(cells);
    }
  }

  // Direction (unit) leaving `cells[0]`, sampled a few cells in for stability.
  const headDir = (cells: number[]): [number, number] => {
    const k = Math.min(cells.length - 1, 4);
    const dx = X(cells[k]) - X(cells[0]);
    const dy = Y(cells[k]) - Y(cells[0]);
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };

  // --- 2. Adjacency of segments at each node. --------------------------------
  const incident = new Map<number, { si: number; atStart: boolean }[]>();
  const add = (node: number, si: number, atStart: boolean) => {
    const list = incident.get(node) ?? [];
    list.push({ si, atStart });
    incident.set(node, list);
  };
  segs.forEach((c, si) => {
    add(c[0], si, true);
    add(c[c.length - 1], si, false);
  });

  // --- 3. Chain segments straight through junctions. -------------------------
  const used = new Array(segs.length).fill(false);
  const oriented = (si: number, atStart: boolean) =>
    atStart ? segs[si] : [...segs[si]].reverse();

  const buildChain = (si: number, atStart: boolean): [number, number][] => {
    used[si] = true;
    const cells = oriented(si, atStart);
    for (;;) {
      const end = cells[cells.length - 1];
      if (degI(end) === 1) break; // real stroke terminal
      // Direction arriving at the junction (pointing in).
      const k = Math.min(cells.length - 1, 4);
      let ix = X(end) - X(cells[cells.length - 1 - k]);
      let iy = Y(end) - Y(cells[cells.length - 1 - k]);
      const il = Math.hypot(ix, iy) || 1;
      ix /= il;
      iy /= il;
      // Pick the unused continuation that bends the least.
      let best = -1, bestStart = true, bestDot = -2;
      for (const inc of incident.get(end) ?? []) {
        if (used[inc.si]) continue;
        const [lx, ly] = headDir(oriented(inc.si, inc.atStart));
        const dot = ix * lx + iy * ly; // ~1 == dead straight
        if (dot > bestDot) {
          bestDot = dot;
          best = inc.si;
          bestStart = inc.atStart;
        }
      }
      // Only chain through a junction when the continuation is genuinely straight
      // (≲55° bend). A loose threshold welds a bowl onto a stem (B, R) or a bar
      // (e, A); the centerline then kinks at the junction and the satin throws fan
      // into a spray. Breaking there yields a clean column per stroke — the throws
      // stay parallel and the crossing column covers the junction.
      if (best < 0 || bestDot < 0.55) break;
      used[best] = true;
      const more = oriented(best, bestStart);
      for (let i = 1; i < more.length; i++) cells.push(more[i]);
    }
    return cells.map((c) => [X(c), Y(c)] as [number, number]);
  };

  const lines: [number, number][][] = [];
  // Prefer strokes that begin at a real terminal so columns run end to end.
  segs.forEach((c, si) => {
    if (used[si]) return;
    if (degI(c[0]) === 1) lines.push(buildChain(si, true));
    else if (degI(c[c.length - 1]) === 1) lines.push(buildChain(si, false));
  });
  // Any leftover segments (junction-only cycles).
  segs.forEach((_, si) => {
    if (!used[si]) lines.push(buildChain(si, true));
  });

  // --- 4. Pure loops (all deg-2, no node) — e.g. the ring of an o. -----------
  const inSeg = new Uint8Array(w * h);
  for (const c of segs) for (const i of c) inSeg[i] = 1;
  const visited = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!skel[i] || inSeg[i] || visited[i]) continue;
    const line: [number, number][] = [];
    let cur = i, prev = -1;
    for (;;) {
      line.push([X(cur), Y(cur)]);
      visited[cur] = 1;
      const next = neighbors(cur).find((n) => n !== prev && !visited[n]);
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (line.length >= 2) lines.push(line);
  }

  return lines.filter((l) => l.length >= 2);
}

/**
 * Distance from `o` along unit `dir` to the first crossing of any ring edge,
 * searching only up to `maxDist`. Returns `maxDist` when nothing is hit within
 * range — so a throw at a junction (where the perpendicular ray would otherwise
 * shoot clear across the glyph and out the far side) is capped instead of running
 * away. This lets us land each rail ON the true glyph outline rather than at the
 * distance-transform estimate, which is what makes the satin edge crisp.
 */
function rayHit(o: Point, dir: Point, rings: Path[], maxDist: number): number {
  let best = maxDist;
  for (const ring of rings) {
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % m];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = dir.x * ey - dir.y * ex;
      if (Math.abs(denom) < 1e-9) continue; // ray parallel to edge
      const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / denom; // along ray
      const u = ((a.x - o.x) * dir.y - (a.y - o.y) * dir.x) / denom; // along edge
      if (t > 1e-4 && t < best && u >= -1e-6 && u <= 1 + 1e-6) best = t;
    }
  }
  return best;
}

/** Distance (mm) from point `p` to the nearest segment of polyline `line`. */
function distToPolyline(p: Point, line: Path): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1e-9;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/**
 * MITER: clip a rail half-width so the rail never crosses into a neighbouring
 * column's territory. Where two columns meet, each owns the points nearer its own
 * centerline; the boundary is the bisector. A throw cast `half` mm off the
 * centerline along `dir` is pulled back to the bisector so the two columns ABUT
 * along a clean seam instead of overlapping (thread build-up) or fanning across
 * each other. Away from any junction the neighbours are far, so nothing is clipped.
 */
function clipToTerritory(c: Point, dir: Point, half: number, siblings: Path[]): number {
  if (siblings.length === 0 || half <= 0) return half;
  let t = half;
  for (let iter = 0; iter < 4; iter++) {
    const q = { x: c.x + dir.x * t, y: c.y + dir.y * t };
    let dSib = Infinity;
    for (const s of siblings) {
      const d = distToPolyline(q, s);
      if (d < dSib) dSib = d;
    }
    if (t <= dSib + 1e-3) break; // q is in our own territory (own dist t ≤ sibling dist)
    t = dSib; // pull back toward the bisector and re-test
  }
  return Math.max(0, t);
}

/** Unit normal at point i of a centerline (average of adjacent segment normals). */
function normalAt(line: Point[], i: number, closed: boolean): Point {
  const n = line.length;
  const prev = closed ? line[(i - 1 + n) % n] : line[i > 0 ? i - 1 : i];
  const next = closed ? line[(i + 1) % n] : line[i < n - 1 ? i + 1 : i];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/** Half-width (mm) sampled from the distance transform at a millimeter point. */
function halfWidthAtMm(dt: Float32Array, g: Grid, x: number, y: number): number {
  const gx = Math.round((x - g.ox) / g.cellMm);
  const gy = Math.round((y - g.oy) / g.cellMm);
  if (gx < 0 || gy < 0 || gx >= g.w || gy >= g.h) return g.cellMm;
  return Math.max(g.cellMm, dt[gy * g.w + gx] * g.cellMm);
}

/** Light moving-average smoothing of a width profile (keeps the column even). */
function smoothWidths(halves: number[], closed: boolean): number[] {
  const n = halves.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = -2; k <= 2; k++) {
      const j = closed ? (i + k + n) % n : i + k;
      if (j < 0 || j >= n) continue;
      sum += halves[j];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/** 3-tap moving average over a rail, preserving open endpoints (loops wrap). */
function smoothRail(rail: Point[], closed: boolean): Point[] {
  const n = rail.length;
  if (n < 3) return rail;
  const out = rail.map((p) => ({ ...p }));
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue;
    const a = rail[closed ? (i - 1 + n) % n : i - 1];
    const b = rail[i];
    const c = rail[closed ? (i + 1) % n : i + 1];
    out[i] = { x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 };
  }
  return out;
}

/** A skeleton branch is a closed loop (o, e-counter, …) if its ends meet. */
function isLoop(branch: [number, number][]): boolean {
  if (branch.length < 8) return false;
  const [ax, ay] = branch[0];
  const [bx, by] = branch[branch.length - 1];
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= 1.6;
}

export interface MedialOptions {
  density: number;
  /** grid cell size in mm (default 0.4). */
  cellMm?: number;
  /** pull-compensation scale (fabric multiplier); 0 disables it (default 0). */
  pullScale?: number;
}

/**
 * mm a rail is pushed past the sampled stroke edge so the satin fully covers the
 * boundary instead of leaving a thin gap where the distance transform rounds in.
 */
const OVERSHOOT_MM = 0.1;

/** One satin stroke: the smoothed centerline (for underlay), throws, and the
 *  stroke's representative (median) full width in mm. */
export interface SatinColumn {
  centerline: Path;
  throws: Path;
  widthMm: number;
}

/**
 * Just the throws per skeleton branch (back-compat for coverage checks/tests).
 */
export function medialSatin(rings: Path[], opts: MedialOptions): Path[] {
  return medialColumns(rings, opts).map((c) => c.throws);
}

/**
 * Build satin columns down the medial axis of a fill region — one per skeleton
 * branch — returning each stroke's smoothed centerline (for a centerline
 * underlay) and its throws. Width tracks the real stroke (so serifs and tapers
 * stay covered) and closed loops (the ring of an o, the bowl of an e) are
 * stitched all the way around. Returns `[]` if the region is too
 * small/degenerate to skeletonize (the caller then falls back to a reliable fill).
 */
export function medialColumns(rings: Path[], opts: MedialOptions): SatinColumn[] {
  const cellMm = opts.cellMm ?? 0.4;
  const oriented = orientByDepth(rings);
  const grid = rasterize(oriented, cellMm);
  if (!grid) return [];

  const dt = distanceTransform(grid);
  const skel = thin(grid);
  const branches = traceSkeleton(skel, grid.w, grid.h);

  const columns: SatinColumn[] = [];
  for (const branch of branches) {
    if (branch.length < 2) continue;
    const loop = isLoop(branch);
    // Raw centerline in mm from the skeleton cells.
    const raw: Point[] = branch.map(([gx, gy]) => ({
      x: grid.ox + gx * cellMm,
      y: grid.oy + gy * cellMm,
    }));
    if (loop) raw.push({ ...raw[0] }); // close the ring

    // Prune thinning spurs and stray stubs — tiny branches that aren't real
    // strokes (they otherwise stitch as little floating boxes).
    if (polylineLength(raw) < MIN_BRANCH_MM) continue;

    // Clean the centerline: drop the pixel staircase, then smooth it.
    const center = smoothPath(douglasPeucker(raw, cellMm * 1.2), { maxSegmentMm: 0.8 });
    if (center.length < 2) continue;

    const col = buildColumn(center, loop, oriented, grid, dt, cellMm, opts, true, true);
    if (col) columns.push(col);
  }
  return dedupeColumns(columns, oriented, cellMm);
}

/**
 * Build satin columns from EXPLICIT centerlines instead of an auto-traced
 * skeleton — the per-glyph authored decomposition for the flagship font. The
 * caller hands one open polyline per stroke (already in mm, in the region's
 * space); we rasterize the region just for the width/edge raycast, then build a
 * clean column down each stroke. No junction trimming or stub dropping is needed
 * because the author already split the glyph into real strokes that meet cleanly;
 * terminal extension still runs so caps are covered, and the engine's residual
 * fill closes any tiny junction patch. Returns `[]` if the region won't rasterize.
 */
export function columnsFromCenterlines(
  rings: Path[],
  centerlines: Path[],
  opts: MedialOptions,
): SatinColumn[] {
  const cellMm = opts.cellMm ?? 0.3;
  const oriented = orientByDepth(rings);
  const grid = rasterize(oriented, cellMm);
  if (!grid) return [];
  const dt = distanceTransform(grid);

  // Pass 1 — snap every seed onto the stroke's true medial. The authored seeds are
  // eyeballed 2-point strokes; densify, recenter each sample between the glyph
  // edges, and split off any run that strayed off the ink (grazed a counter / ran
  // past a cap). The geometry pins the approximate coordinates to the letterform.
  const centers: Path[] = [];
  for (const cl of centerlines) {
    const seedDense = resampleByDistance(cl, Math.max(0.25, cellMm));
    for (const seg of snapToMedial(seedDense, oriented)) {
      const center = smoothPath(seg, { maxSegmentMm: 0.8 });
      if (center.length >= 2) centers.push(center);
    }
  }

  // Pass 2 — build each column MITERED against its neighbours, by PRIORITY: the
  // longest stroke runs THROUGH a junction (covering its core), shorter strokes
  // ABUT it. So each column is clipped only against the LONGER ones already built.
  // This is how a junction is digitized by hand — the main stroke is continuous,
  // the branches butt against it — and it leaves a clean star seam with no core
  // patch (the through-stroke fills the core, so the residual fill has nothing to
  // do there). The miter only needs each neighbour's rough path, so coarsen it.
  const order = centers
    .map((_, i) => i)
    .sort((a, b) => polylineLength(centers[b]) - polylineLength(centers[a]));
  const columns: SatinColumn[] = [];
  const higher: Path[] = []; // coarse centerlines of the longer strokes built so far
  for (const i of order) {
    const col = buildColumn(centers[i], false, oriented, grid, dt, cellMm, opts, true, false, higher.slice());
    if (col) columns.push(col);
    higher.push(douglasPeucker(centers[i], 0.5));
  }
  return columns;
}

/**
 * Snap a seed centerline onto the stroke's true medial. At each point we cast a
 * ray perpendicular to the local tangent to both glyph edges; if both are found
 * within a stroke's width the point is moved to their midpoint (so it sits dead
 * centre of the stroke). Points outside the ink — where an eyeballed seed grazed
 * a counter or ran past the cap — are dropped, splitting the seed onto only the
 * part that's really inside the stroke. This lets the authored coordinates be
 * approximate; the geometry pins them to the real letterform.
 */
function snapToMedial(seed: Point[], oriented: Path[]): Point[][] {
  const MAX_HALF = 6; // mm — never reach across to a far stroke at a junction
  const segs: Point[][] = [];
  let cur: Point[] = [];
  const flush = () => {
    if (cur.length >= 2) segs.push(cur);
    cur = [];
  };
  for (let i = 0; i < seed.length; i++) {
    const p = seed[i];
    if (!inside(p.x, p.y, oriented)) {
      flush(); // seed strayed off the ink → end this run, start a fresh one
      continue;
    }
    const a = seed[Math.max(0, i - 1)];
    const b = seed[Math.min(seed.length - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = -ty;
    const ny = tx;
    const hitP = rayHit(p, { x: nx, y: ny }, oriented, MAX_HALF);
    const hitM = rayHit(p, { x: -nx, y: -ny }, oriented, MAX_HALF);
    const q =
      hitP < MAX_HALF && hitM < MAX_HALF
        ? { x: p.x + nx * ((hitP - hitM) / 2), y: p.y + ny * ((hitP - hitM) / 2) } // recentre
        : { ...p };
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 1e-3) cur.push(q);
  }
  flush();
  return segs;
}

/**
 * Lay one satin column down a single centerline: sample it densely, raycast each
 * rail to the true outline, place throws with density compensation. Shared by the
 * auto (skeleton) and authored paths. `trimJunctions` enables the skeleton-only
 * clean-up (drop junction stubs, pull ballooning/curling junction ends back);
 * authored strokes skip it. Returns `null` if the stroke is too small/degenerate.
 */
function buildColumn(
  center: Point[],
  loop: boolean,
  oriented: Path[],
  grid: Grid,
  dt: Float32Array,
  cellMm: number,
  opts: MedialOptions,
  trimJunctions: boolean,
  dropStubs: boolean,
  siblings: Path[] = [],
): SatinColumn | null {
  // Densely sample the centerline, build both rails, then place throws with
  // DENSITY COMPENSATION: advance until whichever rail (the outer one on a
  // curve) has moved one stitch spacing, so the convex edge stays evenly
  // covered instead of fanning into gaps and the concave edge naturally packs
  // tighter — the hallmark of crisp, professional satin. Throws are cast
  // perpendicular off the centerline so they never fan at curves/junctions.
  const density = Math.max(0.1, opts.density);
  let dense = resampleByDistance(center, Math.max(0.05, density / 4));
  if (loop && dense.length > 1) {
    const a = dense[0];
    const b = dense[dense.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) dense.push({ ...a });
  }
  if (dense.length < 2) return null;

  let halves = smoothWidths(
    dense.map((p) => halfWidthAtMm(dt, grid, p.x, p.y) + OVERSHOOT_MM),
    loop,
  );
  // Typical stroke half-width for this column (median of the DT samples). Where
  // strokes meet — B's bowls into the stem, e's bowl into the bar — the inscribed
  // circle balloons, so the raw DT half spikes and the perpendicular ray bolts
  // clear across the glyph; the throws there fan into a spray. Capping each rail
  // a little past the typical width keeps the column the width of its own stroke;
  // the crossing column covers the junction blob. This is what kills the fan.
  const dtHalves = halves.map((h) => Math.max(0, h - OVERSHOOT_MM)).sort((a, b) => a - b);
  const medHalfDt = dtHalves[dtHalves.length >> 1] ?? 0;
  const widthCap = medHalfDt > 0 ? medHalfDt * 1.4 : Infinity;

  // Drop junction-stub branches: the little segment at the very center of a Y
  // (a meeting R's stem, bowl and leg) is short and as wide as it is long, not a
  // real stroke. Satining it casts a spray of crossing throws. If a branch isn't
  // elongated (length < ~1.4× its own width) skip it — the strokes that cross
  // the junction already cover that patch. (Loops are always real; authored
  // strokes are trusted.)
  if (dropStubs && !loop && medHalfDt > 0 && polylineLength(center) < 2 * medHalfDt * 1.4) {
    return null;
  }

  // Trim JUNCTION ends. A real stroke terminal sits at the glyph outline (small
  // local width, the centerline running straight into the edge); a junction end
  // runs deep into where strokes merge — there the width BALLOONS and the
  // centerline CURLS hard to follow the skeleton into the other stroke. Either
  // one makes the throws fan, so pull each free end back to where the column is
  // both normal width and reasonably straight. The crossing column (plus the
  // residual fill the engine lays over any uncovered junction patch) covers the
  // little wedge we drop. (Loops have no free ends; authored strokes are clean.)
  if (trimJunctions && !loop && medHalfDt > 0 && dense.length >= 6) {
    const fat = medHalfDt * 1.25;
    const minKeep = Math.max(3, Math.floor(dense.length * 0.3));
    // Turn angle (deg) of the centerline at sample i — high near a junction curl.
    const turnAt = (i: number): number => {
      if (i <= 0 || i >= dense.length - 1) return 0;
      const ax = dense[i].x - dense[i - 1].x, ay = dense[i].y - dense[i - 1].y;
      const bx = dense[i + 1].x - dense[i].x, by = dense[i + 1].y - dense[i].y;
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
      return (Math.acos(dot) * 180) / Math.PI;
    };
    const kink = 7; // deg per ~quarter-stitch step — a hard curl into a junction
    // (a normal bowl turns ~2°/step at this sampling; a junction curl ≳10°).
    let lo = 0;
    let hi = dense.length - 1;
    while (hi - lo + 1 > minKeep && (halves[lo] - OVERSHOOT_MM > fat || turnAt(lo + 1) > kink)) lo++;
    while (hi - lo + 1 > minKeep && (halves[hi] - OVERSHOOT_MM > fat || turnAt(hi - 1) > kink)) hi--;
    if (lo > 0 || hi < dense.length - 1) {
      dense = dense.slice(lo, hi + 1);
      halves = halves.slice(lo, hi + 1);
    }
  }

  // Extend TERMINAL ends out to the stroke cap. Skeleton thinning stops about
  // half a stroke width short of a flat/round terminal, so the cap is left bare
  // and would otherwise be patched with an ugly little tatami zig-zag. Push each
  // free end along its tangent until it reaches the outline — but only at a TRUE
  // terminal (the cap is close ahead); never out of a trimmed junction, where
  // there's open glyph ahead. The perpendicular throws then cover the cap with
  // clean satin. (Loops have no free ends.)
  if (!loop && dense.length >= 2) {
    const extendEnd = (atStart: boolean) => {
      const i0 = atStart ? 0 : dense.length - 1;
      const i1 = atStart ? 1 : dense.length - 2;
      let ux = dense[i0].x - dense[i1].x;
      let uy = dense[i0].y - dense[i1].y;
      const tl = Math.hypot(ux, uy) || 1;
      ux /= tl;
      uy /= tl;
      const localHalf = Math.max(cellMm, halves[i0] - OVERSHOOT_MM);
      // Don't extend a JUNCTION end (a neighbouring column is close) — extending
      // there pushes the stroke into the meeting and overshoots. Only extend a
      // free terminal, where the cap sits just ahead with no sibling nearby.
      if (siblings.length) {
        let dSib = Infinity;
        for (const s of siblings) dSib = Math.min(dSib, distToPolyline(dense[i0], s));
        if (dSib < localHalf * 2) return;
      }
      const ahead = rayHit(dense[i0], { x: ux, y: uy }, oriented, localHalf * 2 + cellMm);
      if (ahead <= localHalf * 1.4 + cellMm) {
        const ext = ahead - cellMm * 0.5;
        if (ext > cellMm * 0.5) {
          const p = { x: dense[i0].x + ux * ext, y: dense[i0].y + uy * ext };
          if (atStart) {
            dense.unshift(p);
            halves.unshift(halves[0]);
          } else {
            dense.push(p);
            halves.push(halves[halves.length - 1]);
          }
        }
      }
    };
    extendEnd(true);
    extendEnd(false);
  }

  // Width-driven pull compensation (docs/stitch-logic.md §6): widen each rail
  // by half the auto pull-comp for the local stroke width so the sewn column
  // matches the drawn stroke. `pullScale` carries the fabric multiplier; 0
  // leaves the rails on the true stroke edge.
  const pullScale = opts.pullScale ?? 0;
  const leftRaw: Point[] = [];
  const rightRaw: Point[] = [];
  for (let i = 0; i < dense.length; i++) {
    const nrm = normalAt(dense, i, loop);
    const c = dense[i];
    const dtHalf = Math.max(0, halves[i] - OVERSHOOT_MM); // distance-transform estimate
    const comp = pullScale > 0 ? autoPullCompMm(2 * dtHalf, pullScale) / 2 : 0;
    // Land each rail ON the real glyph edge: cast a ray perpendicular off the
    // centerline and stop at the outline. Each side is solved independently so
    // asymmetric strokes (serifs, tapers) sit true. The ray is capped a little
    // past the DT estimate so it can reach an edge the grid rounded short, but
    // can't bolt across the glyph at a junction; if it misses (concave seam) we
    // fall back to the DT half. When the ray HITS, the rail already sits exactly
    // on the glyph edge, so it gets only pull compensation; only the DT FALLBACK
    // adds the small overshoot, because the DT estimate sits a hair inside.
    const cap = Math.min(dtHalf * 1.6 + cellMm, widthCap);
    const hitL = rayHit(c, nrm, oriented, cap);
    const hitR = rayHit(c, { x: -nrm.x, y: -nrm.y }, oriented, cap);
    let halfL = Math.min(hitL < cap ? hitL : dtHalf + OVERSHOOT_MM, widthCap) + comp;
    let halfR = Math.min(hitR < cap ? hitR : dtHalf + OVERSHOOT_MM, widthCap) + comp;
    // MITER: pull each rail back to the bisector with any neighbouring column so
    // meeting strokes abut along a clean seam instead of overlapping or fanning.
    const negNrm = { x: -nrm.x, y: -nrm.y };
    halfL = clipToTerritory(c, nrm, halfL, siblings);
    halfR = clipToTerritory(c, negNrm, halfR, siblings);
    leftRaw.push({ x: c.x + nrm.x * halfL, y: c.y + nrm.y * halfL });
    rightRaw.push({ x: c.x - nrm.x * halfR, y: c.y - nrm.y * halfR });
  }
  // Lightly smooth each rail so the satin edge reads as a clean line instead of
  // a faintly wobbly one (the distance transform samples width on a grid). A
  // 3-tap average barely moves coverage but visibly crisps the column edges.
  const left = smoothRail(leftRaw, loop);
  const right = smoothRail(rightRaw, loop);

  // Auto-spacing: tighten rows on wide columns (narrow lettering strokes, the
  // common case, keep the drawn density — see autoSatinDensity).
  const sortedHalf = [...halves].sort((p, q) => p - q);
  const medHalf = sortedHalf[sortedHalf.length >> 1] ?? 0;
  const step = autoSatinDensity(density, Math.max(0, 2 * (medHalf - OVERSHOOT_MM)));

  // Choose throw positions so neither rail's gap exceeds the stitch spacing.
  const idx: number[] = [0];
  let last = 0;
  for (let i = 1; i < dense.length; i++) {
    const dl = Math.hypot(left[i].x - left[last].x, left[i].y - left[last].y);
    const dr = Math.hypot(right[i].x - right[last].x, right[i].y - right[last].y);
    if (Math.max(dl, dr) >= step) {
      idx.push(i);
      last = i;
    }
  }
  if (idx[idx.length - 1] !== dense.length - 1) idx.push(dense.length - 1);

  // Alternate the leading rail each throw so they chain into a zig-zag; split
  // any over-wide throw into scattered sub-stitches (split satin, no seam).
  const pairs: [Point, Point][] = idx.map((i, k) =>
    k % 2 === 0 ? [left[i], right[i]] : [right[i], left[i]],
  );
  const capped = staggeredSatin(pairs, MAX_THROW_MM, true);
  if (capped.length < 2) return null;
  // Representative stroke width = median rail-to-rail span (drop the edge
  // overshoot we added), used to decide satin-vs-fill upstream.
  const sorted = [...halves].sort((p, q) => p - q);
  const medianHalf = sorted[sorted.length >> 1] ?? 0;
  const widthMm = Math.max(0, 2 * (medianHalf - OVERSHOOT_MM));
  return { centerline: center, throws: capped, widthMm };
}

/**
 * Drop redundant columns by COVERAGE. The skeleton tracer sometimes emits two
 * columns over the same stroke (a bowl traced both as a full loop and as an arc);
 * both pile into the junction and their throws fan and cross. Keeping the longest
 * columns first and discarding any that add almost no NEW covered area leaves one
 * clean column per stroke — while preserving COMPLEMENTARY columns (a stem and a
 * bowl whose centerlines pass close but cover different width), which a naive
 * centerline-distance test would wrongly merge and leave the glyph under-covered.
 */
function dedupeColumns(cols: SatinColumn[], oriented: Path[], cellMm: number): SatinColumn[] {
  if (cols.length <= 1) return cols;
  const grid = rasterize(oriented, cellMm);
  if (!grid) return cols;
  const { w, h, ox, oy } = grid;
  const covered = new Uint8Array(w * h);
  // Cells a column's throws sweep through (with a ~thread-width radius), as a set.
  const footprint = (c: SatinColumn): number[] => {
    const cells = new Set<number>();
    const mark = (x: number, y: number) => {
      const gx = Math.round((x - ox) / cellMm);
      const gy = Math.round((y - oy) / cellMm);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const cx = gx + dx;
          const cy = gy + dy;
          if (cx >= 0 && cy >= 0 && cx < w && cy < h) cells.add(cy * w + cx);
        }
    };
    for (let i = 1; i < c.throws.length; i++) {
      const a = c.throws[i - 1];
      const b = c.throws[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cellMm * 0.75)));
      for (let s = 0; s <= steps; s++) mark(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
    }
    return [...cells];
  };
  const order = cols.map((_, i) => i).sort((a, b) => polylineLength(cols[b].centerline) - polylineLength(cols[a].centerline));
  const kept: SatinColumn[] = [];
  for (const i of order) {
    const cells = footprint(cols[i]);
    if (cells.length === 0) continue;
    let fresh = 0;
    for (const c of cells) if (!covered[c]) fresh++;
    // Keep a column only if a real share of its footprint is new ground; otherwise
    // it just retraces stitches already laid. (The first/biggest always passes.)
    if (kept.length > 0 && fresh / cells.length < 0.3) continue;
    for (const c of cells) covered[c] = 1;
    kept.push(cols[i]);
  }
  return kept;
}

/**
 * Fraction of the region actually covered by a set of stitch runs (0..1). We
 * rasterize the region, then mark every cell a stitch segment passes through (and
 * its neighbors). A well-formed satin covers nearly all of the glyph; a broken
 * one — a missing branch, a column that wandered off — leaves big gaps, which is
 * exactly when the engine should fall back to a plain fill.
 */
export function satinCoverage(rings: Path[], runs: Path[], cellMm = 0.5): number {
  const oriented = orientByDepth(rings);
  const grid = rasterize(oriented, cellMm);
  if (!grid) return 0;
  const { w, h, ox, oy, cells } = grid;

  let total = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i]) total++;
  if (total === 0) return 0;

  const covered = new Uint8Array(w * h);
  const mark = (x: number, y: number) => {
    const gx = Math.round((x - ox) / cellMm);
    const gy = Math.round((y - oy) / cellMm);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx;
        const cy = gy + dy;
        if (cx >= 0 && cy >= 0 && cx < w && cy < h) covered[cy * w + cx] = 1;
      }
  };

  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1];
      const b = run[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cellMm * 0.75)));
      for (let s = 0; s <= steps; s++) {
        mark(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
      }
    }
  }

  let hit = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] && covered[i]) hit++;
  return hit / total;
}

/**
 * The parts of a region the satin DIDN'T cover, as polygons (mm) — the small
 * patches at stroke crossings and junctions where columns are trimmed back so
 * they don't fan. The engine tatami-fills these so a self-crossing script loop
 * (the 'l' in "hello") or a 3-way meeting never shows a bare hole. We rasterize
 * the region, paint the sewn satin paths with a thread-width brush, morphological-
 * OPEN the leftover so the thin slivers between satin rows don't count, then trace
 * what remains. Returns `[]` when satin covered everything.
 */
export function residualRegions(rings: Path[], sewn: Path[], cellMm = 0.3): Path[] {
  const oriented = orientByDepth(rings);
  const grid = rasterize(oriented, cellMm);
  if (!grid) return [];
  const { w, h, ox, oy, cells } = grid;

  // Mark every cell the sewn satin passes through, plus a one-cell halo (≈ the
  // thread's own width), so adjacent throws read as solid and only true gaps stay.
  const covered = new Uint8Array(w * h);
  const mark = (x: number, y: number) => {
    const gx = Math.round((x - ox) / cellMm);
    const gy = Math.round((y - oy) / cellMm);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx;
        const cy = gy + dy;
        if (cx >= 0 && cy >= 0 && cx < w && cy < h) covered[cy * w + cx] = 1;
      }
  };
  for (const run of sewn) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1];
      const b = run[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cellMm * 0.75)));
      for (let s = 0; s <= steps; s++) mark(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
    }
  }

  // Uncovered interior, then DILATE so a thin junction gap grows into a fillable
  // patch and overlaps the satin edge a hair (the satin sits on top, so the
  // overlap is invisible — but it guarantees no white nick is left). A later
  // by-AREA filter drops the tiny inter-row specks; we deliberately don't erode,
  // which would erase the very junction slivers we need to close.
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (cells[i] && !covered[i]) mask[i] = 1;
  mask = dilateMask(mask, w, h);
  // Keep only cells still inside the region (dilation can spill onto a covered or
  // outside cell).
  for (let i = 0; i < w * h; i++) if (mask[i] && !cells[i]) mask[i] = 0;

  let any = false;
  for (let i = 0; i < w * h; i++) if (mask[i]) { any = true; break; }
  if (!any) return [];

  const minArea = Math.max(2.2, (3 * cellMm) ** 2); // ignore inter-row specks
  return marchingSquares(mask, w, h)
    .map((ring) => simplify(ring.map((p) => ({ x: ox + p.x * cellMm, y: oy + p.y * cellMm })), cellMm * 0.9))
    .filter((r) => r.length >= 3 && Math.abs(polygonArea(r)) >= minArea);
}

/** 4-connected dilation: set any empty cell with a set orthogonal neighbour. */
function dilateMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = mask.slice();
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if (mask[j * w + i]) continue;
      const up = j > 0 && mask[(j - 1) * w + i];
      const dn = j < h - 1 && mask[(j + 1) * w + i];
      const lt = i > 0 && mask[j * w + i - 1];
      const rt = i < w - 1 && mask[j * w + i + 1];
      if (up || dn || lt || rt) out[j * w + i] = 1;
    }
  return out;
}

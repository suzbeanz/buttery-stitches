import type { Path, Point } from "../../types/project";
import { orientByDepth } from "./fill";
import { polylineLength } from "../geometry";
import { resampleByDistance, capSegmentLength } from "./resample";
import { douglasPeucker } from "../trace/simplify";
import { smoothPath } from "../smooth";
import { autoPullCompMm } from "./satin";

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
      if (best < 0 || bestDot < -0.2) break; // nothing straight enough to continue
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

    // Densely sample the centerline, build both rails, then place throws with
    // DENSITY COMPENSATION: advance until whichever rail (the outer one on a
    // curve) has moved one stitch spacing, so the convex edge stays evenly
    // covered instead of fanning into gaps and the concave edge naturally packs
    // tighter — the hallmark of crisp, professional satin. Throws are cast
    // perpendicular off the centerline so they never fan at curves/junctions.
    const density = Math.max(0.1, opts.density);
    const dense = resampleByDistance(center, Math.max(0.05, density / 4));
    if (loop && dense.length > 1) {
      const a = dense[0];
      const b = dense[dense.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) dense.push({ ...a });
    }
    if (dense.length < 2) continue;

    const halves = smoothWidths(
      dense.map((p) => halfWidthAtMm(dt, grid, p.x, p.y) + OVERSHOOT_MM),
      loop,
    );
    // Width-driven pull compensation (docs/stitch-logic.md §6): widen each rail
    // by half the auto pull-comp for the local stroke width so the sewn column
    // matches the drawn stroke. `pullScale` carries the fabric multiplier; 0
    // leaves the rails on the true stroke edge.
    const pullScale = opts.pullScale ?? 0;
    const left: Point[] = [];
    const right: Point[] = [];
    for (let i = 0; i < dense.length; i++) {
      const nrm = normalAt(dense, i, loop);
      const trueHalf = halves[i] - OVERSHOOT_MM;
      const comp = pullScale > 0 ? autoPullCompMm(2 * Math.max(0, trueHalf), pullScale) / 2 : 0;
      const half = halves[i] + comp;
      left.push({ x: dense[i].x + nrm.x * half, y: dense[i].y + nrm.y * half });
      right.push({ x: dense[i].x - nrm.x * half, y: dense[i].y - nrm.y * half });
    }

    // Choose throw positions so neither rail's gap exceeds the stitch spacing.
    const idx: number[] = [0];
    let last = 0;
    for (let i = 1; i < dense.length; i++) {
      const dl = Math.hypot(left[i].x - left[last].x, left[i].y - left[last].y);
      const dr = Math.hypot(right[i].x - right[last].x, right[i].y - right[last].y);
      if (Math.max(dl, dr) >= density) {
        idx.push(i);
        last = i;
      }
    }
    if (idx[idx.length - 1] !== dense.length - 1) idx.push(dense.length - 1);

    const pts: Point[] = [];
    idx.forEach((i, k) => {
      // Alternate the leading rail each throw so they chain into a zig-zag.
      if (k % 2 === 0) pts.push(left[i], right[i]);
      else pts.push(right[i], left[i]);
    });
    const capped = capSegmentLength(pts, MAX_THROW_MM);
    if (capped.length >= 2) {
      // Representative stroke width = median rail-to-rail span (drop the edge
      // overshoot we added), used to decide satin-vs-fill upstream.
      const sorted = [...halves].sort((p, q) => p - q);
      const medianHalf = sorted[sorted.length >> 1] ?? 0;
      const widthMm = Math.max(0, 2 * (medianHalf - OVERSHOOT_MM));
      columns.push({ centerline: center, throws: capped, widthMm });
    }
  }
  return columns;
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

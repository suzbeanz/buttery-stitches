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
/** Straight-snap: a non-loop branch at least this long whose points all sit
 *  within the deviation below of its end-to-end chord is replaced by the exact
 *  chord — traced ladder rails and rungs sew dead straight instead of carrying
 *  the trace's wobble into the satin. */
const STRAIGHT_SNAP_MIN_MM = 2.5;
const STRAIGHT_SNAP_MAX_DEV_MM = 0.6;
/** Regularized (line-art) strokes snap straight more eagerly: a long traced rail
 *  that undulates a little past the base tolerance still READS as a straight bar,
 *  and a hand digitizer would draw it straight. Deviation allowed grows with the
 *  chord, capped so a genuine curve never snaps. */
const REGULARIZE_SNAP_DEV_FRAC = 0.03;
const REGULARIZE_SNAP_DEV_MAX_MM = 1.2;
/** Regularized width band: cartoon linework is a constant-width pen stroke, so a
 *  column's half-width is clamped to this band around its own median. The trace's
 *  bead-and-pinch noise flattens out while a genuine taper (which falls far below
 *  the floor before the terminal trim) still narrows. */
const REGULARIZE_WIDTH_LO = 0.78;
const REGULARIZE_WIDTH_HI = 1.1;
/** Arc-length half-window (mm) of the extra centerline low-pass applied to
 *  regularized strokes — wide enough to kill the trace's undulation, narrow
 *  enough to keep a real bend (a wheel arch, a bumper corner). */
const REGULARIZE_SMOOTH_MM = 1.6;
/** Regularization is CARTOON-SCALE machinery. On a branch shorter than this
 *  (mm) — a small letterform's stroke — the low-pass window rivals the whole
 *  stroke and MELTS the letter, so short branches keep their true shape. */
const REGULARIZE_MIN_BRANCH_MM = 8;
/** CIRCLE-SNAP (regularized line art): a branch whose points all sit within a
 *  trace-noise band of a fitted circle IS that circle — a tire wall, a round
 *  window frame, a wheel arch. Arcs of the SAME circle (a ring the skeleton
 *  chopped at its junctions) weld back into ONE closed circular stroke, so the
 *  tire sews as a single complete ring of radial satin with no trimmed-junction
 *  wedges. Only arcs with real angular extent qualify (a shortish chord fits
 *  any circle), and the fit tolerance scales with the radius. */
const CIRCLE_SNAP_MIN_SPAN_DEG = 50;
/** Snap floor: a cartoon's round features (tires, hubs, frames, arches) live at
 *  r ≥ ~3mm. Below that the near-circular arcs are LETTERFORM curls (the bowl
 *  of a small 'U', the spine of an 'S') — snapping those to circles melts the
 *  text, so they keep their traced shape. */
const CIRCLE_SNAP_MIN_R_MM = 3;
const CIRCLE_SNAP_MAX_R_MM = 40;
const CIRCLE_SNAP_DEV_FRAC = 0.08;
const CIRCLE_SNAP_DEV_MIN_MM = 0.5;
const CIRCLE_SNAP_DEV_MAX_MM = 1.0;
/** Weld arcs into a full ring when together they cover at least this much of
 *  the circle — the skeleton's junction chops are small, so a real ring's arcs
 *  cover nearly all of it. */
const CIRCLE_WELD_MIN_COVER_DEG = 300;
/** ANNULUS detection: a circular HOLE with a near-constant ink wall around it
 *  is a drawn ring (a tire around its hub, a round window frame) even when the
 *  skeleton chained the ring into neighbouring strokes. The wall must be a
 *  believable stroke width and hold near its median around most of the circle
 *  (junction openings where other strokes meet the ring are the exceptions). */
const ANNULUS_WALL_MIN_MM = 0.9;
const ANNULUS_WALL_MAX_MM = 12;
const ANNULUS_WALL_TOL_FRAC = 0.3;
const ANNULUS_MIN_GOOD_FRAC = 0.6;
/** Above this many skeleton branches a region is a big auto-digitized blob, not
 *  lettering — skip the pairwise junction miter there (costly, less needed). */
const MITER_MAX_BRANCHES = 16;
/** Seam allowance (mm): meeting columns carry this far past the miter bisector so
 *  they overlap by a sub-stitch sliver and never leave a hairline gap. */
const SEAM_ALLOWANCE_MM = 0.3;

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
  // Carry a hair PAST the bisector (a seam allowance) so meeting columns overlap
  // by a sub-stitch sliver instead of leaving a pixel gap — a real mitred seam is
  // never a hairline butt. Capped at the true edge so it can't bulge the stroke.
  return Math.min(half, t + (t < half ? SEAM_ALLOWANCE_MM : 0));
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

/** Arc-length moving average of a polyline: resample at a fine step, average each
 *  sample over ±`radiusMm` of arc, endpoints pinned (loops wrap). Used to take the
 *  trace's undulation out of a regularized line-art centerline — a stiffer low-pass
 *  than the light vertex smoothing every centerline already gets. */
function lowPassPath(path: Point[], radiusMm: number, closed: boolean): Point[] {
  const step = 0.4;
  const pts = resampleByDistance(path, step);
  const n = pts.length;
  if (n < 3) return path;
  const win = Math.max(1, Math.round(radiusMm / step));
  const out: Point[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      out[i] = { ...pts[i] };
      continue;
    }
    // Near an open end the window shrinks symmetrically so the line can't drift.
    const w = closed ? win : Math.min(win, i, n - 1 - i);
    let sx = 0, sy = 0, c = 0;
    for (let k = -w; k <= w; k++) {
      const j = closed ? (i + k + n) % n : i + k;
      sx += pts[j].x;
      sy += pts[j].y;
      c++;
    }
    out[i] = { x: sx / c, y: sy / c };
  }
  return out;
}

/** Least-squares (Kåsa) circle fit. Returns the circle and the max radial
 *  deviation of the points from it, or null for degenerate input. */
function fitCircle(pts: Point[]): { cx: number; cy: number; r: number; maxDev: number } | null {
  const n = pts.length;
  if (n < 5) return null;
  // Solve [Sxx Sxy Sx; Sxy Syy Sy; Sx Sy n] · [A B C]ᵀ = [Sxz Syz Sz]
  // for x²+y² = A·x + B·y + C (center (A/2, B/2), r² = C + A²/4 + B²/4).
  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y;
    Sx += p.x; Sy += p.y; Sxx += p.x * p.x; Syy += p.y * p.y; Sxy += p.x * p.y;
    Sxz += p.x * z; Syz += p.y * z; Sz += z;
  }
  const m = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx, Sy, n],
  ];
  const v = [Sxz, Syz, Sz];
  // Gaussian elimination with partial pivoting (3×3).
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-9) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    [v[col], v[piv]] = [v[piv], v[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 3; c++) m[r][c] -= f * m[col][c];
      v[r] -= f * v[col];
    }
  }
  const A = v[0] / m[0][0];
  const B = v[1] / m[1][1];
  const C = v[2] / m[2][2];
  const cx = A / 2;
  const cy = B / 2;
  const r2 = C + cx * cx + cy * cy;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let maxDev = 0;
  for (const p of pts) {
    maxDev = Math.max(maxDev, Math.abs(Math.hypot(p.x - cx, p.y - cy) - r));
  }
  return { cx, cy, r, maxDev };
}

/** Angular span (deg) a polyline covers around a center, plus which 1° bins it
 *  touches (for union-of-arcs coverage). */
function arcBins(pts: Point[], cx: number, cy: number): Uint8Array {
  const bins = new Uint8Array(360);
  const angOf = (p: Point) => {
    let a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;
    if (a < 0) a += 360;
    return a;
  };
  for (let i = 1; i < pts.length; i++) {
    const a0 = angOf(pts[i - 1]);
    const a1 = angOf(pts[i]);
    // Walk the short way between consecutive samples.
    let d = a1 - a0;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    const steps = Math.max(1, Math.ceil(Math.abs(d)));
    for (let s = 0; s <= steps; s++) {
      let a = a0 + (d * s) / steps;
      if (a < 0) a += 360;
      bins[Math.floor(a) % 360] = 1;
    }
  }
  return bins;
}

/** An exact circle polyline (closed: first point repeated last). */
function circlePath(cx: number, cy: number, r: number, stepMm = 0.8): Point[] {
  const n = Math.max(24, Math.ceil((2 * Math.PI * r) / stepMm));
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** Straight-snap a centerline to its exact chord when every point sits within
 *  the (regularize-scaled) tolerance of it. Shared by pass 1 and the annulus
 *  clipper (whose leftover tails deserve the same treatment). */
function maybeStraightSnap(center: Point[], regularize: boolean): Point[] {
  if (center.length <= 2) return center;
  const a = center[0];
  const b = center[center.length - 1];
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (chord < STRAIGHT_SNAP_MIN_MM) return center;
  const devTol = regularize
    ? Math.min(REGULARIZE_SNAP_DEV_MAX_MM, Math.max(STRAIGHT_SNAP_MAX_DEV_MM, chord * REGULARIZE_SNAP_DEV_FRAC))
    : STRAIGHT_SNAP_MAX_DEV_MM;
  let maxDev = 0;
  for (const p of center) {
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (chord * chord)));
    maxDev = Math.max(maxDev, Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t)));
    if (maxDev > devTol) return center;
  }
  return [a, b];
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
  /** Treat the region as auto-traced LINE ART (a cartoon's pen strokes): smooth
   *  the centerlines harder, snap long near-straight strokes to exact chords,
   *  and hold each column to a constant width (its own median) so the trace's
   *  bead-and-pinch noise never reaches the satin. */
  regularize?: boolean;
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
  /** The two smoothed edge rails of the stroke (aligned, equal length). Lets a
   *  caller fill the column with parallel passes ALONG the stroke (between the
   *  rails) instead of satin throws ACROSS it — a clean solid band that never fans
   *  into a starburst on a wide ring. */
  left: Path;
  right: Path;
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

  // Pass 1 — clean centerline per skeleton branch.
  const prepped: { center: Path; loop: boolean; straight: boolean }[] = [];
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

    // Clean the centerline: drop the pixel staircase, then smooth it. Regularized
    // line-art gets a stiffer low-pass on top — a cartoon stroke's undulation is
    // trace noise, and the pen line a digitizer would draw through it is smooth.
    let center = smoothPath(douglasPeucker(raw, cellMm * 1.2), { maxSegmentMm: 0.8 });
    if (center.length < 2) continue;
    if (opts.regularize && center.length > 2 && polylineLength(center) >= REGULARIZE_MIN_BRANCH_MM) {
      center = lowPassPath(center, REGULARIZE_SMOOTH_MM, loop);
    }
    // STRAIGHT-SNAP: a branch whose every point lies within a trace-noise bow
    // of its own end-to-end chord IS a straight stroke (a ladder rail segment,
    // a rung, a window bar) — replace it with the exact chord so the satin lies
    // dead straight. Endpoints are preserved, so junction meeting points don't
    // move; loops and genuinely curved branches (which bow far past the
    // tolerance) are untouched. Regularized line-art snaps more eagerly (the
    // allowance grows with the chord): a long wavy rail is a straight bar.
    if (!loop) center = maybeStraightSnap(center, !!opts.regularize);
    prepped.push({ center, loop, straight: center.length === 2 });
  }

  // Pass 1⅛ — split chained branches at CONTESTED junction kinks. In a Y the
  // tracer welds one arm onto the tail (each bends only ~30°, inside the
  // chaining threshold), leaving a KINKED chain: its satin throws fan into a
  // spray at the elbow while the other arm's column piles on top — a scribble
  // on fabric. Junction-cluster pixel noise makes this impossible to judge
  // reliably at trace time, but down here in smoothed mm space the signature
  // is unmistakable: the chain turns hard at the very point where ANOTHER
  // branch's terminal abuts (the junction). A straight pass-through — a T's
  // crossbar, a K or R stem, a crescent spine with rungs — has no kink there
  // and is never touched. Split the chain at the elbow; each stroke then gets
  // its own clean column and the residual fill patches the junction core.
  {
    const KINK_SPLIT_DEG = 25;
    const KINK_WIN_MM = 1.5;
    const ABUT_TOL_MM = Math.max(1.2, cellMm * 3);
    // Direction of travel through vertex i: sampled ~KINK_WIN_MM behind (-1)
    // or ahead (+1), so the pixel staircase can't fake a turn.
    const travelDir = (path: Path, i: number, sign: 1 | -1): [number, number] | null => {
      let dist = 0, j = i;
      while (j + sign >= 0 && j + sign < path.length && dist < KINK_WIN_MM) {
        dist += Math.hypot(path[j + sign].x - path[j].x, path[j + sign].y - path[j].y);
        j += sign;
      }
      if (j === i) return null;
      const dx = (path[j].x - path[i].x) * sign;
      const dy = (path[j].y - path[i].y) * sign;
      const l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    };
    for (let pi = 0; pi < prepped.length; pi++) {
      const p = prepped[pi];
      if (p.loop || p.straight || p.center.length < 3) continue;
      // Junction meeting points: every OTHER open branch's terminals.
      const terminals: Point[] = [];
      for (let qi = 0; qi < prepped.length; qi++) {
        const q = prepped[qi];
        if (qi === pi || q.loop) continue;
        terminals.push(q.center[0], q.center[q.center.length - 1]);
      }
      if (!terminals.length) continue;
      let splitAt = -1, worst = KINK_SPLIT_DEG;
      for (let i = 1; i < p.center.length - 1; i++) {
        const din = travelDir(p.center, i, -1);
        const dout = travelDir(p.center, i, 1);
        if (!din || !dout) continue;
        const turn = (Math.acos(Math.max(-1, Math.min(1, din[0] * dout[0] + din[1] * dout[1]))) * 180) / Math.PI;
        if (turn < worst) continue;
        const v = p.center[i];
        if (!terminals.some((t) => Math.hypot(t.x - v.x, t.y - v.y) <= ABUT_TOL_MM)) continue;
        worst = turn;
        splitAt = i;
      }
      if (splitAt < 0) continue;
      const head = p.center.slice(0, splitAt + 1);
      const tail = p.center.slice(splitAt);
      if (polylineLength(head) < MIN_BRANCH_MM || polylineLength(tail) < MIN_BRANCH_MM) continue;
      prepped[pi] = { center: maybeStraightSnap(head, !!opts.regularize), loop: false, straight: false };
      prepped[pi].straight = prepped[pi].center.length === 2;
      prepped.push({ center: maybeStraightSnap(tail, !!opts.regularize), loop: false, straight: false });
      prepped[prepped.length - 1].straight = prepped[prepped.length - 1].center.length === 2;
      pi--; // the shortened head may hide a second contested elbow
    }
  }

  // Pass 1¼ — ANNULUS detection (regularized line art only). A drawn ring — a
  // tire around its hub, a round window frame — has a circular HOLE with a
  // near-constant ink wall around it. The skeleton often chains the ring into
  // neighbouring strokes (so no single branch is the circle), but the hole
  // geometry is unambiguous: fit the hole, profile the wall by ray-casting from
  // the center, and when the wall holds its median around most of the circle,
  // sew ONE exact circular column down the wall's middle and clip every other
  // branch out of the annulus band (the ring covers it; the leftover tails are
  // re-snapped). This is what makes a wheel a complete, precise ring.
  if (opts.regularize) {
    const annulusRings: { center: Path; loop: boolean; straight: boolean }[] = [];
    for (let hi = 0; hi < oriented.length; hi++) {
      const ring = oriented[hi];
      // A hole is contained in an odd number of other rings.
      const probe = ring[0];
      let depth = 0;
      for (let j = 0; j < oriented.length; j++) {
        if (j !== hi && inside(probe.x, probe.y, [oriented[j]])) depth++;
      }
      if (depth % 2 === 0) continue;
      const fit = fitCircle(ring);
      if (!fit) continue;
      if (fit.r < CIRCLE_SNAP_MIN_R_MM || fit.r > CIRCLE_SNAP_MAX_R_MM) continue;
      const tol = Math.min(CIRCLE_SNAP_DEV_MAX_MM, Math.max(CIRCLE_SNAP_DEV_MIN_MM, fit.r * CIRCLE_SNAP_DEV_FRAC));
      if (fit.maxDev > tol) continue;
      // Wall profile: crossings along K rays from the center. The crossing
      // nearest the fitted radius is the hole edge; the next one out is the
      // outer edge of the wall (or far away, at a junction opening).
      const K = 72;
      const walls: number[] = [];
      for (let k = 0; k < K; k++) {
        const ang = (k / K) * 2 * Math.PI;
        const dir = { x: Math.cos(ang), y: Math.sin(ang) };
        const ts: number[] = [];
        for (const r2 of oriented) {
          const m = r2.length;
          for (let i = 0; i < m; i++) {
            const a = r2[i];
            const b = r2[(i + 1) % m];
            const ex = b.x - a.x;
            const ey = b.y - a.y;
            const denom = dir.x * ey - dir.y * ex;
            if (Math.abs(denom) < 1e-9) continue;
            const t = ((a.x - fit.cx) * ey - (a.y - fit.cy) * ex) / denom;
            const u = ((a.x - fit.cx) * dir.y - (a.y - fit.cy) * dir.x) / denom;
            if (t > 1e-4 && u >= -1e-6 && u <= 1 + 1e-6) ts.push(t);
          }
        }
        ts.sort((x, y) => x - y);
        let hIdx = -1;
        let hBest = Infinity;
        ts.forEach((t, i2) => {
          const d = Math.abs(t - fit.r);
          if (d < hBest) {
            hBest = d;
            hIdx = i2;
          }
        });
        walls.push(hIdx >= 0 && hBest <= tol + 0.6 && hIdx + 1 < ts.length ? ts[hIdx + 1] - ts[hIdx] : NaN);
      }
      const finite = walls.filter((x) => isFinite(x)).sort((x, y) => x - y);
      if (finite.length < K * ANNULUS_MIN_GOOD_FRAC) continue;
      const med = finite[finite.length >> 1];
      if (med < ANNULUS_WALL_MIN_MM || med > ANNULUS_WALL_MAX_MM) continue;
      const good = walls.filter((x) => isFinite(x) && Math.abs(x - med) <= Math.max(0.5, med * ANNULUS_WALL_TOL_FRAC)).length;
      if (good < K * ANNULUS_MIN_GOOD_FRAC) continue;

      annulusRings.push({ center: circlePath(fit.cx, fit.cy, fit.r + med / 2), loop: true, straight: false });

      // Clip existing branches out of the annulus band; the ring column owns it.
      const bandLo = fit.r - 0.3;
      const bandHi = fit.r + med + 0.3;
      const inBand = (p: Point) => {
        const d = Math.hypot(p.x - fit.cx, p.y - fit.cy);
        return d >= bandLo && d <= bandHi;
      };
      for (let pi = prepped.length - 1; pi >= 0; pi--) {
        const br = prepped[pi];
        if (!br.center.some(inBand)) continue;
        const dense2 = resampleByDistance(br.center, 0.4);
        const subs: Point[][] = [];
        let cur: Point[] = [];
        for (const p of dense2) {
          if (inBand(p)) {
            if (cur.length) {
              subs.push(cur);
              cur = [];
            }
          } else {
            cur.push(p);
          }
        }
        if (cur.length) subs.push(cur);
        const entries = subs
          .filter((s2) => polylineLength(s2) >= MIN_BRANCH_MM)
          .map((s2) => {
            const c2 = maybeStraightSnap(smoothPath(douglasPeucker(s2, 0.3), { maxSegmentMm: 0.8 }), true);
            return { center: c2, loop: false, straight: c2.length === 2 };
          })
          .filter((e) => e.center.length >= 2);
        prepped.splice(pi, 1, ...entries);
      }
    }
    prepped.push(...annulusRings);
  }

  // Pass 1½ — CIRCLE-SNAP + WELD (regularized line art only). A cartoon's round
  // features — tire walls, hubs, round window frames, wheel arches — skeletonize
  // into wobbly arcs, chopped wherever another stroke meets the ring. A hand
  // digitizer draws the circle. So: snap every near-circular branch onto its
  // least-squares circle, and weld arcs of the SAME circle back into one closed
  // circular stroke that sews as a single complete ring of radial satin.
  if (opts.regularize) {
    type ArcFit = { idx: number; cx: number; cy: number; r: number; n: number; bins: Uint8Array };
    const fits: ArcFit[] = [];
    prepped.forEach((p, idx) => {
      const pts = p.center;
      if (pts.length < 5) return;
      const fit = fitCircle(pts);
      if (!fit) return;
      if (fit.r < CIRCLE_SNAP_MIN_R_MM || fit.r > CIRCLE_SNAP_MAX_R_MM) return;
      const tol = Math.min(CIRCLE_SNAP_DEV_MAX_MM, Math.max(CIRCLE_SNAP_DEV_MIN_MM, fit.r * CIRCLE_SNAP_DEV_FRAC));
      if (fit.maxDev > tol) return;
      const bins = arcBins(pts, fit.cx, fit.cy);
      let span = 0;
      for (let i = 0; i < 360; i++) span += bins[i];
      if (!p.loop && span < CIRCLE_SNAP_MIN_SPAN_DEG) return; // a short chord fits any circle
      if (p.loop) {
        // A closed near-circular loop IS the circle.
        prepped[idx] = { center: circlePath(fit.cx, fit.cy, fit.r), loop: true, straight: false };
        return;
      }
      fits.push({ idx, cx: fit.cx, cy: fit.cy, r: fit.r, n: pts.length, bins });
    });

    // Group open arcs by circle identity, largest-radius first.
    fits.sort((a, b) => b.r - a.r);
    const grouped = new Set<number>();
    const drop = new Set<number>();
    for (let i = 0; i < fits.length; i++) {
      if (grouped.has(i)) continue;
      const group = [i];
      grouped.add(i);
      for (let j = i + 1; j < fits.length; j++) {
        if (grouped.has(j)) continue;
        const a = fits[i], b = fits[j];
        if (
          Math.hypot(a.cx - b.cx, a.cy - b.cy) <= Math.max(1.0, a.r * 0.15) &&
          Math.abs(a.r - b.r) <= Math.max(0.6, a.r * 0.12)
        ) {
          group.push(j);
          grouped.add(j);
        }
      }
      if (group.length < 2) continue;
      // Union coverage of the group's arcs around the (weighted) common circle.
      let wc = 0, cx = 0, cy = 0, r = 0;
      for (const g of group) {
        const f = fits[g];
        cx += f.cx * f.n; cy += f.cy * f.n; r += f.r * f.n; wc += f.n;
      }
      cx /= wc; cy /= wc; r /= wc;
      const union = new Uint8Array(360);
      for (const g of group) {
        const b = arcBins(prepped[fits[g].idx].center, cx, cy);
        for (let k = 0; k < 360; k++) if (b[k]) union[k] = 1;
      }
      let cover = 0;
      for (let k = 0; k < 360; k++) cover += union[k];
      if (cover < CIRCLE_WELD_MIN_COVER_DEG) continue;
      // Weld: the first member becomes the full circle; the rest are dropped
      // (the ring covers them, junction chops included).
      prepped[fits[group[0]].idx] = { center: circlePath(cx, cy, r), loop: true, straight: false };
      for (let k = 1; k < group.length; k++) drop.add(fits[group[k]].idx);
    }

    // Lone qualifying arcs (a wheel arch, a partial frame) snap ONTO their
    // fitted circle — perfectly round, endpoints kept on the circle at their
    // original angles, winding preserved.
    for (let i = 0; i < fits.length; i++) {
      const f = fits[i];
      if (drop.has(f.idx)) continue;
      const cur = prepped[f.idx];
      if (cur.loop) continue; // already welded to a full circle
      const pts = cur.center;
      const angOf = (p: Point) => Math.atan2(p.y - f.cy, p.x - f.cx);
      // Signed total sweep along the original polyline.
      let sweep = 0;
      for (let k = 1; k < pts.length; k++) {
        let d = angOf(pts[k]) - angOf(pts[k - 1]);
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        sweep += d;
      }
      const a0 = angOf(pts[0]);
      const steps = Math.max(4, Math.ceil((Math.abs(sweep) * f.r) / 0.8));
      const arc: Point[] = [];
      for (let s = 0; s <= steps; s++) {
        const a = a0 + (sweep * s) / steps;
        arc.push({ x: f.cx + f.r * Math.cos(a), y: f.cy + f.r * Math.sin(a) });
      }
      prepped[f.idx] = { center: arc, loop: false, straight: false };
    }

    if (drop.size) {
      for (const idx of [...drop].sort((a, b) => b - a)) prepped.splice(idx, 1);
    }
  }

  // Pass 2 — build longest-first, each MITERED against the longer strokes (the
  // multi-way junction solver: the dominant stroke runs through, branches abut).
  // Skipped for a huge auto-digitized region (many branches) where the pairwise
  // miter would be costly and crisp junctions matter less than for lettering —
  // EXCEPT for regularized line art, where clean abutment (columns that meet
  // instead of overlapping) is exactly the hand-digitized look being asked for.
  const miter = prepped.length <= MITER_MAX_BRANCHES || !!opts.regularize;
  const order = prepped
    .map((_, i) => i)
    .sort((a, b) => polylineLength(prepped[b].center) - polylineLength(prepped[a].center));
  const columns: SatinColumn[] = [];
  const higher: Path[] = [];
  for (const i of order) {
    const { center, loop, straight } = prepped[i];
    const col = buildColumn(center, loop, oriented, grid, dt, cellMm, opts, true, true, miter ? higher.slice() : [], straight);
    if (col) columns.push(col);
    if (miter) higher.push(douglasPeucker(center, 0.5));
  }
  return dedupeColumns(columns, oriented, cellMm);
}

/**
 * The cleaned medial-axis branch centerlines (mm) — the raw skeleton LIMBS, before
 * the junction mitering `medialColumns` applies to make satin strokes. A Y, a
 * starfish, a cross each yield one polyline per limb. Used by `flowFill` to flow
 * fill rows perpendicular to every limb (where `medialColumns` would collapse them
 * into one dominant stroke). Stubs shorter than `MIN_BRANCH_MM` are pruned.
 */
export function skeletonBranches(rings: Path[], opts: { cellMm?: number } = {}): Path[] {
  const cellMm = opts.cellMm ?? 0.4;
  const oriented = orientByDepth(rings);
  const grid = rasterize(oriented, cellMm);
  if (!grid) return [];
  const branches = traceSkeleton(thin(grid), grid.w, grid.h);
  const out: Path[] = [];
  for (const branch of branches) {
    if (branch.length < 2) continue;
    const raw: Point[] = branch.map(([gx, gy]) => ({
      x: grid.ox + gx * cellMm,
      y: grid.oy + gy * cellMm,
    }));
    if (polylineLength(raw) < MIN_BRANCH_MM) continue;
    const center = smoothPath(douglasPeucker(raw, cellMm * 1.2), { maxSegmentMm: 0.8 });
    if (center.length >= 2) out.push(center);
  }
  return out;
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
  straightBar = false,
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
  // A STRAIGHT-SNAPPED auto branch is a straight BAR (a ladder rail, a rung, a
  // window mullion): its true width is constant, and the per-sample DT widths
  // only carry the trace's boundary noise into the rails. Flatten to the
  // median so both rails come out dead straight and parallel. (Authored font
  // strokes never take this path — their width variation is deliberate.)
  if (straightBar && medHalfDt > 0) {
    halves = halves.map(() => medHalfDt + OVERSHOOT_MM);
  }
  // Regularized LINE ART holds every stroke near constant width: a cartoon's pen
  // line doesn't bead and pinch — that's the trace talking. Clamp the width
  // profile to a narrow band around the column's own median so the satin edge
  // draws the line the artist meant. (Genuine junction balloons were already
  // capped above; genuine terminal tapers get trimmed/extended below.)
  const regularBand = opts.regularize && medHalfDt > 0;
  if (regularBand && !straightBar) {
    const lo = medHalfDt * REGULARIZE_WIDTH_LO;
    const hi = medHalfDt * REGULARIZE_WIDTH_HI;
    halves = halves.map((h) => Math.min(hi, Math.max(lo, h - OVERSHOOT_MM)) + OVERSHOOT_MM);
  }

  // Drop junction-stub branches: the little segment at the very center of a Y
  // (a meeting R's stem, bowl and leg) is short and as wide as it is long, not a
  // real stroke. Satining it casts a spray of crossing throws. If a branch isn't
  // elongated (length < ~1.4× its own width) skip it — the strokes that cross
  // the junction already cover that patch. (Loops are always real; authored
  // strokes are trusted.)
  //
  // CRUCIAL REFINEMENT: the length test alone misfires on SHORT REAL STROKES.
  // A T's crossbar or a serif is only ~1.5–2× as long as it is wide, and the
  // junction balloon inflates the median width, so the naive test read it as a
  // stub and silently dropped a third of the letter (coverage then failed and
  // the whole glyph fell back to chewed tatami). The reliable distinction: a
  // real stroke has at least one FREE TERMINAL at the glyph outline, where the
  // width pinches back to the stroke's own half — a junction-center stub is
  // ballooned at BOTH ends. Only drop when both ends are fat.
  if (dropStubs && !loop && medHalfDt > 0 && polylineLength(center) < 2 * medHalfDt * 1.4) {
    // Robust "true stroke half": the lean quartile, immune to junction bloat.
    const leanHalf = dtHalves[Math.floor(dtHalves.length * 0.25)] ?? medHalfDt;
    const endFat = (i: number) => halves[i] - OVERSHOOT_MM > leanHalf * 1.3;
    if (endFat(0) && endFat(halves.length - 1)) return null;
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
          // Extend with a CHAIN at the column's own sampling step, not a single
          // far tip point. One point left a single long end segment, so the
          // throw selector placed ONE over-wide row across the whole cap
          // (pitch opened 0.38 → 0.65–1.0 mm at measured glyph terminals — a
          // bare band at every stroke end). Chained samples keep cap rows at
          // normal pitch right through the terminal.
          const end = { x: dense[i0].x, y: dense[i0].y };
          const h0 = atStart ? halves[0] : halves[halves.length - 1];
          const step = Math.max(0.05, density / 4);
          const n = Math.max(1, Math.ceil(ext / step));
          for (let k = 1; k <= n; k++) {
            const d = (ext * k) / n;
            const p = { x: end.x + ux * d, y: end.y + uy * d };
            if (atStart) {
              dense.unshift(p); // increasing d unshifts → the tip lands at index 0
              halves.unshift(h0);
            } else {
              dense.push(p);
              halves.push(h0);
            }
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
    // Regularized line art: the ray landed on the trace's noisy edge — clamp each
    // rail into the constant-width band so the satin edge stays a clean pen line
    // (the miter below still pulls a rail back where columns meet).
    if (regularBand) {
      const rLo = medHalfDt * REGULARIZE_WIDTH_LO + comp;
      const rHi = medHalfDt * REGULARIZE_WIDTH_HI + OVERSHOOT_MM + comp;
      halfL = Math.min(rHi, Math.max(rLo, halfL));
      halfR = Math.min(rHi, Math.max(rLo, halfR));
    }
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
  return { centerline: center, throws: capped, widthMm, left, right };
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
export function residualRegions(rings: Path[], sewn: Path[], cellMm = 0.3, minAreaMm2?: number): Path[] {
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

  // Default floor ignores inter-row specks; a caller chasing bare TIPS (a
  // pennant's point beyond a turned fill's last row) may lower it.
  const minArea = minAreaMm2 ?? Math.max(2.2, (3 * cellMm) ** 2);
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

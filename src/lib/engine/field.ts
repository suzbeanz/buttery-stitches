import type { Path, Point } from "../../types/project";
import { orientByDepth, principalAxis, MIN_FILL_DENSITY, FILL_STITCH_LENGTH, type FillOptions } from "./fill";
import { rasterize, type Grid } from "./medial";

/**
 * GUIDANCE-FIELD FILL (prototype) — rows follow a solved direction field instead
 * of a fixed angle or a single medial spine.
 *
 * The form is swept by a harmonic potential `u`: u=0 at one end cap, u=1 at the
 * other, with insulating (Neumann) sides. Laplace's equation makes `u` increase
 * smoothly ALONG the form and bend around concavities, so its level sets (isolines
 * of constant u) are clean cross-sections of the shape — exactly the fill rows a
 * master digitizer turns by hand. Rows are spaced by `density·|∇u|` so the mm gap
 * between them stays even even though |∇u| varies. Generalises turning + flow
 * (one spine / many limbs) into a single solved field, and — because the Dirichlet
 * caps sit AT the ends — it fills the end caps the spine-march leaves bare.
 *
 * v1: raster solve (SOR) + masked marching-squares isolines + end extension to the
 * boundary. Returns serpentine runs (u-ordered) like turningFill/flowFill, or null
 * when it can't seat a clean field (caller falls back to tatami).
 */

const SOLVE_CELL_MM = 0.6; // working raster for the potential solve
const SOR_OMEGA = 1.8; // over-relaxation factor (Laplace converges ~10× faster)
const SOLVE_MAX_ITERS = 4000;
const SOLVE_EPS = 1e-4; // max per-cell change to declare convergence
/** Boundary cells whose axis-projection falls in the extreme CAP_FRAC of the span
 *  become the Dirichlet end caps (u=0 / u=1). */
const CAP_FRAC = 0.12;
const MIN_FIELD_EXTENT_MM = 10; // below this a field fill isn't worth it

interface Field {
  g: Grid;
  u: Float32Array; // potential in [0,1] on inside cells (NaN outside)
}

function idx(g: Grid, x: number, y: number): number {
  return y * g.w + x;
}

/** Solve the harmonic sweep potential. Dirichlet caps from the PCA-axis extremes,
 *  Neumann (insulating) on every other boundary. Returns null if degenerate. */
function solvePotential(rings: Path[]): Field | null {
  const g = rasterize(rings, SOLVE_CELL_MM);
  if (!g) return null;
  const { w, h, cells } = g;

  // Axis to sweep along: the shape's principal (long) axis.
  const outer = rings.reduce((a, b) => (b.length > a.length ? b : a));
  const { angleDeg } = principalAxis(outer);
  const ax = Math.cos((angleDeg * Math.PI) / 180);
  const ay = Math.sin((angleDeg * Math.PI) / 180);

  // Project every inside cell onto the axis; the extremes define the two caps.
  let pmin = Infinity, pmax = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!cells[idx(g, x, y)]) continue;
      const mx = g.ox + x * g.cellMm, my = g.oy + y * g.cellMm;
      const p = mx * ax + my * ay;
      if (p < pmin) pmin = p;
      if (p > pmax) pmax = p;
    }
  }
  const span = pmax - pmin;
  if (!Number.isFinite(span) || span < MIN_FIELD_EXTENT_MM) return null;

  // A cell is "boundary" if it has a non-inside 4-neighbour. Cap cells are
  // boundary cells whose projection sits in the extreme CAP_FRAC of the span.
  const u = new Float32Array(w * h).fill(NaN);
  const fixed = new Uint8Array(w * h);
  const loProj = pmin + CAP_FRAC * span;
  const hiProj = pmax - CAP_FRAC * span;
  let loCount = 0, hiCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(g, x, y);
      if (!cells[i]) continue;
      u[i] = 0.5; // initial guess inside
      const boundary =
        !cells[idx(g, x - 1, y)] || !cells[idx(g, x + 1, y)] ||
        !cells[idx(g, x, y - 1)] || !cells[idx(g, x, y + 1)];
      if (!boundary) continue;
      const mx = g.ox + x * g.cellMm, my = g.oy + y * g.cellMm;
      const p = mx * ax + my * ay;
      if (p <= loProj) { u[i] = 0; fixed[i] = 1; loCount++; }
      else if (p >= hiProj) { u[i] = 1; fixed[i] = 1; hiCount++; }
    }
  }
  if (loCount === 0 || hiCount === 0) return null;

  // SOR relaxation. Neumann sides: average over INSIDE neighbours only, so no
  // flux leaves the long edges and the sweep runs cap-to-cap.
  for (let iter = 0; iter < SOLVE_MAX_ITERS; iter++) {
    let maxDelta = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = idx(g, x, y);
        if (!cells[i] || fixed[i]) continue;
        let sum = 0, n = 0;
        const il = idx(g, x - 1, y), ir = idx(g, x + 1, y);
        const it = idx(g, x, y - 1), ib = idx(g, x, y + 1);
        if (cells[il]) { sum += u[il]; n++; }
        if (cells[ir]) { sum += u[ir]; n++; }
        if (cells[it]) { sum += u[it]; n++; }
        if (cells[ib]) { sum += u[ib]; n++; }
        if (n === 0) continue;
        const target = sum / n;
        const next = u[i] + SOR_OMEGA * (target - u[i]);
        const d = Math.abs(next - u[i]);
        if (d > maxDelta) maxDelta = d;
        u[i] = next;
      }
    }
    if (maxDelta < SOLVE_EPS) break;
  }
  return { g, u };
}

/** Bilinear-ish gradient magnitude of u at inside cell (central differences). */
function gradMag(f: Field, x: number, y: number): number {
  const { g, u } = f;
  const c = u[idx(g, x, y)];
  const sample = (xx: number, yy: number) => {
    const i = idx(g, xx, yy);
    return g.cells[i] ? u[i] : c; // reflect at boundary
  };
  const dx = (sample(x + 1, y) - sample(x - 1, y)) / 2;
  const dy = (sample(x, y + 1) - sample(x, y - 1)) / 2;
  return Math.hypot(dx, dy) / g.cellMm; // per mm
}

/** Marching-squares isoline at `level`, restricted to fully-inside cells so the
 *  segments are interior cross-sections (open polylines, chained). */
function isoline(f: Field, level: number): Path[] {
  const { g, u } = f;
  const segs: [Point, Point][] = [];
  const at = (x: number, y: number): Point => ({ x: g.ox + x * g.cellMm, y: g.oy + y * g.cellMm });
  const lerp = (a: Point, b: Point, ua: number, ub: number): Point => {
    const t = (level - ua) / (ub - ua || 1e-9);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  for (let y = 0; y < g.h - 1; y++) {
    for (let x = 0; x < g.w - 1; x++) {
      const i00 = idx(g, x, y), i10 = idx(g, x + 1, y), i11 = idx(g, x + 1, y + 1), i01 = idx(g, x, y + 1);
      if (!g.cells[i00] || !g.cells[i10] || !g.cells[i11] || !g.cells[i01]) continue;
      const u00 = u[i00], u10 = u[i10], u11 = u[i11], u01 = u[i01];
      let code = 0;
      if (u00 > level) code |= 1;
      if (u10 > level) code |= 2;
      if (u11 > level) code |= 4;
      if (u01 > level) code |= 8;
      if (code === 0 || code === 15) continue;
      const p00 = at(x, y), p10 = at(x + 1, y), p11 = at(x + 1, y + 1), p01 = at(x, y + 1);
      const eB = () => lerp(p00, p10, u00, u10); // bottom edge (y)
      const eR = () => lerp(p10, p11, u10, u11); // right edge
      const eT = () => lerp(p01, p11, u01, u11); // top edge
      const eL = () => lerp(p00, p01, u00, u01); // left edge
      const push = (a: Point, b: Point) => segs.push([a, b]);
      switch (code) {
        case 1: case 14: push(eL(), eB()); break;
        case 2: case 13: push(eB(), eR()); break;
        case 3: case 12: push(eL(), eR()); break;
        case 4: case 11: push(eR(), eT()); break;
        case 6: case 9: push(eB(), eT()); break;
        case 7: case 8: push(eL(), eT()); break;
        case 5: push(eL(), eT()); push(eB(), eR()); break; // saddle
        case 10: push(eL(), eB()); push(eR(), eT()); break; // saddle
      }
    }
  }
  return chain(segs, g.cellMm * 0.5);
}

/** Chain unordered segments into polylines by endpoint proximity. */
function chain(segs: [Point, Point][], tol: number): Path[] {
  const key = (p: Point) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const ends = new Map<string, { seg: number; end: 0 | 1 }[]>();
  const used = new Uint8Array(segs.length);
  segs.forEach((s, i) => {
    for (const end of [0, 1] as const) {
      const k = key(s[end]);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k)!.push({ seg: i, end });
    }
  });
  const out: Path[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const poly: Point[] = [segs[i][0], segs[i][1]];
    // extend forward
    for (let guard = 0; guard < segs.length; guard++) {
      const tail = poly[poly.length - 1];
      const cands = ends.get(key(tail)) ?? [];
      let found = -1, fend: 0 | 1 = 0;
      for (const c of cands) {
        if (!used[c.seg]) { found = c.seg; fend = c.end; break; }
      }
      if (found < 0) break;
      used[found] = 1;
      poly.push(segs[found][fend === 0 ? 1 : 0]);
    }
    if (poly.length >= 2) out.push(poly);
  }
  return out;
}

function polylineLen(p: Path): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return L;
}

/** Is the mm point inside the rasterized region (coarse, cell-rounded)? */
function insideGrid(f: Field, p: Point): boolean {
  const gx = Math.round((p.x - f.g.ox) / f.g.cellMm);
  const gy = Math.round((p.y - f.g.oy) / f.g.cellMm);
  return gx >= 0 && gx < f.g.w && gy >= 0 && gy < f.g.h && !!f.g.cells[gy * f.g.w + gx];
}

/** Walk from `a` along unit `dir` while still inside, returning the last inside
 *  point (so the row reaches the true boundary the masked isoline stops short of).
 *  `extra` mm past the edge gives pull compensation. */
function marchOut(f: Field, a: Point, dir: Point, maxMm: number, extra: number): Point {
  const step = f.g.cellMm * 0.5;
  let last = a;
  for (let d = step; d <= maxMm; d += step) {
    const p = { x: a.x + dir.x * d, y: a.y + dir.y * d };
    if (insideGrid(f, p)) last = p;
    else return { x: last.x + dir.x * extra, y: last.y + dir.y * extra };
  }
  return last;
}

/** Extend both ends of an isoline out to the region boundary (+pull comp). */
function extendEnds(f: Field, poly: Path, extra: number): Path {
  if (poly.length < 2) return poly;
  const unit = (from: Point, to: Point): Point => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const L = Math.hypot(dx, dy) || 1;
    return { x: dx / L, y: dy / L };
  };
  const headDir = unit(poly[1], poly[0]);
  const tailDir = unit(poly[poly.length - 2], poly[poly.length - 1]);
  const head = marchOut(f, poly[0], headDir, 4, extra);
  const tail = marchOut(f, poly[poly.length - 1], tailDir, 4, extra);
  return [head, ...poly, tail];
}

/** Median |∇u| (per mm) sampled along an isoline — sets the next level step. */
function medianGradAlong(f: Field, poly: Path): number {
  const gs: number[] = [];
  for (const p of poly) {
    const gx = Math.round((p.x - f.g.ox) / f.g.cellMm);
    const gy = Math.round((p.y - f.g.oy) / f.g.cellMm);
    if (gx > 0 && gx < f.g.w - 1 && gy > 0 && gy < f.g.h - 1 && f.g.cells[idx(f.g, gx, gy)]) {
      gs.push(gradMag(f, gx, gy));
    }
  }
  if (gs.length === 0) return 0;
  gs.sort((a, b) => a - b);
  return gs[gs.length >> 1];
}

/** Resample a polyline into EQUAL-length segments (~step), endpoints exact. Even
 *  division avoids a short leftover tail on every row (which otherwise shows up as
 *  one sub-min stitch per row — the dominant short-stitch source). */
function resample(poly: Path, step: number): Path {
  if (poly.length < 2) return poly;
  const L = polylineLen(poly);
  if (L < 1e-6) return [poly[0], poly[poly.length - 1]];
  const n = Math.max(1, Math.ceil(L / step)); // ceil so no segment exceeds stitch length
  const seg = L / n;
  const out: Point[] = [poly[0]];
  let i = 1;
  let a = poly[0];
  let rem = Math.hypot(poly[1].x - poly[0].x, poly[1].y - poly[0].y);
  for (let k = 1; k < n; k++) {
    let dist = seg;
    while (dist > rem && i < poly.length - 1) {
      dist -= rem;
      a = poly[i];
      i++;
      rem = Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
    }
    const b = poly[i];
    const t = rem > 1e-9 ? dist / rem : 0;
    a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    out.push(a);
    rem -= dist;
  }
  out.push(poly[poly.length - 1]);
  return out;
}

/**
 * Guidance-field fill. Returns serpentine rows along the harmonic isolines, or
 * null when the shape can't seat a clean field (caller falls back to tatami).
 */
export function guidanceFieldFill(rings: Path[], opts: FillOptions): Path[] | null {
  const oriented = orientByDepth(rings);
  if (oriented.length === 0 || oriented[0].length < 3) return null;
  const f = solvePotential(oriented);
  if (!f) return null;

  const density = Math.max(MIN_FILL_DENSITY, opts.density);
  const stitch = opts.stitchLength ?? FILL_STITCH_LENGTH;

  // Connect consecutive rows into ONE serpentine run (like turningFill) so the
  // assembler doesn't stitch up-to-travelMax hops between hundreds of tiny runs
  // (those showed up as >4mm connectors AND sub-0.3mm pile-ups). Break the run
  // only when the next row is a real gap away (a concavity/hole) — then the engine
  // jumps/trims instead of slashing. Dedup kills near-coincident pile-ups.
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const CONNECT_MAX_MM = Math.max(2, density * 4);
  const DEDUP_MM = Math.min(0.3, density * 0.6);
  const runs: Path[] = [];
  let current: Point[] = [];
  const flush = () => {
    if (current.length >= 2) runs.push(current);
    current = [];
  };
  const pushPt = (p: Point) => {
    const last = current[current.length - 1];
    if (!last || dist(last, p) >= DEDUP_MM) current.push(p);
  };

  let level = 0;
  let guard = 0;
  while (level < 1 && guard++ < 10000) {
    const loops = isoline(f, level).filter((p) => polylineLen(p) >= density);
    loops.sort((a, b) => polylineLen(b) - polylineLen(a));
    let stepGrad = 0;
    for (const loop of loops) {
      const mg = medianGradAlong(f, loop);
      if (mg > stepGrad) stepGrad = mg;
      let row = resample(extendEnds(f, loop, opts.pullCompMm ?? 0), stitch);
      if (row.length < 2) continue;
      const tail = current[current.length - 1];
      if (tail) {
        if (dist(tail, row[row.length - 1]) < dist(tail, row[0])) row = row.slice().reverse();
        if (dist(tail, row[0]) > CONNECT_MAX_MM) flush(); // real gap → break, don't slash
      }
      for (const p of row) pushPt(p);
    }
    // Adaptive step: advance so consecutive isolines are ~density apart in mm
    // (Δlevel = density · |∇u|). Tiny floor only guarantees progress.
    const dLevel = stepGrad > 1e-6 ? density * stepGrad : 0.05;
    level += Math.max(dLevel, 0.0008);
  }
  flush();
  if (runs.length === 0) return null;

  // Self-validate coverage cheaply: a clean fill lays ≈ area/density mm of thread.
  // A degenerate solve (ambiguous caps on a near-round shape, a field that didn't
  // sweep the whole form) lays far less — reject it so the caller keeps its
  // turning/tatami result instead of a gappy field.
  let insideCells = 0;
  for (let i = 0; i < f.g.cells.length; i++) insideCells += f.g.cells[i];
  const areaMm2 = insideCells * f.g.cellMm * f.g.cellMm;
  const laid = runs.reduce((s, r) => s + polylineLen(r), 0);
  if (areaMm2 > 0 && laid < 0.7 * (areaMm2 / density)) return null;
  return runs;
}

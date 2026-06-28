import type { Path, Point } from "../../types/project";
import { distance, polylineLength } from "../geometry";
import { resampleByCount, splitThrow } from "./resample";

/**
 * Assemble an ordered list of satin throws (each a `[fromRail, toRail]` pair) into
 * one zig-zag penetration path, splitting any throw longer than `maxLen` and
 * brick-staggering the splits so a wide ("split satin") column shows no seam and a
 * sharp-corner diagonal is tacked down rather than left loose. The leading rail
 * already alternates in `pairs`, so the down-rail travel between throws is implicit
 * (and short). Shared by hand-drawn, medial, and column-scan satin.
 */
export function staggeredSatin(pairs: [Point, Point][], maxLen: number, scatter = false): Path {
  const out: Point[] = [];
  pairs.forEach(([a, b], k) => {
    const shift = scatter ? scatterShift(k) : undefined;
    for (const p of splitThrow(a, b, maxLen, k % 2, shift)) out.push(p);
  });
  return out;
}

/** Deterministic per-throw shift in [0.15, 0.85) so split breaks scatter across
 *  throws (kills the seam) yet the design is fully reproducible. */
function scatterShift(k: number): number {
  const s = Math.sin((k + 1) * 12.9898) * 43758.5453;
  return 0.15 + (s - Math.floor(s)) * 0.7;
}

/** Inset fraction (toward the column center) for a shortened inner-curve stitch. */
const SHORT_STITCH_INSET = 0.4;
/** Trigger short stitches when one rail's local gap is below this fraction of the
 *  other's — i.e. a real concave bend, not a straight run. */
const SHORT_STITCH_RATIO = 0.6;

/**
 * "Short stitches" on the inside of a curve. Where one rail advances much less
 * than the other (the concave/inner edge of a bend), pull every other inner
 * endpoint in toward the column center so the inner penetrations spread out
 * instead of piling into a hard ridge — the classic satin-curve smoothing a
 * digitizer does by hand. Operates on matched rail points (before the zig-zag
 * alternation); the two ends are never shortened. Straight columns (equal rail
 * gaps) are returned untouched.
 */
export function shortStitchPairs(ls: Point[], rs: Point[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (let k = 0; k < ls.length; k++) {
    let l = ls[k];
    let r = rs[k];
    if (k > 0 && k < ls.length - 1 && k % 2 === 1) {
      const gapL = distance(ls[k], ls[k - 1]);
      const gapR = distance(rs[k], rs[k - 1]);
      if (gapL > 1e-6 && gapR > 1e-6) {
        if (gapL < gapR * SHORT_STITCH_RATIO) {
          l = { x: l.x + (r.x - l.x) * SHORT_STITCH_INSET, y: l.y + (r.y - l.y) * SHORT_STITCH_INSET };
        } else if (gapR < gapL * SHORT_STITCH_RATIO) {
          r = { x: r.x + (l.x - r.x) * SHORT_STITCH_INSET, y: r.y + (l.y - r.y) * SHORT_STITCH_INSET };
        }
      }
    }
    out.push([l, r]);
  }
  return out;
}

/** Median of a numeric list (robust "typical" value); 0 for an empty list. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export interface SatinOptions {
  /** mm between zig-zag rows */
  density: number;
  /** mm added to the column width to compensate for fabric pull-in */
  pullComp: number;
  /** mm trimmed off EACH end to compensate for lengthwise fabric push (open
   *  columns only — a closed ring has no ends). */
  push?: number;
  /** widths above this (mm) are too long for a single satin throw */
  maxWidth?: number;
}

/** Largest column width before a satin stitch should really be a fill. */
export const SATIN_MAX_WIDTH = 7;

/** Smallest width (mm) a satin column can actually sew. Below this the two rails
 *  fall in nearly the same needle holes — the column sews skinny, leaves no cover,
 *  and shreds thread. Throws narrower than this are widened out to it (per side),
 *  so a thin spot fills solid instead of breaking. Columns thin along their whole
 *  length are routed to a running/bean line upstream by the type classifier. */
export const MIN_SEWABLE_SATIN_WIDTH = 1.0;

/** Row-gap floor (mm) for auto-spacing — matches the engine's machine-safety
 *  density floor, so tightening wide columns never bunches thread. */
const SATIN_DENSITY_FLOOR = 0.36;
/** Below this width (mm) the drawn density is kept as-is (narrow/mid columns are
 *  already well covered and are what the safety tests pin down). */
const AUTO_DENSITY_MIN_WIDTH = 4;

/**
 * Auto-spacing: a wider satin column needs denser rows to cover fully (AmeFird —
 * density rises with width). Columns up to {@link AUTO_DENSITY_MIN_WIDTH} mm keep
 * the drawn gap; wider ones tighten toward a floor. Never looser than asked,
 * never tighter than the safe floor.
 */
export function autoSatinDensity(baseDensity: number, widthMm: number): number {
  const w = Math.max(0, widthMm);
  if (w <= AUTO_DENSITY_MIN_WIDTH) return baseDensity;
  const factor = Math.max(0.85, 1 - 0.04 * (w - AUTO_DENSITY_MIN_WIDTH));
  // Floor at the safe gap, but never LOOSEN a user who already set it tighter
  // than the floor (the engine's own MIN_SAFE_DENSITY still guards the hard min).
  const floor = Math.min(baseDensity, SATIN_DENSITY_FLOOR);
  return Math.max(floor, Math.min(baseDensity, baseDensity * factor));
}

/** Walk `by` mm in from the start of an open polyline; returns the shortened
 *  remainder (≥2 pts). If `by` ≥ the whole length the path is left untouched. */
function trimStart(path: Path, by: number): Path {
  if (by <= 0 || path.length < 2) return path;
  let rem = by;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = distance(path[i], path[i + 1]);
    if (seg >= rem) {
      const t = rem / (seg || 1);
      const cut = {
        x: path[i].x + (path[i + 1].x - path[i].x) * t,
        y: path[i].y + (path[i + 1].y - path[i].y) * t,
      };
      return [cut, ...path.slice(i + 1)];
    }
    rem -= seg;
  }
  return path;
}

/** Trim `by` mm off both ends of an open polyline (push compensation). */
function trimEnds(path: Path, by: number): Path {
  const a = trimStart(path, by);
  const b = trimStart([...a].reverse(), by).reverse();
  return b.length >= 2 ? b : path;
}

/** A rail that returns (near) to its start is a closed loop (e.g. letter "o"); it
 *  has no ends to push-compensate. */
function isClosedRail(p: Path): boolean {
  return p.length > 2 && distance(p[0], p[p.length - 1]) < 0.5;
}

/** A throw longer than this multiple of the column's median width is split. */
const CORNER_SPLIT_RATIO = 1.4;
/** Never split below this (mm) — keeps narrow columns from over-splitting. */
const MIN_SPLIT_CAP_MM = 1.5;

/** Pull-compensation tuning (docs/stitch-logic.md §6) — total mm a column is
 *  widened so the sewn column matches the drawn one. Wider columns gather the
 *  fabric more, so the comp grows with width, clamped to a sane band. */
const PULL_BASE_MM = 0.1;
const PULL_PER_WIDTH = 0.12;
const PULL_MIN_MM = 0.2;
const PULL_MAX_MM = 0.7;

/**
 * Automatic pull compensation (total mm, split across the two rails) for a satin
 * column of the given width. Stitches pull the fabric toward the line of
 * stitching, so a column sews narrower than drawn — and the wider the column the
 * more it pulls in. `scale` carries the fabric multiplier (knits pull more).
 */
export function autoPullCompMm(widthMm: number, scale = 1): number {
  const raw = PULL_BASE_MM + PULL_PER_WIDTH * Math.max(0, widthMm);
  return Math.max(PULL_MIN_MM, Math.min(PULL_MAX_MM, raw)) * Math.max(0, scale);
}

function widen(l: Point, r: Point, by: number): [Point, Point] {
  const d = distance(l, r) || 1;
  const ux = (r.x - l.x) / d;
  const uy = (r.y - l.y) / d;
  const h = by / 2;
  return [
    { x: l.x - ux * h, y: l.y - uy * h },
    { x: r.x + ux * h, y: r.y + uy * h },
  ];
}

/**
 * Satin column: given a left/right rail pair, lay zig-zag throws across with
 * DENSITY COMPENSATION on curves — sample both rails finely, then place a throw
 * only after whichever rail (the outer one through a bend) has advanced a full
 * `density`, so the convex edge stays evenly covered instead of fanning into
 * gaps and the concave edge packs tighter. Pull compensation widens the column;
 * wide ("split satin") columns and long skewed corner throws are split into
 * staggered sub-stitches (mitering) so no single stitch snags or sits loose.
 */
export function satinColumn(
  left: Path,
  right: Path,
  { density, pullComp, push = 0, maxWidth = SATIN_MAX_WIDTH }: SatinOptions,
): Path {
  if (left.length < 2 || right.length < 2) return [];

  // Push compensation: shorten the column's ends so the fabric's lengthwise push
  // doesn't overshoot the drawn shape. Skip closed rings (no ends).
  const closed = isClosedRail(left) || isClosedRail(right);
  const L = push > 0 && !closed ? trimEnds(left, push) : left;
  const R = push > 0 && !closed ? trimEnds(right, push) : right;

  // Estimate the column width to auto-tighten spacing on wide columns.
  const wn = 8;
  const lw = resampleByCount(L, wn);
  const rw = resampleByCount(R, wn);
  let wsum = 0;
  for (let i = 0; i < wn; i++) wsum += distance(lw[i], rw[i]);
  const step = Math.max(0.05, autoSatinDensity(density, wsum / wn));

  // Dense, matched samples down both rails.
  const len = (polylineLength(L) + polylineLength(R)) / 2;
  const dense = Math.max(2, Math.round(len / (step / 4)) + 1);
  const lp = resampleByCount(L, dense);
  const rp = resampleByCount(R, dense);

  // Choose throw positions so neither rail's gap between throws exceeds density.
  const idx: number[] = [0];
  let last = 0;
  for (let i = 1; i < dense; i++) {
    const dl = distance(lp[i], lp[last]);
    const dr = distance(rp[i], rp[last]);
    if (Math.max(dl, dr) >= step) {
      idx.push(i);
      last = i;
    }
  }
  if (idx[idx.length - 1] !== dense - 1) idx.push(dense - 1);

  // Matched rail points at each throw, widened for pull compensation.
  const wl: Point[] = [];
  const wr: Point[] = [];
  for (const i of idx) {
    // Pull comp widens by `pullComp`; below the sewable floor, widen further so the
    // throw lands at least MIN_SEWABLE_SATIN_WIDTH across (no effect on wide columns,
    // where the floor term is negative). `widen` no-ops on a degenerate (~0) width,
    // so a true taper tip isn't blunted — only thin-but-real spots fill out.
    const w = distance(lp[i], rp[i]);
    const add = Math.max(pullComp, MIN_SEWABLE_SATIN_WIDTH - w);
    const [l, r] = add > 0 ? widen(lp[i], rp[i], add) : [lp[i], rp[i]];
    wl.push(l);
    wr.push(r);
  }
  // Short stitches smooth the inside of any curve, then alternate the leading
  // rail so the throws chain into a zig-zag.
  const short = shortStitchPairs(wl, wr);
  const pairs: [Point, Point][] = short.map(([l, r], k) => (k % 2 === 0 ? [l, r] : [r, l]));

  // Split cap relative to the column's TYPICAL width: a throw much longer than
  // that is either a genuinely wide column (split satin) or a skewed diagonal
  // thrown across a sharp corner — both should break into staggered sub-stitches
  // (miter the corner), while a straight or gently curved throw stays whole. The
  // splits are scattered per-throw so wide columns show no seam.
  const medianW = median(pairs.map(([a, b]) => distance(a, b)));
  const cap = Math.min(maxWidth, Math.max(medianW * CORNER_SPLIT_RATIO, MIN_SPLIT_CAP_MM));
  return staggeredSatin(pairs, cap, true);
}

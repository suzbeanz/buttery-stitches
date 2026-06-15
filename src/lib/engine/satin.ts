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
export function staggeredSatin(pairs: [Point, Point][], maxLen: number): Path {
  const out: Point[] = [];
  pairs.forEach(([a, b], k) => {
    for (const p of splitThrow(a, b, maxLen, k % 2)) out.push(p);
  });
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
  /** widths above this (mm) are too long for a single satin throw */
  maxWidth?: number;
}

/** Largest column width before a satin stitch should really be a fill. */
export const SATIN_MAX_WIDTH = 7;

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
  { density, pullComp, maxWidth = SATIN_MAX_WIDTH }: SatinOptions,
): Path {
  if (left.length < 2 || right.length < 2) return [];
  const step = Math.max(0.05, density);

  // Dense, matched samples down both rails.
  const len = (polylineLength(left) + polylineLength(right)) / 2;
  const dense = Math.max(2, Math.round(len / (step / 4)) + 1);
  const lp = resampleByCount(left, dense);
  const rp = resampleByCount(right, dense);

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

  const pairs: [Point, Point][] = idx.map((i, k) => {
    let [l, r] = [lp[i], rp[i]];
    if (pullComp > 0) [l, r] = widen(l, r, pullComp);
    // Alternate the leading rail each throw so they chain into a zig-zag.
    return k % 2 === 0 ? [l, r] : [r, l];
  });

  // Split cap relative to the column's TYPICAL width: a throw much longer than
  // that is either a genuinely wide column (split satin) or a skewed diagonal
  // thrown across a sharp corner — both should break into staggered sub-stitches
  // (miter the corner), while a straight or gently curved throw stays whole.
  const medianW = median(pairs.map(([a, b]) => distance(a, b)));
  const cap = Math.min(maxWidth, Math.max(medianW * CORNER_SPLIT_RATIO, MIN_SPLIT_CAP_MM));
  return staggeredSatin(pairs, cap);
}

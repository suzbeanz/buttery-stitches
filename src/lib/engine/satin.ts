import type { Path, Point } from "../../types/project";
import { distance, polylineLength } from "../geometry";
import { resampleByCount, splitThrow } from "./resample";

/**
 * Assemble an ordered list of satin throws (each a `[fromRail, toRail]` pair) into
 * one penetration path, splitting any throw longer than `maxLen` and
 * brick-staggering the splits so a wide ("split satin") column shows no seam and a
 * sharp-corner diagonal is tacked down rather than left loose.
 *
 * Two chaining modes:
 *  - `zigzag: false` (legacy — underlay/fill callers): the leading rail already
 *    alternates in `pairs`, so the down-rail travel between throws is implicit
 *    (and short). The thread crosses the column ONCE per pair and walks the rail
 *    between crossings — an open meander, right for a stabilizing pass.
 *  - `zigzag: true` (top satin): `pairs` arrive in canonical `[left, right]`
 *    order and the RETURN between consecutive pairs is emitted as a crossing
 *    stitch too (`right[k] → left[k+1]`), so EVERY segment crosses the column —
 *    the commercial satin topology. The decoded reference designs sew
 *    {@link REF_SATIN_CROSSING_FRACTION} of their satin segments as full
 *    crossings; the legacy meander crossed only half as often for the same
 *    penetration count, wasting the other half of the thread on little bars
 *    along the rails — the sewn column showed ground between its throws and a
 *    stitchy, busy edge (the "scraggly, uneven" look).
 */
export function staggeredSatin(
  pairs: [Point, Point][],
  maxLen: number,
  { scatter = false, zigzag = false }: { scatter?: boolean; zigzag?: boolean } = {},
): Path {
  const out: Point[] = [];
  if (!zigzag) {
    pairs.forEach(([a, b], k) => {
      const shift = scatter ? scatterShift(k) : undefined;
      for (const p of splitThrow(a, b, maxLen, k % 2, shift)) out.push(p);
    });
    return out;
  }
  if (pairs.length === 0) return out;
  let k = 0;
  const emit = (a: Point, b: Point, skipFirst: boolean): void => {
    const shift = scatter ? scatterShift(k) : undefined;
    const pts = splitThrow(a, b, maxLen, k % 2, shift);
    for (let i = skipFirst ? 1 : 0; i < pts.length; i++) out.push(pts[i]);
    k++;
  };
  emit(pairs[0][0], pairs[0][1], false);
  for (let i = 1; i < pairs.length; i++) {
    emit(pairs[i - 1][1], pairs[i][0], true); // the return — a crossing, not a rail walk
    emit(pairs[i][0], pairs[i][1], true);
  }
  return out;
}

/** Fraction of a commercial satin stretch's segments that fully CROSS the
 *  column (single-segment throws over consecutive-reversal windows, measured on
 *  the decoded reference designs: 338/341 on the densest lettering-and-border
 *  design, 126/130 on the curved-tail cartoon). Our satin must sew the same
 *  all-crossings topology. */
export const REF_SATIN_CROSSING_FRACTION = 0.95;

/** Same-rail advance (mm) below which a spoke re-punches the previous hole.
 *  Set at needle-hole scale (a hole is ~0.1mm): this catches the anti-crossing
 *  pins (0.05mm forced advance) and exact pivot shares, while the inside of a
 *  packed curve (0.15-0.3mm advance — legitimate density compensation) keeps
 *  every penetration; insetting those opened bare slits on a rounded band
 *  (measured 4.9% bare interior on the C-band fixture at a 0.3mm trigger). */
const PIVOT_MIN_ADV_MM = 0.12;
/** How far (mm) a re-punching spoke's endpoint is pulled in toward its partner
 *  — the hand short-stitch corner treatment, at the fixed depth a digitizer
 *  uses (a fraction of the throw cut 1-2mm into a wide column and opened bare
 *  slits along a rounded band's inner arc). Two depths alternate so the moved
 *  holes spread radially instead of forming a second pile just inside the
 *  pivot; both are capped for tiny throws. */
const PIVOT_INSET_A_MM = 0.55;
const PIVOT_INSET_B_MM = 0.85;
const PIVOT_INSET_MAX_FRAC = 0.65;

/**
 * Level fan pivots: wherever consecutive throws share (nearly) one hole on a
 * rail — a corner fan's pivot, a tight inner curve — pull the re-punching
 * endpoints IN toward the other rail so the needle doesn't drill one spot.
 * With the old meander chain the same-rail re-punches were ADJACENT
 * penetrations and the assembler's 0.3mm min-stitch merged them away; the
 * all-crossings zigzag interleaves a crossing between them, so without this
 * a script ligature's fan drilled its pivot hole 8+ times (a measured 26
 * penetrations in one mm² — density-danger territory). This is also what a
 * hand digitizer does at a corner: alternate short stitches into the column
 * instead of packing the inside of the bend.
 */
export function levelFanPivots(pairs: [Point, Point][], minAdv = PIVOT_MIN_ADV_MM): [Point, Point][] {
  const out: [Point, Point][] = pairs.map(([l, r]) => [{ ...l }, { ...r }]);
  for (const side of [0, 1] as const) {
    let anchor: Point | null = null;
    let repunches = 0;
    for (let k = 0; k < out.length; k++) {
      const p = out[k][side];
      const q = out[k][1 - side];
      const w = distance(p, q);
      if (anchor && distance(p, anchor) < minAdv && w > minAdv * 2) {
        const depth = repunches % 2 === 0 ? PIVOT_INSET_A_MM : PIVOT_INSET_B_MM;
        const inset = Math.min(depth / w, PIVOT_INSET_MAX_FRAC);
        repunches++;
        out[k][side] = { x: p.x + (q.x - p.x) * inset, y: p.y + (q.y - p.y) * inset };
      } else {
        anchor = p;
        repunches = 0;
      }
    }
  }
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

/* ------------------------- Satin corner handling -------------------------
 * A rail pair that turns a sharp corner (an L-bend column, a bordered
 * rectangle) must be MITRED: split at the corner and sewn leg by leg, each leg
 * with its own locally-matched rail samples, joined along the corner diagonal.
 * Matching the two rails by whole-column arc fraction instead (the naive way)
 * skews every throw around the bend — the outer rail is longer than the inner
 * one, so the correspondence drifts, throws lean up to ~60° off perpendicular,
 * cross each other, and the corner sews as a tangled fan. */

/** Tangent turn (over a ±{@link CORNER_WIN_MM} window) above which a rail
 *  vertex is a real corner that gets a mitre split. Gentle curves turn far
 *  less per window and stay on the plain matched path. */
const RAIL_CORNER_DEG = 45;
/** Arc window (mm) each side of a vertex for the corner-turn tangents — makes
 *  detection robust on densely sampled / traced rails. */
const CORNER_WIN_MM = 0.5;
/** Minimum leg length (mm) between mitre splits — closer corners merge. */
const MIN_LEG_MM = 1.0;
/** Bound the split count so pathological zig-zag rails stay cheap. */
const MAX_CORNER_SPLITS = 24;
/** Minimum forced advance (mm) between corner-fan spokes on the pivot rail, so
 *  the fan spreads over a short arc instead of re-punching one hole. */
const FAN_SPREAD_MM = 0.08;

/** Cumulative arc length at each vertex. */
function cumArc(path: Path): number[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distance(path[i - 1], path[i]));
  return cum;
}

/** Point at arc position `s` (clamped to the path). */
function pointAtArc(path: Path, cum: number[], s: number): Point {
  const total = cum[cum.length - 1];
  if (s <= 0) return { ...path[0] };
  if (s >= total) return { ...path[path.length - 1] };
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / segLen;
  const a = path[i - 1];
  const b = path[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Sub-polyline between arc positions `s0 < s1` (interpolated endpoints kept).
 *  `s1` past the end wraps around — for a CLOSED rail's last leg. */
function subPathByArc(path: Path, cum: number[], s0: number, s1: number): Path {
  const total = cum[cum.length - 1];
  if (s1 > total + 1e-9) {
    const head = subPathByArc(path, cum, s0, total);
    const tail = subPathByArc(path, cum, 0, s1 - total);
    return [...head, ...tail.slice(1)];
  }
  const out: Path = [pointAtArc(path, cum, s0)];
  for (let i = 0; i < path.length; i++) {
    if (cum[i] > s0 + 1e-9 && cum[i] < s1 - 1e-9) out.push({ ...path[i] });
  }
  out.push(pointAtArc(path, cum, s1));
  return out;
}

/** Turn (degrees) at `b` going a→b→c. 0 = straight on, 180 = full reversal. */
function turnDegAt(a: Point, b: Point, c: Point): number {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (d === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d));
  return (Math.acos(cos) * 180) / Math.PI;
}

interface RailCorner {
  /** arc position (mm) along the rail */
  s: number;
  p: Point;
  turn: number;
}

/** Sharp corners along one rail, window-tangent based, runs collapsed to their
 *  sharpest vertex (a dense arc marks many neighbours; one split suffices). */
function railCorners(path: Path, cum: number[], closed: boolean): RailCorner[] {
  const total = cum[cum.length - 1];
  if (total < CORNER_WIN_MM * 3 || path.length < 3) return [];
  const at = (s: number): Point => {
    if (closed) s = ((s % total) + total) % total;
    return pointAtArc(path, cum, s);
  };
  const cands: RailCorner[] = [];
  for (let i = 0; i < path.length; i++) {
    if (!closed && (i === 0 || i === path.length - 1)) continue;
    if (closed && i === path.length - 1) continue; // seam duplicate of i=0
    const s = cum[i];
    const turn = turnDegAt(at(s - CORNER_WIN_MM), path[i], at(s + CORNER_WIN_MM));
    if (turn >= RAIL_CORNER_DEG) cands.push({ s, p: path[i], turn });
  }
  if (cands.length === 0) return [];
  cands.sort((a, b) => a.s - b.s);
  // Collapse runs of neighbouring candidates to the sharpest one.
  const groups: RailCorner[] = [cands[0]];
  let runEnd = cands[0].s;
  for (let i = 1; i < cands.length; i++) {
    const c = cands[i];
    if (c.s - runEnd < CORNER_WIN_MM * 2) {
      if (c.turn > groups[groups.length - 1].turn) groups[groups.length - 1] = c;
    } else {
      groups.push(c);
    }
    runEnd = c.s;
  }
  // A closed rail's first and last group can be the same physical corner
  // straddling the seam — merge, keeping the sharper.
  if (closed && groups.length > 1) {
    const first = groups[0];
    const last = groups[groups.length - 1];
    if (total - last.s + first.s < CORNER_WIN_MM * 2) {
      groups[0] = first.turn >= last.turn ? first : last;
      groups.pop();
    }
  }
  return groups;
}

/** Arc position on `path` of the point nearest to `q`. */
function nearestArc(path: Path, cum: number[], q: Point): number {
  let bestS = 0;
  let bestD = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / len2)) : 0;
    const px = a.x + vx * t;
    const py = a.y + vy * t;
    const d = Math.hypot(q.x - px, q.y - py);
    if (d < bestD) {
      bestD = d;
      bestS = cum[i - 1] + Math.sqrt(len2) * t;
    }
  }
  return bestS;
}

interface RailSplit {
  sL: number;
  sR: number;
}

/**
 * Matched mitre-split positions for a rail pair: detect sharp corners on each
 * rail, pair the two sides of the same physical corner (outer corner ↔ inner
 * corner = the mitre diagonal), project any unpaired corner onto the other
 * rail, then keep only a monotone, well-separated sequence. Returns null when
 * the column has no corners — the caller keeps the plain single-leg path.
 */
function cornerSplits(
  L: Path,
  R: Path,
  cumL: number[],
  cumR: number[],
  closed: boolean,
  widthMm: number,
): RailSplit[] | null {
  const cL = railCorners(L, cumL, closed);
  const cR = railCorners(R, cumR, closed);
  if (cL.length === 0 && cR.length === 0) return null;
  const totalL = cumL[cumL.length - 1];
  const totalR = cumR[cumR.length - 1];
  if (totalL <= 0 || totalR <= 0) return null;
  const pairRadius = widthMm * 2 + 1;
  const usedR = new Set<number>();
  const splits: RailSplit[] = [];
  for (const c of cL) {
    let best = -1;
    let bd = pairRadius;
    for (let j = 0; j < cR.length; j++) {
      if (usedR.has(j)) continue;
      const d = distance(c.p, cR[j].p);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    if (best >= 0) {
      usedR.add(best);
      splits.push({ sL: c.s, sR: cR[best].s });
    } else {
      splits.push({ sL: c.s, sR: nearestArc(R, cumR, c.p) });
    }
  }
  for (let j = 0; j < cR.length; j++) {
    if (!usedR.has(j)) splits.push({ sL: nearestArc(L, cumL, cR[j].p), sR: cR[j].s });
  }
  splits.sort((a, b) => a.sL / totalL + a.sR / totalR - (b.sL / totalL + b.sR / totalR));
  const kept: RailSplit[] = [];
  for (const sp of splits) {
    if (
      !closed &&
      (sp.sL < MIN_LEG_MM ||
        sp.sR < MIN_LEG_MM ||
        sp.sL > totalL - MIN_LEG_MM ||
        sp.sR > totalR - MIN_LEG_MM)
    ) {
      continue; // too close to an open column's end — the end throw handles it
    }
    const prev = kept[kept.length - 1];
    if (prev && (sp.sL < prev.sL + MIN_LEG_MM || sp.sR < prev.sR + MIN_LEG_MM)) continue;
    kept.push(sp);
    if (kept.length >= MAX_CORNER_SPLITS) break;
  }
  // On a ring the last leg wraps back to the first split — keep that gap legal.
  if (closed && kept.length >= 2) {
    const first = kept[0];
    const last = kept[kept.length - 1];
    if (totalL - last.sL + first.sL < MIN_LEG_MM || totalR - last.sR + first.sR < MIN_LEG_MM) {
      kept.pop();
    }
  }
  return kept.length > 0 ? kept : null;
}

/**
 * Clip one end of a leg's sub-rail against the mitre line through the split's
 * two rail points `a`–`b`. An inset rail (the inner side of a sharp bend)
 * BACKTRACKS around the corner — its offset overlaps itself — leaving vertices
 * past the mitre that would sew into the neighbouring leg and cross its
 * throws. Drop the contiguous wrong-side vertices next to the boundary (the
 * boundary point itself lies on the line and stays).
 */
function clipAgainstMitre(sub: Path, atStart: boolean, a: Point, b: Point): Path {
  if (sub.length < 3) return sub;
  const mx = b.x - a.x;
  const my = b.y - a.y;
  const side = (p: Point): number => mx * (p.y - a.y) - my * (p.x - a.x);
  const ref = side(atStart ? sub[sub.length - 1] : sub[0]);
  if (Math.abs(ref) < 1e-9) return sub;
  const out = [...sub];
  if (atStart) {
    while (out.length > 2 && side(out[1]) * ref < -1e-12) out.splice(1, 1);
  } else {
    while (out.length > 2 && side(out[out.length - 2]) * ref < -1e-12) out.splice(out.length - 2, 1);
  }
  return out;
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

  // Sample a leg's two rails matched by WITHIN-LEG arc fraction and choose
  // throw positions so neither rail's gap between throws exceeds the spacing.
  const rawL: Point[] = [];
  const rawR: Point[] = [];
  const addLeg = (subL: Path, subR: Path, skipFirst: boolean, projected = false): void => {
    const len = (polylineLength(subL) + polylineLength(subR)) / 2;
    const dense = Math.max(2, Math.round(len / (step / 4)) + 1);
    let lp: Path;
    let rp: Path;
    if (projected) {
      // MITRED leg: drive the sampling from the LONGER rail and match each
      // sample to its nearest (monotone) point on the shorter one. Uniform
      // arc-fraction matching would smear the two rails' length mismatch as a
      // constant skew along the whole leg; nearest-point matching keeps the
      // interior throws perpendicular and folds the mismatch into a compact
      // hand-style fan right at the corner, pivoting on the inner mitre point.
      const leftDrives = polylineLength(subL) >= polylineLength(subR);
      const drv = leftDrives ? subL : subR;
      const oth = leftDrives ? subR : subL;
      const cumO = cumArc(oth);
      const totalO = cumO[cumO.length - 1];
      const dp = resampleByCount(drv, dense);
      const op: Path = [];
      let sPrev = -1;
      // The forced advance is scaled to the DRIVER SAMPLING pitch so the fan's
      // total spread stays ~FAN_SPREAD_MM per emitted station regardless of how
      // finely the leg is sampled. Applying the full FAN_SPREAD_MM at every
      // dense sample (4 per station) advanced the pivot 4x too fast: rounding a
      // rectangle-border corner it dragged ~2.4mm of the inner rail into the
      // fan, and the first ~15 throws of the leg sheared up to ~32° off
      // perpendicular before the nearest-point feet caught back up.
      const drvStep = polylineLength(drv) / Math.max(1, dense - 1);
      const adv = FAN_SPREAD_MM * Math.min(1, drvStep / step);
      for (let i = 0; i < dp.length; i++) {
        let s = nearestArc(oth, cumO, dp[i]);
        // Monotone, with a TINY forced advance where consecutive spokes would
        // share one pivot hole — the corner fan spreads over a short arc
        // instead of punching the same penetration many times (thread pile-up).
        // (Bounded by the leg end: the mitre point itself is shared by design.)
        if (s <= sPrev) s = Math.min(totalO, sPrev + adv);
        sPrev = s;
        op.push(pointAtArc(oth, cumO, s));
      }
      // The leg's boundary throws are the mitre diagonals — land them exactly.
      if (op.length >= 2) {
        op[0] = { ...oth[0] };
        op[op.length - 1] = { ...oth[oth.length - 1] };
      }
      lp = leftDrives ? dp : op;
      rp = leftDrives ? op : dp;
    } else {
      lp = resampleByCount(subL, dense);
      rp = resampleByCount(subR, dense);
    }
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
    for (let k = skipFirst ? 1 : 0; k < idx.length; k++) {
      rawL.push(lp[idx[k]]);
      rawR.push(rp[idx[k]]);
    }
  };

  // MITRE sharp corners: split the rails at matched corner pairs and sew leg by
  // leg — each leg's rails are matched locally, so its throws stay perpendicular
  // and adjacent legs share the corner-diagonal throw (the mitre seam). A column
  // with no sharp corner keeps the identical single-leg path.
  const cumL = cumArc(L);
  const cumR = cumArc(R);
  const closedBoth = isClosedRail(L) && isClosedRail(R);
  const splits = cornerSplits(L, R, cumL, cumR, closedBoth, wsum / wn);
  if (splits) {
    const totalL = cumL[cumL.length - 1];
    const totalR = cumR[cumR.length - 1];
    // A ring starts sewing AT the first corner (its seam falls inside a leg);
    // an open column runs end → corners → end.
    const bounds: RailSplit[] = closedBoth
      ? [...splits, { sL: splits[0].sL + totalL, sR: splits[0].sR + totalR }]
      : [{ sL: 0, sR: 0 }, ...splits, { sL: totalL, sR: totalR }];
    // The mitre line at each split (its two rail points); positions past the
    // total wrap back onto the ring.
    const at = (P: Path, cum: number[], total: number, s: number): Point =>
      pointAtArc(P, cum, s > total ? s - total : s);
    for (let b = 0; b + 1 < bounds.length; b++) {
      let subL = subPathByArc(L, cumL, bounds[b].sL, bounds[b + 1].sL);
      let subR = subPathByArc(R, cumR, bounds[b].sR, bounds[b + 1].sR);
      // Clip leg ends that meet a mitre (all boundaries on a ring; the interior
      // ones on an open column) so an inset rail's corner backtrack can't sew
      // into the neighbouring leg.
      if (closedBoth || b > 0) {
        const pl = at(L, cumL, totalL, bounds[b].sL);
        const pr = at(R, cumR, totalR, bounds[b].sR);
        subL = clipAgainstMitre(subL, true, pl, pr);
        subR = clipAgainstMitre(subR, true, pl, pr);
      }
      if (closedBoth || b + 1 < bounds.length - 1) {
        const pl = at(L, cumL, totalL, bounds[b + 1].sL);
        const pr = at(R, cumR, totalR, bounds[b + 1].sR);
        subL = clipAgainstMitre(subL, false, pl, pr);
        subR = clipAgainstMitre(subR, false, pl, pr);
      }
      addLeg(subL, subR, b > 0, true); // adjacent legs share the mitre throw — emit it once
    }
    // The closed chain's final throw duplicates its first — drop it.
    if (
      closedBoth &&
      rawL.length > 1 &&
      distance(rawL[0], rawL[rawL.length - 1]) < 1e-9 &&
      distance(rawR[0], rawR[rawR.length - 1]) < 1e-9
    ) {
      rawL.pop();
      rawR.pop();
    }
  } else {
    addLeg(L, R, false);
  }

  // Matched rail points at each throw, widened for pull compensation.
  const wl: Point[] = [];
  const wr: Point[] = [];
  for (let i = 0; i < rawL.length; i++) {
    // Pull comp widens by `pullComp`; below the sewable floor, widen further so the
    // throw lands at least MIN_SEWABLE_SATIN_WIDTH across (no effect on wide columns,
    // where the floor term is negative). `widen` no-ops on a degenerate (~0) width,
    // so a true taper tip isn't blunted — only thin-but-real spots fill out.
    const w = distance(rawL[i], rawR[i]);
    const add = Math.max(pullComp, MIN_SEWABLE_SATIN_WIDTH - w);
    const [l, r] = add > 0 ? widen(rawL[i], rawR[i], add) : [rawL[i], rawR[i]];
    wl.push(l);
    wr.push(r);
  }
  // Short stitches smooth the inside of any curve, and fan pivots are leveled
  // so a corner fan can't drill one hole. The pairs stay in canonical
  // [left, right] order — staggeredSatin's zigzag mode chains them so every
  // segment (throw AND return) crosses the column, the commercial topology.
  const pairs: [Point, Point][] = levelFanPivots(shortStitchPairs(wl, wr));

  // Split cap relative to the column's TYPICAL width: a throw much longer than
  // that is either a genuinely wide column (split satin) or a skewed diagonal
  // thrown across a sharp corner — both should break into staggered sub-stitches
  // (miter the corner), while a straight or gently curved throw stays whole. The
  // splits are scattered per-throw so wide columns show no seam.
  const medianW = median(pairs.map(([a, b]) => distance(a, b)));
  const cap = Math.min(maxWidth, Math.max(medianW * CORNER_SPLIT_RATIO, MIN_SPLIT_CAP_MM));
  return staggeredSatin(pairs, cap, { scatter: true, zigzag: true });
}

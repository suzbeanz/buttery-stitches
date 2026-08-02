import type { Path, Point } from "../../types/project";
import { medialColumns, satinCoverage, skeletonBranches } from "./medial";
import { orientByDepth, MIN_FILL_DENSITY, FILL_STITCH_LENGTH, type FillOptions } from "./fill";
import { resampleByDistance } from "./resample";
import { distance, polylineLength } from "../geometry";
import { polygonArea, polygonPerimeter } from "../trace/classify";

// ---------------------------------------------------------------------------
// Turning (directional) fill
//
// A plain tatami fills at ONE angle. On a curved, elongated shape — a banner, a
// leaf, a crescent, a wavy tube — straight rows cut across the form and read as
// "auto-digitized". A hand digitizer instead lets the stitches FLOW along the
// shape: the rows turn to stay perpendicular to the shape's spine. We do that by
// taking the medial centerline (the spine), marching along it at the row spacing,
// and casting a row across the shape perpendicular to the spine at each step — so
// the rows fan and curve with the form. Only used where it helps (a clearly
// curved, single dominant spine); everything else stays on fixed-angle tatami.
// ---------------------------------------------------------------------------

/** Shortest spine (mm) worth treating as a flowing band. */
const TURN_MIN_SPINE_MM = 15;
/** Minimum spine bow (1 − chord/arc) to bother turning — below this a straight
 *  fixed-angle fill already flows along the shape. */
const TURN_MIN_CURVE = 0.04;
/** The main spine must dominate: a second branch longer than this fraction of it
 *  means a branchy shape (a cross, a letter) that one flow can't represent. */
const TURN_DOMINANCE = 0.55;
/** Region with more rings (holes) than this is a textured/fragmented fill, not a
 *  clean band — skip the (costly) medial step entirely. */
const TURN_MAX_RINGS = 6;
/** Outer compactness (4π·area/perim²; 1 = circle) at/above which the shape is too
 *  round/blocky to be a flowing band — straight tatami already suits it. The
 *  cheap gate that avoids running the medial axis on the common round case. */
const TURN_MAX_COMPACTNESS = 0.6;
/** A row-to-row connector longer than this (mm) is a jump (a cap, a notch), so the
 *  run breaks there instead of drawing a crossing stitch. */
const TURN_CONNECT_MAX_MM = 4;
/** More breaks than this means the shape isn't a single clean band (a notched cup,
 *  a branchy glyph) — decline so the caller uses the concavity-aware tatami. */
const TURN_MAX_BREAKS = 2;

/** Intersection parameter t along segment a→b where it crosses c→d, or null. */
function segInterT(a: Point, b: Point, c: Point, d: Point): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const rxs = rx * sy - ry * sx;
  if (Math.abs(rxs) < 1e-12) return null; // parallel
  const qpx = c.x - a.x;
  const qpy = c.y - a.y;
  const t = (qpx * sy - qpy * sx) / rxs;
  const u = (qpx * ry - qpy * rx) / rxs;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/** The span of the region along the perpendicular line through P (direction n),
 *  i.e. the two boundary crossings straddling P — the local row. Null if P isn't
 *  cleanly inside (a cap, a pinch). Holes split the span naturally (their edges
 *  are crossings too), so the nearest pair around P is the covered stretch. */
function clipAcross(P: Point, n: Point, rings: Path[], half: number): [Point, Point] | null {
  const a = { x: P.x - n.x * half, y: P.y - n.y * half };
  const b = { x: P.x + n.x * half, y: P.y + n.y * half };
  const ts: number[] = [];
  for (const ring of rings) {
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const t = segInterT(a, b, ring[i], ring[(i + 1) % m]);
      if (t !== null) ts.push(t);
    }
  }
  if (ts.length < 2) return null;
  ts.sort((x, y) => x - y);
  const tP = 0.5; // P sits at the midpoint of a..b by construction
  let lo: number | null = null;
  let hi: number | null = null;
  for (const t of ts) {
    if (t <= tP) lo = t;
    else {
      hi = t;
      break;
    }
  }
  if (lo === null || hi === null) return null;
  const at = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return [at(lo), at(hi)];
}

/** Penetrations from A to B every `stitch` mm (inclusive of both ends). */
function alongRow(A: Point, B: Point, stitch: number): Point[] {
  const L = distance(A, B);
  const n = Math.max(1, Math.round(L / stitch));
  const out: Point[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    out.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
  }
  return out;
}

/** Nonzero-winding inside test over consistently-oriented rings. */
function inside(p: Point, rings: Path[]): boolean {
  let w = 0;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0; i < n; i++) {
      const a = r[i];
      const b = r[(i + 1) % n];
      const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (a.y <= p.y) {
        if (b.y > p.y && cr > 0) w++;
      } else if (b.y <= p.y && cr < 0) w--;
    }
  }
  return w !== 0;
}

/** Distance from p to the nearest ring edge. */
function distToBoundary(p: Point, rings: Path[]): number {
  let m = Infinity;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0; i < n; i++) {
      const a = r[i];
      const b = r[(i + 1) % n];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      m = Math.min(m, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
    }
  }
  return m;
}

/** Any run segment whose midpoint leaves the region DEEPLY — a real slash (a row
 *  connector jumped a notch). A midpoint just past the edge is the harmless
 *  pull-comp poke that every row carries, so we require real depth. */
function hasExposedSegment(runs: Path[], rings: Path[]): boolean {
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1];
      const b = run[i];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!inside(mid, rings) && distToBoundary(mid, rings) > 0.6) return true;
    }
  }
  return false;
}

function bboxDiag(rings: Path[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const p of r) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return Math.hypot(maxX - minX, maxY - minY) || 1;
}

/**
 * Directional fill for a curved, elongated shape. Returns serpentine runs whose
 * rows turn to follow the shape's spine, or NULL when the shape isn't a good fit
 * (not elongated, barely curved, or branchy) — the caller then uses plain tatami.
 */
export function turningFill(rings: Path[], opts: FillOptions): Path[] | null {
  const oriented = orientByDepth(rings);
  if (oriented.length === 0 || oriented[0].length < 3) return null;

  // Cheap gates first — skip the medial axis on shapes that can't benefit:
  // a fragmented/textured fill (many holes), or a round/blocky outer that a
  // straight fill already suits.
  if (oriented.length > TURN_MAX_RINGS) return null;
  const outer = oriented.reduce((a, b) => (polygonArea(b) > polygonArea(a) ? b : a));
  const per = polygonPerimeter(outer);
  const compactness = per > 0 ? (4 * Math.PI * polygonArea(outer)) / (per * per) : 1;
  if (compactness >= TURN_MAX_COMPACTNESS) return null;

  // Spine = the longest medial centerline (it already follows the curve).
  const cols = medialColumns(oriented, { density: opts.density, pullScale: 0 });
  if (cols.length === 0) return null;
  const sorted = cols.slice().sort((a, b) => polylineLength(b.centerline) - polylineLength(a.centerline));
  const spine = sorted[0].centerline;
  const arc = polylineLength(spine);
  if (arc < TURN_MIN_SPINE_MM || spine.length < 2) return null;
  const chord = distance(spine[0], spine[spine.length - 1]);
  const curvy = 1 - chord / arc;
  if (curvy < TURN_MIN_CURVE) return null; // straight enough; fixed-angle is fine
  const secondArc = sorted[1] ? polylineLength(sorted[1].centerline) : 0;
  if (secondArc > arc * TURN_DOMINANCE) return null; // branchy → one flow won't do

  const density = Math.max(MIN_FILL_DENSITY, opts.density);
  const stitch = opts.stitchLength ?? FILL_STITCH_LENGTH;
  const comp = Math.max(0, opts.pullCompMm ?? 0);
  const half = bboxDiag(oriented);

  // Extend the spine through the caps: the medial skeleton stops ~one local
  // radius short of each tip, so without this the last rows never reach the
  // ends and the caps stay bare (the old end-gap coverage loss). Stations
  // that land past the boundary clip to nothing and simply end the run.
  const { runs, breaks } = marchSpine(extendSpine(spine, 6), oriented, density, stitch, comp, half);
  if (runs.length === 0 || breaks > TURN_MAX_BREAKS) return null;
  // Safety net: if any row connector left the region (a notch the rows jumped),
  // this shape isn't a clean band — bail so the caller uses the concavity-aware
  // tatami instead. Turning fill must never introduce a slash.
  if (hasExposedSegment(runs, oriented)) return null;
  return runs;
}

/**
 * Place row stations along the spine with curvature-adaptive spacing: the
 * along-spine step shrinks where the spine bends so the OUTER edge's row
 * pitch never exceeds `density`. Curvature comes from circumradius over a
 * ±2-sample window (smoothed over 3 stations so a noisy skeleton can't make
 * the spacing oscillate); the local half-width comes from the same
 * cross-shape cast the rows use.
 */
function adaptiveStations(spine: Path, oriented: Path[], density: number, half: number): Path {
  const fineStep = Math.max(0.1, density / 4);
  const fine = resampleByDistance(spine, fineStep);
  if (fine.length < 3) return resampleByDistance(spine, density);

  // Curvature per fine sample (circumradius of the ±2 triangle).
  const kRaw = new Float64Array(fine.length);
  for (let i = 2; i < fine.length - 2; i++) {
    const a = fine[i - 2];
    const b = fine[i];
    const c = fine[i + 2];
    const ab = distance(a, b);
    const bc = distance(b, c);
    const ca = distance(c, a);
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
    kRaw[i] = ab * bc * ca > 1e-9 ? (2 * area2) / (ab * bc * ca) : 0;
  }
  // 3-tap smoothing keeps the step from oscillating on skeleton jitter.
  const kappa = new Float64Array(fine.length);
  for (let i = 0; i < fine.length; i++) {
    kappa[i] = (kRaw[Math.max(0, i - 1)] + kRaw[i] + kRaw[Math.min(fine.length - 1, i + 1)]) / 3;
  }
  // Local half-width per fine sample (sparse casts, carried between hits).
  const halfW = new Float64Array(fine.length);
  let lastW = density; // conservative default until the first hit
  for (let i = 0; i < fine.length; i++) {
    if (i % 4 === 0) {
      const a = fine[Math.max(0, i - 1)];
      const b = fine[Math.min(fine.length - 1, i + 1)];
      const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const n = { x: -(b.y - a.y) / tl, y: (b.x - a.x) / tl };
      const span = clipAcross(fine[i], n, oriented, half);
      if (span) lastW = distance(span[0], span[1]) / 2;
    }
    halfW[i] = lastW;
  }

  // Walk with EXACT interpolation between fine samples — snapping stations to
  // the fine grid overshoots the step by up to a full fine-step (25%), which
  // reads directly as outer-edge pitch over density (visible row gaps).
  const out: Path = [fine[0]];
  let acc = 0;
  for (let i = 1; i < fine.length; i++) {
    let segLen = distance(fine[i - 1], fine[i]);
    let segStart = fine[i - 1];
    for (;;) {
      const step = Math.max(0.35 * density, density / (1 + kappa[i] * halfW[i]));
      const need = step - acc;
      if (segLen < need) {
        acc += segLen;
        break;
      }
      const t = need / segLen;
      const P = {
        x: segStart.x + (fine[i].x - segStart.x) * t,
        y: segStart.y + (fine[i].y - segStart.y) * t,
      };
      out.push(P);
      segStart = P;
      segLen -= need;
      acc = 0;
    }
  }
  const tail = fine[fine.length - 1];
  if (distance(out[out.length - 1], tail) > 0.25 * density) out.push(tail);
  return out;
}

/**
 * Lay serpentine rows perpendicular to `spine`, marching along it at the row
 * spacing and clipping each row across the shape (`clipAcross`). Returns the runs
 * plus how many connectors had to break (a cap or notch). Shared by `turningFill`
 * (one dominant spine) and `flowFill` (one call per skeleton branch).
 */
function marchSpine(
  spine: Path,
  oriented: Path[],
  density: number,
  stitch: number,
  comp: number,
  half: number,
): { runs: Path[]; breaks: number } {
  // Row stations marched along the spine — CURVATURE-ADAPTIVE spacing. On a
  // bend, rows spaced at `density` along the spine fan out to
  // density·(1 + d/ρ) at the outer edge (up to ~2× on a crescent's inner
  // radius), leaving visible inter-row gaps. Advance by
  // density / (1 + κ·halfWidth) instead, clamped so the spacing never
  // collapses below 0.35·density (the coincident-collapse and min-spacing
  // safeties thin the inner edge where rows converge).
  const stations = adaptiveStations(spine, oriented, density, half);
  if (stations.length < 2) return { runs: [], breaks: 0 };

  // Pass 1: compute each station's perpendicular row span across the shape.
  type Span = { A: Point; B: Point; L: number } | null;
  const spans: Span[] = stations.map((P, i) => {
    const a = stations[Math.max(0, i - 1)];
    const b = stations[Math.min(stations.length - 1, i + 1)];
    const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const n = { x: -(b.y - a.y) / tl, y: (b.x - a.x) / tl }; // ⟂ to spine tangent
    const span = clipAcross(P, n, oriented, half);
    if (!span) return null;
    const L = distance(span[0], span[1]);
    return L < 1e-6 ? null : { A: span[0], B: span[1], L };
  });

  // Near a cap the perpendicular can graze the end and return a long diagonal
  // chord instead of the local width; reject spans far longer than typical so the
  // rows don't cross. Median of the valid widths is the robust reference.
  const lens = spans.filter((s): s is NonNullable<Span> => s !== null).map((s) => s.L).sort((x, y) => x - y);
  const medianL = lens.length ? lens[lens.length >> 1] : 0;
  const maxL = medianL * 2.2;

  const runs: Path[] = [];
  let group: Point[] = [];
  let lastPt: Point | null = null;
  let prevDir: Point | null = null; // unit direction of the last accepted row
  let breaks = 0;
  const flush = () => {
    if (group.length >= 2) runs.push(group);
    group = [];
    lastPt = null;
    prevDir = null;
  };
  // Line-angle difference (mod 180°) between two unit directions.
  const lineTurn = (a: Point, b: Point) =>
    Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y))) * (180 / Math.PI);

  for (const [si, rawSpan] of spans.entries()) {
    if (!rawSpan) {
      flush(); // a gap (station outside / at a pinch) ends the continuous run
      continue;
    }
    let span = rawSpan;
    if (medianL > 0 && span.L > maxL) {
      // The perpendicular grazed a cap and returned a long diagonal chord.
      // Dropping the row (the old behavior) left the cap bare — instead
      // TRUNCATE it symmetrically about the station to the typical width.
      // The full chord lies inside the region (clipAcross returns the
      // nearest crossing pair around the station), so the truncated row is
      // inside too; the flip guard below still rejects a crossing direction.
      const P = stations[si];
      const clampEnd = (E: Point): Point => {
        const d = distance(P, E);
        const lim = maxL / 2;
        if (d <= lim) return E;
        const s = lim / d;
        return { x: P.x + (E.x - P.x) * s, y: P.y + (E.y - P.y) * s };
      };
      const A = clampEnd(span.A);
      const B = clampEnd(span.B);
      const L2 = distance(A, B);
      if (L2 < 1e-6) {
        flush();
        continue;
      }
      span = { A, B, L: L2 };
    }
    const L = span.L;
    const ux = (span.B.x - span.A.x) / L;
    const uy = (span.B.y - span.A.y) / L;
    const dir = { x: ux, y: uy };
    // A row whose direction snaps away from the previous one is a cap flip (the
    // perpendicular grazed the end) — drop it rather than draw a crossing.
    if (prevDir && lineTurn(dir, prevDir) > 30) {
      flush();
      continue;
    }
    // Pull-comp: nudge the row ends past the edge so the sewn boundary lands on
    // the line (capped at half the row so a thin station can't invert).
    const c = Math.min(comp, L / 2);
    const A = { x: span.A.x - ux * c, y: span.A.y - uy * c };
    const B = { x: span.B.x + ux * c, y: span.B.y + uy * c };
    let row = alongRow(A, B, stitch);
    // Serpentine by NEAREST end (robust to the perpendicular flipping side): start
    // each row at whichever end is closer to where the last one finished.
    if (lastPt && distance(lastPt, row[row.length - 1]) < distance(lastPt, row[0])) {
      row = row.reverse();
    }
    // A long connector (a cap, a jump) breaks the run rather than drawing a stitch
    // across open fabric — the assembler then trims/jumps it cleanly.
    if (lastPt && distance(lastPt, row[0]) > TURN_CONNECT_MAX_MM) {
      breaks++;
      flush();
    }
    for (const p of row) group.push(p);
    lastPt = row[row.length - 1];
    prevDir = dir;
  }
  flush();
  return { runs, breaks };
}

/** Shortest skeleton branch (mm) counted as a real flowing limb — above the
 *  thinning spurs and short surface spikes a frilly outline throws off. */
const FLOW_MIN_BRANCH_MM = 12;
/** Below this bbox diagonal the shape is a small feature, not a flowing fill. */
const FLOW_MIN_EXTENT_MM = 16;
/** At/above this outer compactness the shape is a near-perfect disc — no limbs to
 *  flow along, so skip the skeleton entirely and let tatami fill it. */
const FLOW_MAX_COMPACTNESS = 0.85;
/** Coverage a flow fill must reach (raster) or it bails to tatami. */
const FLOW_MIN_COVERAGE = 0.85;
/** Most limbs a flow shape may have. A clean limbed form (a Y, a boomerang) has a
 *  few; a textured thicket (a tree-line, a frilly blob) has many short spikes whose
 *  per-limb flow reads as a chaotic criss-cross — those belong on plain tatami. */
const FLOW_MAX_BRANCHES = 3;
/** The longest limb must span at least this fraction of the shape's diagonal —
 *  proof the "limbs" are real arms that carry the form, not short surface spikes. */
const FLOW_MIN_SPAN_FRAC = 0.35;
/** A clean flow breaks its serpentine ~once per limb at most (a cap turnaround).
 *  More than that means the rows are fanning — the perpendicular is sweeping through
 *  many angles around an interior hole or a notch (the golf-green starburst) — so the
 *  shape isn't really flowable and plain tatami sews far cleaner. */
const FLOW_MAX_BREAKS_PER_BRANCH = 1;

/**
 * Directional fill for a BRANCHY or organic shape — a Y, a cross, a multi-lobe
 * blob — that `turningFill` declines because it has no single dominant spine. We
 * take EVERY medial branch (already junction-mitred by `medialColumns`) and flow
 * rows perpendicular to each limb, so the stitches turn to follow the whole form
 * instead of cutting straight across it. Returns serpentine runs, or NULL when the
 * shape isn't a good fit (too small/round, one spine, or the result wouldn't cover
 * cleanly) so the caller falls back to the concavity-aware tatami.
 */
export function flowFill(rings: Path[], opts: FillOptions): Path[] | null {
  const oriented = orientByDepth(rings);
  if (oriented.length === 0 || oriented[0].length < 3) return null;
  if (oriented.length > TURN_MAX_RINGS) return null;
  if (bboxDiag(oriented) < FLOW_MIN_EXTENT_MM) return null;
  const outer = oriented.reduce((a, b) => (polygonArea(b) > polygonArea(a) ? b : a));
  const per = polygonPerimeter(outer);
  const compactness = per > 0 ? (4 * Math.PI * polygonArea(outer)) / (per * per) : 1;
  // Only skip a NEARLY-round shape outright (a disc) — a starfish reads as fairly
  // compact yet has clear limbs, so the real test below is the branch count.
  if (compactness >= FLOW_MAX_COMPACTNESS) return null;

  const density = Math.max(MIN_FILL_DENSITY, opts.density);
  // RAW skeleton limbs (not mitred into one stroke). Two or more long limbs means a
  // branchy/organic shape that one flow can't represent — exactly turningFill's
  // blind spot. One limb is a single spine (turningFill ran first); decline.
  const branches = skeletonBranches(oriented)
    .filter((c) => polylineLength(c) >= FLOW_MIN_BRANCH_MM)
    .sort((a, b) => polylineLength(b) - polylineLength(a));
  // A few LONG limbs, not a thicket of short spikes: the latter (a tree-line, a
  // frilly green) flows into a chaotic criss-cross that's worse than clean tatami.
  if (branches.length < 2 || branches.length > FLOW_MAX_BRANCHES) return null;
  if (polylineLength(branches[0]) < FLOW_MIN_SPAN_FRAC * bboxDiag(oriented)) return null;

  const stitch = opts.stitchLength ?? FILL_STITCH_LENGTH;
  const comp = Math.max(0, opts.pullCompMm ?? 0);
  const half = bboxDiag(oriented);

  const runs: Path[] = [];
  let totalBreaks = 0;
  for (const spine of branches) {
    const { runs: r, breaks } = marchSpine(spine, oriented, density, stitch, comp, half);
    totalBreaks += breaks;
    for (const run of r) runs.push(run);
  }
  if (runs.length === 0) return null;
  // Fanning guard: a real flow turns gently and breaks at most about once per limb
  // (a cap turnaround). When the rows fan — the perpendicular spinning through many
  // angles around an interior hole/notch — the serpentine shatters into far more
  // breaks than there are limbs. That's the golf-green starburst; bail so the caller
  // uses the clean concavity-aware tatami instead.
  if (totalBreaks > branches.length * FLOW_MAX_BREAKS_PER_BRANCH) return null;
  // Must never slash, and must actually cover the shape — else tatami is safer.
  if (hasExposedSegment(runs, oriented)) return null;
  if (satinCoverage(oriented, runs) < FLOW_MIN_COVERAGE) return null;
  return runs;
}

/** A user flow curve only has to cover most of the shape — it's an explicit choice,
 *  so the bar is a touch lower than the auto flowFill's. */
const FLOW_ALONG_MIN_COVERAGE = 0.8;

/** Extend a spine past both ends along its end tangents by `margin` mm, so rows
 *  cast perpendicular to it sweep the WHOLE shape even when the drawn curve stops
 *  short of the edges (stations that fall outside the shape just clip to nothing). */
function extendSpine(spine: Path, margin: number): Path {
  if (spine.length < 2) return spine;
  const unit = (from: Point, to: Point): Point => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const L = Math.hypot(dx, dy) || 1;
    return { x: dx / L, y: dy / L };
  };
  const head = spine[0], afterHead = spine[1];
  const tail = spine[spine.length - 1], beforeTail = spine[spine.length - 2];
  const dHead = unit(afterHead, head); // points outward from the start
  const dTail = unit(beforeTail, tail); // points outward from the end
  return [
    { x: head.x + dHead.x * margin, y: head.y + dHead.y * margin },
    ...spine,
    { x: tail.x + dTail.x * margin, y: tail.y + dTail.y * margin },
  ];
}

/**
 * USER-GUIDED flow: lay the fill's rows PERPENDICULAR to a spine the user drew, so
 * the stitches follow their curve (the assisted-digitizing "draw the grain" tool).
 * Same machinery as `turningFill`/`flowFill` but the spine is supplied, not derived.
 * Returns serpentine runs, or NULL when the curve can't cover the shape cleanly (the
 * caller then falls back to tatami) — and, like the auto flows, never slashes.
 */
export function flowAlong(rings: Path[], spine: Path, opts: FillOptions): Path[] | null {
  const oriented = orientByDepth(rings);
  if (oriented.length === 0 || oriented[0].length < 3 || spine.length < 2) return null;
  const density = Math.max(MIN_FILL_DENSITY, opts.density);
  const stitch = opts.stitchLength ?? FILL_STITCH_LENGTH;
  const comp = Math.max(0, opts.pullCompMm ?? 0);
  const half = bboxDiag(oriented);
  const { runs } = marchSpine(extendSpine(spine, half), oriented, density, stitch, comp, half);
  if (runs.length === 0) return null;
  if (hasExposedSegment(runs, oriented)) return null; // never slash past the edge
  if (satinCoverage(oriented, runs) < FLOW_ALONG_MIN_COVERAGE) return null;
  return runs;
}

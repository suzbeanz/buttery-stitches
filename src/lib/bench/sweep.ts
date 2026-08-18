/**
 * The defect sweep: numeric per-object quality metrics that POINT at problems
 * so only flagged objects need human eyes. Built during the perfection
 * campaign, where it found (among others) a 0.9mm bare strip down a crest
 * ring's flank and a wedge petal sewing 37% of its throws crossed — defects
 * spot-checking had missed. Kept in the bench so the standard is permanent.
 */
import type { EmbObject, Point, Project } from "../../types/project";
import { generateObjectRuns, generateDesign } from "../engine";
import { splitFillRegions } from "../engine/fill";
import { satinCoverage, residualRegions } from "../engine/medial";
import { buildDensityMap, hotCells } from "../engine/densitymap";
import { polygonArea } from "../trace/classify";
import { meanStrokeWidthMm } from "../engine/classify";

export interface ObjectSweep {
  index: number;
  name: string;
  /** Mean stroke width of the drawn region (mm); hairline regions sew as bean
   *  runs and are gated accordingly. */
  strokeWidthMm: number;
  coverage: number;
  bareMm2: number;
  /** Largest single bare patch (mm²): the eye sees a HOLE, not a sum — a big
   *  outline network legitimately accrues speck dust along hundreds of mm of
   *  stroke edge while never showing one visible gap. */
  maxBarePatchMm2: number;
  /** Genuine mid-air crossings — near-pivot fan-mates exempt. */
  crossings: number;
  crossingPct: number;
  maxSegMm: number;
}

function segsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const e = 1e-9;
  const d1 = d(a1, a2, b1), d2 = d(a1, a2, b2), d3 = d(b1, b2, a1), d4 = d(b1, b2, a2);
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}

/** Intersection point of two crossing segments (call only when segsCross). */
function crossPoint(a1: Point, a2: Point, b1: Point, b2: Point): Point {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  const t = d !== 0 ? ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d : 0.5;
  return { x: a1.x + (a2.x - a1.x) * t, y: a1.y + (a2.y - a1.y) * t };
}

/** Even-odd point-in-region over all rings. */
function insideRegion(p: Point, rings: Point[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** Sweep one object: run the engine, measure the result against its own
 *  drawn region. Fill-type objects only (running lines have no region). */
export function sweepObject(o: EmbObject, index = 0): ObjectSweep | null {
  if (o.type === "running" || !o.paths.length) return null;
  const body = generateObjectRuns(o)
    .filter((r) => !r.underlay)
    .map((r) => r.pts);
  // Halo 0.25mm ≈ half a laid 40wt thread: the honest physical credit. A
  // finer halo under-credits bean-run lettering (correct for 4mm text) while
  // a coarser one hides real gaps.
  const coverage = satinCoverage(o.paths, body, 0.25);
  const bareAreas = residualRegions(o.paths, body, 0.2, 0.4).map((r) =>
    Math.abs(polygonArea(r)),
  );
  const bareMm2 = bareAreas.reduce((s, a) => s + a, 0);
  const maxBarePatchMm2 = bareAreas.reduce((m, a) => Math.max(m, a), 0);
  let crossings = 0, maxSegMm = 0, nseg = 0;
  for (const pts of body) {
    for (let k = 1; k < pts.length; k++) {
      const L = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
      if (L > maxSegMm) maxSegMm = L;
      nseg++;
      for (let j = Math.max(1, k - 8); j < k - 1; j++) {
        if (!segsCross(pts[j - 1], pts[j], pts[k - 1], pts[k])) continue;
        // Near-pivot fan-mates: segments whose closest endpoints sit within a
        // thread's width are a deliberate hand-style fan, not a defect.
        const dmin = Math.min(
          Math.hypot(pts[j - 1].x - pts[k - 1].x, pts[j - 1].y - pts[k - 1].y),
          Math.hypot(pts[j - 1].x - pts[k].x, pts[j - 1].y - pts[k].y),
          Math.hypot(pts[j].x - pts[k - 1].x, pts[j].y - pts[k - 1].y),
          Math.hypot(pts[j].x - pts[k].x, pts[j].y - pts[k].y),
        );
        if (dmin <= 0.25) continue;
        // A crossing BURIED in the object's own fill (a boustrophedon
        // boundary connector passing over same-color rows) is invisible on
        // fabric. The defect this metric exists for is thread crossing over
        // BARE or foreign ground — count only intersections outside the
        // object's own region.
        const cp = crossPoint(pts[j - 1], pts[j], pts[k - 1], pts[k]);
        if (!insideRegion(cp, o.paths)) crossings++;
      }
    }
  }
  return {
    index,
    name: o.name,
    strokeWidthMm: meanStrokeWidthMm(o.paths),
    coverage,
    bareMm2,
    maxBarePatchMm2,
    crossings,
    crossingPct: nseg ? (100 * crossings) / nseg : 0,
    maxSegMm,
  };
}

export interface DesignSweep {
  objects: ObjectSweep[];
  stitches: number;
  dangerCells: number;
  /** Thread cuts in the whole design. */
  trims: number;
  /** Trims normalized per 10k stitches — the professional band, measured from
   *  five commercial reference files (Wilcom worksheet: 12/13.5k ≈ 9; small
   *  designs run to ~22), is 9–22. */
  trimsPer10k: number;
  /** q95 of stitched segment lengths (mm). Every reference fill block measures
   *  3.99–4.10; only deliberate decorative satin exceeds it. */
  stitchQ95Mm: number;
  /** Disjoint fill pieces across the design's visible objects. Lettering-like
   *  designs (every glyph its own island on open fabric) legitimately trim
   *  about once per piece — the professional norm for standalone text — so the
   *  trim gate scales with this, not only with stitch count. */
  pieces: number;
  /** Thread-block boundaries (trims) in the design… */
  boundaries: number;
  /** …and how many of them have lock stitches on BOTH sides (a tie-out before
   *  the cut, a tie-in after). The reference files lock every one. */
  lockedBoundaries: number;
}

/** Sweep a whole project: every visible fill object + design-wide density +
 *  the design-level professional metrics (trims, lengths, locks). */
export function sweepProject(project: Project): DesignSweep {
  const objects: ObjectSweep[] = [];
  project.objects.forEach((o, i) => {
    if (!o.visible) return;
    const s = sweepObject(o, i);
    if (s) objects.push(s);
  });
  const design = generateDesign(project);
  const map = buildDensityMap(design);
  const dangerCells = map ? hotCells(map).filter((h) => h.severity >= 1).length : 0;

  // Design-level pro metrics off the final stitch stream.
  let trims = 0;
  const lens: number[] = [];
  let boundaries = 0;
  let lockedBoundaries = 0;
  /** Are there ≥2 sub-1.2mm stitches within the window's penetrations? (The
   *  engine's ties are 3 alternating ~0.5-0.8mm bites.) */
  const lockAround = (idx: number, dir: -1 | 1): boolean => {
    let short = 0;
    let steps = 0;
    let i = idx;
    while (steps < 6 && i + dir >= 0 && i + dir < design.length) {
      const a = design[i];
      const b = design[i + dir];
      if (a.jump || a.trim || b.jump || b.trim) break;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= 1.2) short++;
      i += dir;
      steps++;
    }
    return short >= 2;
  };
  for (let i = 1; i < design.length; i++) {
    const s = design[i];
    if (s.trim) {
      trims++;
      boundaries++;
      if (lockAround(i - 1, -1) && (i + 1 >= design.length || lockAround(i + 1, 1)))
        lockedBoundaries++;
      continue;
    }
    if (s.jump || design[i - 1].jump || design[i - 1].trim) continue;
    if (s.colorId !== design[i - 1].colorId) continue;
    lens.push(Math.hypot(s.x - design[i - 1].x, s.y - design[i - 1].y));
  }
  lens.sort((a, b) => a - b);
  const stitchQ95Mm = lens.length ? lens[Math.min(lens.length - 1, Math.floor(0.95 * lens.length))] : 0;
  let pieces = 0;
  for (const o of project.objects) {
    if (!o.visible) continue;
    pieces += o.type === "running" ? o.paths.length : splitFillRegions(o.paths).length;
  }
  return {
    objects,
    stitches: design.length,
    dangerCells,
    trims,
    trimsPer10k: design.length ? (trims * 10_000) / design.length : 0,
    stitchQ95Mm,
    pieces,
    boundaries,
    lockedBoundaries,
  };
}

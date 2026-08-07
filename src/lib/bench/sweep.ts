/**
 * The defect sweep: numeric per-object quality metrics that POINT at problems
 * so only flagged objects need human eyes. Built during the perfection
 * campaign, where it found (among others) a 0.9mm bare strip down a crest
 * ring's flank and a wedge petal sewing 37% of its throws crossed — defects
 * spot-checking had missed. Kept in the bench so the standard is permanent.
 */
import type { EmbObject, Point, Project } from "../../types/project";
import { generateObjectRuns, generateDesign } from "../engine";
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
  const bareMm2 = residualRegions(o.paths, body, 0.2, 0.4).reduce(
    (s, r) => s + Math.abs(polygonArea(r)),
    0,
  );
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
        if (dmin > 0.25) crossings++;
      }
    }
  }
  return {
    index,
    name: o.name,
    strokeWidthMm: meanStrokeWidthMm(o.paths),
    coverage,
    bareMm2,
    crossings,
    crossingPct: nseg ? (100 * crossings) / nseg : 0,
    maxSegMm,
  };
}

export interface DesignSweep {
  objects: ObjectSweep[];
  stitches: number;
  dangerCells: number;
}

/** Sweep a whole project: every visible fill object + design-wide density. */
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
  return { objects, stitches: design.length, dangerCells };
}

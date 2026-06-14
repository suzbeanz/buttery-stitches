import type { Path, Point } from "../../types/project";
import { rotatePoint } from "./resample";

export interface FillOptions {
  /** mm between scan rows */
  density: number;
  /** fill direction in degrees */
  angle: number;
  /** mm between penetrations along a row (tatami stitch length) */
  stitchLength?: number;
}

/** Default tatami stitch length (mm) — the spacing of holes along a row. */
export const FILL_STITCH_LENGTH = 4;

function centroid(ring: Path): Point {
  let x = 0,
    y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/**
 * Intersection spans of a horizontal line `y` with all rings, using the
 * even-odd rule (so inner rings act as holes). Returns sorted [x0, x1] pairs.
 */
function rowSpans(rings: Path[], y: number): [number, number][] {
  const xs: number[] = [];
  for (const ring of rings) {
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % m];
      // Half-open test avoids counting a shared vertex twice.
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
  }
  xs.sort((p, q) => p - q);
  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]]);
  return spans;
}

/** Penetrations across one row span, with a phase offset for brick staggering. */
function alongRow(x0: number, x1: number, y: number, spacing: number, phase: number): Point[] {
  const pts: Point[] = [{ x: x0, y }];
  let x = x0 + (phase > 0 ? phase : spacing);
  while (x < x1 - 1e-6) {
    pts.push({ x, y });
    x += spacing;
  }
  if (x1 - x0 > 1e-6) pts.push({ x: x1, y });
  return pts;
}

/**
 * Tatami fill: lay parallel rows at `angle`, spaced `density` mm, clipped to the
 * region (with holes). Rows run in a serpentine so travel between them is short,
 * and alternate rows are phase-shifted so needle holes don't line up — the
 * classic brick pattern that keeps a fill looking smooth instead of ribbed.
 *
 * Returns an ordered list of penetrations in millimetres.
 */
export function tatamiFill(rings: Path[], opts: FillOptions): Path {
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  const spacing = opts.stitchLength ?? FILL_STITCH_LENGTH;
  const density = Math.max(0.05, opts.density);

  // Work in a rotated frame where rows are horizontal.
  const pivot = centroid(outer);
  const rrings = rings.map((r) => r.map((p) => rotatePoint(p, -opts.angle, pivot)));

  let minY = Infinity,
    maxY = -Infinity;
  for (const p of rrings[0]) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const rotated: Point[] = [];
  let k = 0;
  for (let y = minY + density / 2; y <= maxY; y += density, k++) {
    const spans = rowSpans(rrings, y);
    if (spans.length === 0) continue;
    const phase = (k % 2) * (spacing / 2);
    const rowPts: Point[] = [];
    for (const [x0, x1] of spans) rowPts.push(...alongRow(x0, x1, y, spacing, phase));
    if (k % 2 === 1) rowPts.reverse(); // serpentine
    rotated.push(...rowPts);
  }

  // Back to the original orientation.
  return rotated.map((p) => rotatePoint(p, opts.angle, pivot));
}

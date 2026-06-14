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

/** Even-odd ray cast: is point `p` inside the closed ring? */
function pointInRing(p: Point, ring: Path): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const straddles = a.y > p.y !== b.y > p.y;
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Absolute polygon area (shoelace). */
function ringArea(ring: Path): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}

/**
 * Split a fill's rings into connected regions, each `[outer, ...holes]`. A ring
 * counts as a hole when it sits inside a larger ring (its smallest container);
 * disjoint outers — e.g. separate letters of a word, or a logo's separate blobs —
 * become separate regions. The fill engine then stitches each region on its own,
 * so the assembler can jump between them instead of dragging one long stitch
 * across the gap.
 */
export function splitFillRegions(rings: Path[]): Path[][] {
  const usable = rings.filter((r) => r.length >= 3);
  if (usable.length <= 1) return usable.length ? [usable.map((r) => r)] : [];

  const areas = usable.map(ringArea);
  // For each ring, the index of the smallest ring strictly containing it (-1 = none).
  const containerOf = usable.map((ring, i) => {
    let best = -1;
    let bestArea = Infinity;
    usable.forEach((other, j) => {
      if (j === i || areas[j] <= areas[i]) return;
      if (pointInRing(ring[0], other) && areas[j] < bestArea) {
        best = j;
        bestArea = areas[j];
      }
    });
    return best;
  });

  const regions: Path[][] = [];
  const outerRegion = new Map<number, number>();
  usable.forEach((ring, i) => {
    if (containerOf[i] === -1) {
      outerRegion.set(i, regions.length);
      regions.push([ring]);
    }
  });
  // Attach each contained ring to its top-level outer as a hole.
  usable.forEach((ring, i) => {
    if (containerOf[i] === -1) return;
    let top = containerOf[i];
    while (containerOf[top] !== -1) top = containerOf[top];
    const r = outerRegion.get(top);
    if (r !== undefined) regions[r].push(ring);
  });
  return regions;
}

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
 * Returns an ordered list of penetrations in millimeters.
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

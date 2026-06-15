import type { Path, Point } from "../../types/project";
import { rotatePoint } from "./resample";
import { staggeredSatin } from "./satin";

/** Longest single satin throw (mm) before it is split for safety. */
const MAX_THROW_MM = 7;

export interface FillOptions {
  /** mm between scan rows */
  density: number;
  /** fill direction in degrees */
  angle: number;
  /** mm between penetrations along a row (tatami stitch length) */
  stitchLength?: number;
  /**
   * Pull compensation (mm): extend each row a touch past the region edge so that,
   * after the fabric pulls the stitches in, the sewn boundary lands on the drawn
   * line instead of shy of it (docs/stitch-logic.md §6). Default 0.
   */
  pullCompMm?: number;
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

/** Signed polygon area (shoelace); the sign encodes winding direction. */
function signedRingArea(ring: Path): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function ringArea(ring: Path): number {
  return Math.abs(signedRingArea(ring));
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bboxOf(ring: Path): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function bboxOverlap(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** Whether `outer` contains `inner` — sampled, so partial overlap (touching
 *  script letters) is NOT mistaken for containment (which only true counters are). */
function ringContains(outer: Path, inner: Path): boolean {
  const n = inner.length;
  const step = Math.max(1, Math.floor(n / 9));
  let tested = 0;
  let inside = 0;
  for (let i = 0; i < n; i += step) {
    tested++;
    if (pointInRing(inner[i], outer)) inside++;
  }
  return tested > 0 && inside === tested;
}

/** Containment depth of each ring (how many larger rings fully contain it). */
function depthsOf(rings: Path[]): number[] {
  const areas = rings.map(ringArea);
  return rings.map((r, i) => {
    let d = 0;
    rings.forEach((o, j) => {
      if (j !== i && areas[j] > areas[i] && ringContains(o, r)) d++;
    });
    return d;
  });
}

function orientRing(ring: Path, wantPositive: boolean): Path {
  const out = ring.map((p) => ({ ...p }));
  const positive = signedRingArea(ring) > 0;
  if (positive !== wantPositive) out.reverse();
  return out;
}

/**
 * Orient rings for nonzero-winding fill: outer contours (even containment depth)
 * one way and holes/counters (odd depth) the opposite way. This makes a fill
 * correct for nested counters (a/e/o) AND for OVERLAPPING contours — touching
 * script letters union cleanly instead of even-odd punching false holes where
 * they cross.
 */
export function orientByDepth(rings: Path[]): Path[] {
  const usable = rings.filter((r) => r.length >= 3);
  const d = depthsOf(usable);
  return usable.map((r, i) => orientRing(r, d[i] % 2 === 0));
}

/**
 * Split a fill's rings into connected regions with nonzero-consistent winding.
 * Outer contours (even depth) whose bounding boxes overlap are one region (a
 * connected blob, e.g. touching script letters); disjoint blobs are separate
 * regions so the assembler can jump between them. Counters attach to the
 * smallest outer that contains them.
 */
export function splitFillRegions(rings: Path[]): Path[][] {
  const usable = rings.filter((r) => r.length >= 3);
  if (usable.length === 0) return [];

  const areas = usable.map(ringArea);
  const d = depthsOf(usable);
  const bb = usable.map(bboxOf);

  const parent = usable.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const outers = usable.map((_, i) => i).filter((i) => d[i] % 2 === 0);
  for (let a = 0; a < outers.length; a++) {
    for (let b = a + 1; b < outers.length; b++) {
      if (bboxOverlap(bb[outers[a]], bb[outers[b]])) parent[find(outers[a])] = find(outers[b]);
    }
  }

  const regionOf = new Map<number, Path[]>();
  outers.forEach((i) => {
    const root = find(i);
    if (!regionOf.has(root)) regionOf.set(root, []);
    regionOf.get(root)!.push(orientRing(usable[i], true));
  });
  usable.forEach((r, i) => {
    if (d[i] % 2 === 0) return; // outer, handled above
    let best = -1;
    let bestArea = Infinity;
    usable.forEach((o, j) => {
      if (j !== i && d[j] % 2 === 0 && areas[j] > areas[i] && areas[j] < bestArea && ringContains(o, r)) {
        best = j;
        bestArea = areas[j];
      }
    });
    const root = best >= 0 ? find(best) : outers.length ? find(outers[0]) : -1;
    if (root >= 0 && regionOf.has(root)) regionOf.get(root)!.push(orientRing(r, false));
  });
  return [...regionOf.values()];
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
 * The shape's principal (major) axis from its AREA second moments — the natural
 * "grain" direction a fill should flow along. Area-weighted (not vertex-counted)
 * so a curve sampled with many points doesn't skew the result.
 *
 * Returns the major-axis angle in degrees and the `elongation` (major/minor
 * standard-deviation ratio): 1 = perfectly round/square, larger = more stretched.
 */
export function principalAxis(ring: Path): { angleDeg: number; elongation: number } {
  const n = ring.length;
  if (n < 3) return { angleDeg: 0, elongation: 1 };

  // Shoelace area + first/second area moments in one pass.
  let a2 = 0; // 2·area
  let cx = 0, cy = 0;
  let ixx = 0, iyy = 0, ixy = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
    iyy += (p.x * p.x + p.x * q.x + q.x * q.x) * cross; // ∫ x² dA · 12
    ixx += (p.y * p.y + p.y * q.y + q.y * q.y) * cross; // ∫ y² dA · 12
    ixy += (p.x * q.y + 2 * p.x * p.y + 2 * q.x * q.y + q.x * p.y) * cross; // ∫ xy dA · 24
  }
  const area = a2 / 2;
  if (Math.abs(area) < 1e-9) return { angleDeg: 0, elongation: 1 };
  cx /= 3 * a2;
  cy /= 3 * a2;

  // Central variances/covariance of the area distribution.
  const varX = iyy / (12 * area) - cx * cx;
  const varY = ixx / (12 * area) - cy * cy;
  const covXY = ixy / (24 * area) - cx * cy;

  // Major-axis direction and eigenvalues of [[varX, covXY],[covXY, varY]].
  const angleDeg = (0.5 * Math.atan2(2 * covXY, varX - varY) * 180) / Math.PI;
  const mean = (varX + varY) / 2;
  const diff = Math.sqrt(((varX - varY) / 2) ** 2 + covXY * covXY);
  const lambdaMin = Math.max(0, mean - diff);
  const elongation = lambdaMin > 1e-9 ? Math.sqrt((mean + diff) / lambdaMin) : Infinity;
  return { angleDeg, elongation };
}

/** Below this major/minor ratio a shape reads as roundish/square. */
const ELONGATION_THRESHOLD = 1.3;
/** Fill angle (°) for roundish shapes — off-axis so rows don't band on edges. */
const ROUND_FILL_ANGLE = 45;

/**
 * The fill angle a region wants (docs/stitch-logic.md §3/#4): elongated shapes
 * flow along their grain (the major axis) so stitches follow the form; roundish
 * or square shapes use an off-axis 45° so rows never align with a straight edge
 * and band. `offsetDeg` (the user's Angle field, default 0) nudges either choice.
 */
export function autoFillAngle(rings: Path[], offsetDeg = 0): number {
  const outer = rings.find((r) => r.length >= 3);
  if (!outer) return offsetDeg;
  const { angleDeg, elongation } = principalAxis(outer);
  const base = elongation >= ELONGATION_THRESHOLD ? angleDeg : ROUND_FILL_ANGLE;
  return base + offsetDeg;
}

/**
 * Nonzero-winding spans of the horizontal line `y` across all rings. The rings
 * must be consistently wound (run them through `orientByDepth`): a span is open
 * where the running winding number is non-zero, so counters cut out and
 * overlapping outers merge.
 */
function rowSpans(rings: Path[], y: number): [number, number][] {
  const crossings: { x: number; dir: number }[] = [];
  for (const ring of rings) {
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % m];
      // Half-open test avoids counting a shared vertex twice.
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        crossings.push({ x: a.x + t * (b.x - a.x), dir: b.y > a.y ? 1 : -1 });
      }
    }
  }
  crossings.sort((p, q) => p.x - q.x);
  const spans: [number, number][] = [];
  let wind = 0;
  let startX = 0;
  for (const c of crossings) {
    const prev = wind;
    wind += c.dir;
    if (prev === 0 && wind !== 0) startX = c.x;
    else if (prev !== 0 && wind === 0) spans.push([startX, c.x]);
  }
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
  // Orient for nonzero winding so counters cut and overlapping outers merge.
  const oriented = orientByDepth(rings);
  if (oriented.length === 0 || oriented[0].length < 3) return [];
  const spacing = opts.stitchLength ?? FILL_STITCH_LENGTH;
  const density = Math.max(0.05, opts.density);

  // Work in a rotated frame where rows are horizontal.
  const pivot = centroid(oriented[0]);
  const rrings = oriented.map((r) => r.map((p) => rotatePoint(p, -opts.angle, pivot)));

  // Span the whole region (every ring), not just the first.
  let minY = Infinity,
    maxY = -Infinity;
  for (const ring of rrings) {
    for (const p of ring) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  // Extend each row a touch past the edge for pull compensation, capped so a tiny
  // span can't be pushed inside-out.
  const comp = Math.max(0, opts.pullCompMm ?? 0);

  const rotated: Point[] = [];
  let k = 0;
  for (let y = minY + density / 2; y <= maxY; y += density, k++) {
    const spans = rowSpans(rrings, y);
    if (spans.length === 0) continue;
    const phase = (k % 2) * (spacing / 2);
    const rowPts: Point[] = [];
    for (const [x0, x1] of spans) {
      const c = Math.min(comp, (x1 - x0) / 2);
      rowPts.push(...alongRow(x0 - c, x1 + c, y, spacing, phase));
    }
    if (k % 2 === 1) rowPts.reverse(); // serpentine
    rotated.push(...rowPts);
  }

  // Back to the original orientation.
  return rotated.map((p) => rotatePoint(p, opts.angle, pivot));
}

/**
 * Column (satin) fill: like tatami, but each scan row emits only the two span
 * edges as a zig-zag throw across the shape. That gives the smooth, shiny satin
 * look used for lettering. Best for narrow strokes (text); broad areas should
 * use tatamiFill. Density is the row spacing (a satin's stitch spacing).
 */
export function columnSatinFill(rings: Path[], opts: FillOptions): Path {
  const oriented = orientByDepth(rings);
  if (oriented.length === 0 || oriented[0].length < 3) return [];
  const density = Math.max(0.05, opts.density);

  const pivot = centroid(oriented[0]);
  const rrings = oriented.map((r) => r.map((p) => rotatePoint(p, -opts.angle, pivot)));

  let minY = Infinity,
    maxY = -Infinity;
  for (const ring of rrings) {
    for (const p of ring) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const pairs: [Point, Point][] = [];
  let k = 0;
  for (let y = minY + density / 2; y <= maxY; y += density, k++) {
    const spans = rowSpans(rrings, y);
    if (spans.length === 0) continue;
    // Alternate the leading edge each row so consecutive throws chain into a
    // continuous zig-zag column (the satin).
    for (const [x0, x1] of spans) {
      pairs.push(k % 2 === 0 ? [{ x: x0, y }, { x: x1, y }] : [{ x: x1, y }, { x: x0, y }]);
    }
  }
  // Split throws wider than a safe length (staggered split satin) before rotating.
  return staggeredSatin(pairs, MAX_THROW_MM).map((p) => rotatePoint(p, opts.angle, pivot));
}

import type { Path, Point } from "../../types/project";
import { rotatePoint } from "./resample";
import { staggeredSatin } from "./satin";
import { motifById, type Motif } from "./motifs";

/** Longest single satin throw (mm) before it is split for safety. */
const MAX_THROW_MM = 7;

/**
 * Densest row spacing (mm) any fill will ever stitch — the same machine-safety
 * floor the engine applies, enforced here too so a direct caller (a test, the
 * contour fallback) can't pack thread tighter than the needle can clear.
 */
export const MIN_FILL_DENSITY = 0.3;

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
  /**
   * Gradient/ombré: row spacing ramps from `density` (dense edge) to
   * `density × gradient` (sparse edge) across the fill direction. >1 enables it;
   * undefined/1 = uniform tatami.
   */
  gradient?: number;
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
 * Area moments of a polygon about its OWN centroid: the area plus the central
 * second moments (∫(x-cx)² dA, ∫(y-cy)² dA, ∫(x-cx)(y-cy) dA). These are additive
 * across regions, so summing them describes the dominant SHAPE orientation of a
 * whole object regardless of how its regions are arranged in space.
 */
interface AreaMoments {
  area: number;
  mxx: number;
  myy: number;
  mxy: number;
}

function areaMoments(ring: Path): AreaMoments {
  const n = ring.length;
  if (n < 3) return { area: 0, mxx: 0, myy: 0, mxy: 0 };
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
  if (Math.abs(area) < 1e-9) return { area: 0, mxx: 0, myy: 0, mxy: 0 };
  cx /= 3 * a2;
  cy /= 3 * a2;
  // Central moments = raw second moment − area·centroid² (parallel-axis).
  return {
    area: Math.abs(area),
    mxx: iyy / 12 - area * cx * cx,
    myy: ixx / 12 - area * cy * cy,
    mxy: ixy / 24 - area * cx * cy,
  };
}

/** Major-axis angle (°) and elongation from combined area moments. */
function principalFromMoments(m: AreaMoments): { angleDeg: number; elongation: number } {
  if (m.area < 1e-9) return { angleDeg: 0, elongation: 1 };
  const varX = m.mxx / m.area;
  const varY = m.myy / m.area;
  const covXY = m.mxy / m.area;
  const angleDeg = (0.5 * Math.atan2(2 * covXY, varX - varY) * 180) / Math.PI;
  const mean = (varX + varY) / 2;
  const diff = Math.sqrt(((varX - varY) / 2) ** 2 + covXY * covXY);
  const lambdaMin = Math.max(0, mean - diff);
  const elongation = lambdaMin > 1e-9 ? Math.sqrt((mean + diff) / lambdaMin) : Infinity;
  return { angleDeg, elongation };
}

/**
 * The shape's principal (major) axis from its AREA second moments — the natural
 * "grain" direction a fill should flow along. Area-weighted (not vertex-counted)
 * so a curve sampled with many points doesn't skew the result.
 */
export function principalAxis(ring: Path): { angleDeg: number; elongation: number } {
  return principalFromMoments(areaMoments(ring));
}

/** Below this major/minor ratio a shape reads as roundish/square. */
const ELONGATION_THRESHOLD = 1.3;
/** Fill angle (°) for roundish shapes — off-axis so rows don't band on edges. */
const ROUND_FILL_ANGLE = 45;

/** Turn a base grain (angle + elongation) into a fill angle with the user offset. */
function grainToFillAngle(
  angleDeg: number,
  elongation: number,
  offsetDeg: number,
): number {
  return (elongation >= ELONGATION_THRESHOLD ? angleDeg : ROUND_FILL_ANGLE) + offsetDeg;
}

/**
 * ONE coherent fill angle for an entire multi-region object, so every region
 * shares the same grain and the design reads as a single piece instead of a
 * patchwork of differently-angled letters/blobs (stitch-direction continuity).
 * Combines each region's central area moments (about its own centroid), so the
 * dominant SHAPE orientation wins regardless of how the regions are scattered.
 */
export function autoFillAngleForRegions(regions: Path[][], offsetDeg = 0): number {
  const total: AreaMoments = { area: 0, mxx: 0, myy: 0, mxy: 0 };
  for (const region of regions) {
    const outer = region.find((r) => r.length >= 3);
    if (!outer) continue;
    const m = areaMoments(outer);
    total.area += m.area;
    total.mxx += m.mxx;
    total.myy += m.myy;
    total.mxy += m.mxy;
  }
  if (total.area < 1e-9) return offsetDeg;
  const { angleDeg, elongation } = principalFromMoments(total);
  return grainToFillAngle(angleDeg, elongation, offsetDeg);
}

/**
 * The fill angle a single region wants (docs/stitch-logic.md §3/#4): elongated
 * shapes flow along their grain (the major axis) so stitches follow the form;
 * roundish or square shapes use an off-axis 45° so rows never align with a
 * straight edge and band. `offsetDeg` (the user's Angle field) nudges either.
 */
export function autoFillAngle(rings: Path[], offsetDeg = 0): number {
  const outer = rings.find((r) => r.length >= 3);
  if (!outer) return offsetDeg;
  const { angleDeg, elongation } = principalAxis(outer);
  return grainToFillAngle(angleDeg, elongation, offsetDeg);
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

/** Deterministic fraction in [0,1) — jitter that kills residual moiré. */
function scatterFrac(k: number): number {
  const s = Math.sin((k + 1) * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Row stagger as a fraction of one stitch (0 = aligned with the row start). A
 * 1/4-brick base (0, ¼, ½, ¾ over four rows — the pro default, vs a 1/2 brick
 * that repeats every two rows) plus a small deterministic jitter, so needle
 * penetrations never line up into a diagonal "split line" or moiré. Row 0 of the
 * 4-cycle returns 0 (a full first step, no penetration crowding the span start).
 */
function staggerOffset(k: number): number {
  const q = k % 4;
  if (q === 0) return 0;
  return q / 4 + scatterFrac(k) * 0.1; // 0.25–0.85: safely off both span ends
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
  const density = Math.max(MIN_FILL_DENSITY, opts.density);

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

  // Gradient/ombré: row spacing ramps from `density` (dense) to density×gradient
  // (sparse) across the shape, so the fill reads light→heavy.
  const grad = Math.max(1, opts.gradient ?? 1);
  const spanY = maxY - minY;
  const stepAt = (y: number) =>
    grad === 1 || spanY <= 0 ? density : density * (1 + (grad - 1) * ((y - minY) / spanY));

  const rotated: Point[] = [];
  let k = 0;
  for (let y = minY + density / 2; y <= maxY; y += stepAt(y), k++) {
    const spans = rowSpans(rrings, y);
    if (spans.length === 0) continue;
    const phase = staggerOffset(k) * spacing;
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
 * Multi-blend (ombré of two threads): lay the same tatami grid, but assign each
 * ROW to colour A or colour B by its position across the blend axis, so the fill
 * fades from A to B. Color B's share of the rows ramps 0→1 across the shape via
 * 1-D error diffusion (deterministic, evenly spaced — no randomness), and the
 * two colours together make a full-density fill. Returned as two separate
 * penetration paths so the machine sews all of A, changes thread once, then B.
 */
export function multiBlendFill(rings: Path[], opts: FillOptions): { a: Path; b: Path } {
  const oriented = orientByDepth(rings);
  if (oriented.length === 0 || oriented[0].length < 3) return { a: [], b: [] };
  const spacing = opts.stitchLength ?? FILL_STITCH_LENGTH;
  const density = Math.max(MIN_FILL_DENSITY, opts.density);
  const pivot = centroid(oriented[0]);
  const rrings = oriented.map((r) => r.map((p) => rotatePoint(p, -opts.angle, pivot)));

  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rrings) for (const p of ring) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanY = maxY - minY;
  const comp = Math.max(0, opts.pullCompMm ?? 0);

  const rowsA: Point[][] = [];
  const rowsB: Point[][] = [];
  let acc = 0; // error-diffusion accumulator for colour B's row share
  let k = 0;
  for (let y = minY + density / 2; y <= maxY; y += density, k++) {
    const spans = rowSpans(rrings, y);
    if (spans.length === 0) continue;
    const phase = staggerOffset(k) * spacing;
    const rowPts: Point[] = [];
    for (const [x0, x1] of spans) {
      const c = Math.min(comp, (x1 - x0) / 2);
      rowPts.push(...alongRow(x0 - c, x1 + c, y, spacing, phase));
    }
    const t = spanY > 0 ? (y - minY) / spanY : 0; // 0 at A end, 1 at B end
    acc += t;
    const toB = acc >= 1;
    if (toB) acc -= 1;
    (toB ? rowsB : rowsA).push(rowPts);
  }

  // Serpentine each colour's own rows (short travel between them) and rotate back.
  const flatten = (rows: Point[][]): Path => {
    const out: Point[] = [];
    rows.forEach((row, i) => out.push(...(i % 2 === 1 ? [...row].reverse() : row)));
    return out.map((p) => rotatePoint(p, opts.angle, pivot));
  };
  return { a: flatten(rowsA), b: flatten(rowsB) };
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
  const density = Math.max(MIN_FILL_DENSITY, opts.density);

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

/** Even-odd point-in-region over consistently-wound rings. */
function pointInRingsEO(p: Point, rings: Path[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Squared distance from point p to segment a→b. */
function distSqToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + t * dx - p.x;
  const cy = a.y + t * dy - p.y;
  return cx * cx + cy * cy;
}

/**
 * Remove fill penetrations that fall within `distMm` of any carve curve — a
 * TRUE-relief carve: the needle skips the carved lines, leaving un-penetrated
 * grooves the surrounding stitches float over. The fill stays one continuous
 * path (a short float spans each thin groove), so it sews safely. Carving reads
 * best where curves cross the rows; a curve running ALONG a row leaves a longer
 * float that the safety splitter may re-stitch (graceful, just less relief).
 */
export function carvePoints(points: Path, curves: Path[], distMm: number): Path {
  if (curves.length === 0) return points;
  const d2 = distMm * distMm;
  // Prune curve segments to those near the fill bbox is overkill here; the curve
  // set is already region-local (tiled motifs), so a direct test is fine.
  const segs: [Point, Point][] = [];
  for (const c of curves) for (let i = 1; i < c.length; i++) segs.push([c[i - 1], c[i]]);
  return points.filter((p) => {
    for (const [a, b] of segs) if (distSqToSeg(p, a, b) <= d2) return false;
    return true;
  });
}

export interface MotifRunOptions {
  motifId: string;
  /** motif cell width in mm. */
  sizeMm: number;
  /** spacing between repeats as a multiple of the cell width (default 1.05). */
  spacingMul?: number;
}

/**
 * Repeat a motif ALONG a path (a decorative motif run / e-stitch): walk the path
 * by arc length and stamp the motif at each step, rotated to the local tangent.
 * Returns one run per motif stroke; the assembler connects them.
 */
export function motifRunAlong(path: Path, opts: MotifRunOptions): Path[] {
  if (path.length < 2) return [];
  const motif: Motif = motifById(opts.motifId);
  const scale = Math.max(0.1, opts.sizeMm) / motif.w;
  const cellW = motif.w * scale;
  const step = cellW * Math.max(0.5, opts.spacingMul ?? 1.05);

  // Arc-length table.
  const segs: { a: Point; b: Point; len: number; acc: number }[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= 0) continue;
    segs.push({ a, b, len, acc: total });
    total += len;
  }
  if (total <= 0) return [];

  const at = (s: number) => {
    let seg = segs[segs.length - 1];
    for (const sg of segs) if (s <= sg.acc + sg.len) { seg = sg; break; }
    const t = Math.max(0, Math.min(1, (s - seg.acc) / seg.len));
    return {
      pt: { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t },
      ang: (Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x) * 180) / Math.PI,
    };
  };

  const out: Path[] = [];
  for (let s = cellW / 2; s <= total; s += step) {
    const { pt, ang } = at(s);
    for (const stroke of motif.strokes) {
      out.push(
        stroke.map((q) => {
          const r = rotatePoint({ x: q.x * scale, y: q.y * scale }, ang, { x: 0, y: 0 });
          return { x: r.x + pt.x, y: r.y + pt.y };
        }),
      );
    }
  }
  return out;
}

export interface MotifFillOptions {
  /** motif id (see motifs.ts). */
  motifId: string;
  /** width of one motif cell in mm. */
  sizeMm: number;
  /** fill direction in degrees (motifs tile along this grain). */
  angle: number;
  /** spacing between cells as a multiple of the cell size (default 1.15). */
  spacingMul?: number;
}

/**
 * Motif fill (Wilcom "design element"): tile a decorative motif across the
 * region in a brick grid, clipped to the shape (a motif is placed when its
 * center lies inside). Returns one run per placed motif stroke; the assembler
 * connects them with travels. Decorative + open, so no underlay/tatami coverage.
 */
export function motifFill(rings: Path[], opts: MotifFillOptions): Path[] {
  const oriented = orientByDepth(rings);
  if (oriented.length === 0 || oriented[0].length < 3) return [];
  const motif: Motif = motifById(opts.motifId);
  const size = Math.max(1, opts.sizeMm);
  const scale = size / motif.w;
  const cellW = motif.w * scale;
  const cellH = motif.h * scale;
  const spacing = Math.max(1, opts.spacingMul ?? 1.15);
  const stepX = cellW * spacing;
  const stepY = cellH * spacing;

  const pivot = centroid(oriented[0]);
  const rrings = oriented.map((r) => r.map((p) => rotatePoint(p, -opts.angle, pivot)));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rrings)
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

  const out: Path[] = [];
  let row = 0;
  for (let y = minY + stepY / 2; y <= maxY; y += stepY, row++) {
    const xOff = row % 2 === 1 ? stepX / 2 : 0; // brick offset
    for (let x = minX + stepX / 2 + xOff; x <= maxX; x += stepX) {
      if (!pointInRingsEO({ x, y }, rrings)) continue;
      for (const stroke of motif.strokes) {
        out.push(
          stroke.map((p) =>
            rotatePoint({ x: x + p.x * scale, y: y + p.y * scale }, opts.angle, pivot),
          ),
        );
      }
    }
  }
  return out;
}

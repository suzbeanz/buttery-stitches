/**
 * WELD SLIVER GAPS — repair a traced region whose hole runs a hair inside its
 * own outer boundary.
 *
 * ImageTracer occasionally emits a colour's region as (full outline) + (hole
 * covering the neighbouring area) where the hole's boundary tracks the outer at
 * sub-thread distance along their shared perimeter — the anti-aliased boundary
 * pixels got quantized to this colour, so a 0.2–0.9 mm "crescent" of ink rings
 * the region. That band is UNSEWABLE as fill (thinner than two rows of thread)
 * and stitches as a zigzag ridge under whatever sews next — the recurring "red
 * fringe" on a halved crest. The true geometry has the hole boundary COINCIDING
 * with the outer along that stretch, so we weld it: snap the near-outer
 * stretches of the hole onto the outer and rebuild the region's topology.
 *
 * The pass is deliberately conservative — it returns null (keep the original
 * rings) unless a substantial stretch is unambiguously a weld:
 *   - only stretches whose MEAN gap is sub-thread weld (a deliberate,
 *     consistent ~0.9 mm pinstripe survives);
 *   - short approaches (a hole merely pinching toward the outline) survive;
 *   - if welding would erase a large share of the region's ink, the region IS
 *     its thin band (a letter counter, a traced ring) — refuse and let the
 *     line-art classifier handle it.
 *
 * Rebuilding uses the raster boolean (subtract) rather than snap-only geometry:
 * coincident outer/hole edges produce zero-width scanline spans that the fill
 * engine would still stitch as a picket line of penetrations; the boolean
 * genuinely removes the crescent and fuses the free stretch (the real divider)
 * into one simple ring. Interior holes re-emerge unchanged.
 */
import type { Path, Point } from "../../types/project";
import { booleanOp } from "../boolean";
import { polygonArea, polygonPerimeter } from "./classify";

/** A hole vertex this close to the outer is a weld candidate. */
const WELD_GAP_MM = 1.0;
/** Candidate runs separated by less arc than this merge into one weld (a lone
 *  far vertex mid-crescent must not split the weld into oscillating fragments). */
const WELD_BRIDGE_MM = 1.5;
/** A weld run must be at least this long — a point-approach is real geometry. */
const WELD_MIN_RUN_MM = 2.5;
/** …and its mean gap must be truly sub-thread. Two 0.4 mm fill rows need
 *  0.8 mm, so any band whose MEAN is below that can only sew as a ridge, never
 *  as coverage. (A real crest's crescent measured mean 0.73 mm — a 0.7 cutoff
 *  missed it by a hair; the physical two-row line is the honest threshold.) */
const WELD_MEAN_GAP_MM = 0.8;
/** Refuse the weld when it would erase more than this share of the region's
 *  ink: then the thin band IS the region (a letter counter's bowl, a traced
 *  ring) and belongs to the line-art path, not to topology repair. */
const WELD_MAX_INK_LOSS_FRAC = 0.25;
/** Hole rings are densified to this spacing so a DP-simplified 40 mm straight
 *  stretch doesn't get judged (and snapped) by its two endpoints alone. */
const WELD_SAMPLE_MM = 1.0;
/** Raster cell for the topology rebuild — fine enough that the straightening
 *  pass downstream recovers clean edges. */
const WELD_BOOL_CELL_MM = 0.15;

/** Insert midpoints until no segment of the closed ring exceeds `maxSeg`. */
function resampleRing(ring: Path, maxSeg: number): Path {
  const out: Path = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push(a);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.floor(len / maxSeg);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Nearest point on segment ab to p. */
function projectOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return { ...a };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Nearest point on the closed ring `outer` to p, and its distance. */
function nearestOnRing(p: Point, outer: Path): { q: Point; d: number } {
  let best: Point = outer[0];
  let bd = Infinity;
  for (let i = 0; i < outer.length; i++) {
    const q = projectOnSegment(p, outer[i], outer[(i + 1) % outer.length]);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return { q: best, d: bd };
}

/** Maximal cyclic runs of `true` in `mask`, as [start, end] index pairs
 *  (inclusive, may wrap). Returns [] when nothing is set; a single full-ring
 *  run is returned as [0, n-1]. */
function cyclicRuns(mask: boolean[]): [number, number][] {
  const n = mask.length;
  if (mask.every(Boolean)) return [[0, n - 1]];
  if (!mask.some(Boolean)) return [];
  const runs: [number, number][] = [];
  // Start scanning just after a false so no run is split by the wrap point.
  const s = mask.findIndex((v) => !v);
  let runStart = -1;
  for (let k = 1; k <= n; k++) {
    const i = (s + k) % n;
    if (mask[i] && runStart < 0) runStart = i;
    if (!mask[i] && runStart >= 0) {
      runs.push([runStart, (i - 1 + n) % n]);
      runStart = -1;
    }
  }
  if (runStart >= 0) runs.push([runStart, s]);
  return runs;
}

export interface WeldOptions {
  /** Rebuilt rings smaller than this are dropped (same despeckle floor the
   *  tracer applies to fresh regions). */
  minAreaMm2: number;
}

/**
 * Weld the near-outer stretches of `holes` onto `outer` and rebuild the region.
 * Returns the rebuilt rings (outer + holes, even-odd), or null when nothing
 * needed welding — the caller keeps its original rings untouched.
 */
export function weldSliverGaps(outer: Path, holes: Path[], opts: WeldOptions): Path[] | null {
  if (holes.length === 0 || outer.length < 3) return null;
  const outerArea = Math.abs(polygonArea(outer));
  const holeAreaTotal = holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0);
  const inkArea = Math.max(1e-6, outerArea - holeAreaTotal);

  let weldedAny = false;
  let weldLoss = 0;
  const snapped: Path[] = holes.map((hole) => {
    if (hole.length < 3) return hole;
    const dense = resampleRing(hole, WELD_SAMPLE_MM);
    const near = dense.map((p) => nearestOnRing(p, outer));
    const cand = near.map((r) => r.d <= WELD_GAP_MM);
    // Arc length of each dense segment i → i+1 (cyclic).
    const segLen = dense.map((p, i) => {
      const b = dense[(i + 1) % dense.length];
      return Math.hypot(b.x - p.x, b.y - p.y);
    });
    let runs = cyclicRuns(cand);
    if (runs.length === 0) return hole;
    // Bridge: merge runs whose separating arc is shorter than WELD_BRIDGE_MM —
    // one outlier vertex mid-crescent must not fragment the weld.
    const arcBetween = (endA: number, startB: number): number => {
      let arc = 0;
      for (let i = endA; i !== startB; i = (i + 1) % dense.length) arc += segLen[i];
      return arc;
    };
    if (runs.length > 1) {
      const merged: [number, number][] = [];
      let cur = runs[0];
      for (let k = 1; k <= runs.length; k++) {
        const nxt = runs[k % runs.length];
        if (k < runs.length && arcBetween(cur[1], nxt[0]) <= WELD_BRIDGE_MM) {
          cur = [cur[0], nxt[1]];
        } else {
          merged.push(cur);
          cur = nxt;
        }
      }
      runs = merged;
    }
    // Accept runs: long enough AND mean gap truly sub-thread.
    const runIndices = (r: [number, number]): number[] => {
      const idx: number[] = [];
      for (let i = r[0]; ; i = (i + 1) % dense.length) {
        idx.push(i);
        if (i === r[1]) break;
      }
      return idx;
    };
    const accepted = runs.filter((r) => {
      const idx = runIndices(r);
      const arc = idx.slice(0, -1).reduce((s, i) => s + segLen[i], 0);
      const mean = idx.reduce((s, i) => s + near[i].d, 0) / idx.length;
      return arc >= WELD_MIN_RUN_MM && mean <= WELD_MEAN_GAP_MM;
    });
    if (accepted.length === 0) return hole;
    // Loss this weld removes ≈ Σ (mean gap of segment) · segment length.
    const inRun = new Array(dense.length).fill(false);
    for (const r of accepted) for (const i of runIndices(r)) inRun[i] = true;
    for (let i = 0; i < dense.length; i++) {
      if (inRun[i] && inRun[(i + 1) % dense.length]) {
        weldLoss += ((near[i].d + near[(i + 1) % dense.length].d) / 2) * segLen[i];
      }
    }
    weldedAny = true;
    return dense.map((p, i) => (inRun[i] ? near[i].q : p));
  });

  if (!weldedAny) return null;
  // The thin band IS the region (a counter, a traced ring): refuse — the
  // line-art classifier owns that geometry.
  if (weldLoss > WELD_MAX_INK_LOSS_FRAC * inkArea) return null;

  // Rebuild topology for real: post-snap the crescent has zero width, so the
  // raster boolean removes it and fuses the free stretch (the true divider)
  // into one simple ring; interior holes re-emerge as holes. Rebuilt rings are
  // also screened by MEAN WIDTH: a corner of the crescent can survive as a
  // detached flake wide enough to pass the area floor yet still thinner than
  // two fill rows — unsewable either as ink (a ridge) or as a hole (rows
  // bridge it), so it never belongs in the output.
  const meanWidthMm = (r: Path): number => {
    const a = Math.abs(polygonArea(r));
    const p = polygonPerimeter(r);
    return p > 0 ? (2 * a) / p : 0;
  };
  const rebuilt = booleanOp([outer], snapped, "subtract", WELD_BOOL_CELL_MM)
    .filter((r) => Math.abs(polygonArea(r)) >= opts.minAreaMm2 && meanWidthMm(r) >= WELD_MEAN_GAP_MM);
  // Never destroy a region outright — an empty/failed boolean keeps originals.
  if (rebuilt.length === 0) return null;
  return rebuilt;
}

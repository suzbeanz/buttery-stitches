import type { Project, EmbObject, Point } from "../../types/project";
import { designFor, type EngineStitch } from "../engine";
import { designInfo, type DesignInfo } from "../engine/info";
import { simulateDistortion } from "./distortion";

/**
 * Benchmark metrics — the objective scoreboard for the stitch engine.
 *
 * Everything here is a PURE function of the compiled stitch stream (and, for
 * coverage, the source fill geometry). The point is to make "is the engine
 * getting better / beating the leading commercial tools" a number on a shared corpus instead of an
 * opinion: stitch economy, travel/trim efficiency, penetration-spacing
 * uniformity, and how completely the fills actually cover their regions.
 *
 * `designInfo` already gives the production-estimate basics (stitches, jumps,
 * trims, colours, thread length, runtime, bbox). This adds the quality/efficiency
 * dimensions it lacks. Lower-is-better unless noted.
 */

/** A stitched segment shorter than this (mm) is a needle-stress / lint risk. */
export const SHORT_STITCH_MM = 0.8;
/** Assumed laid-thread width (mm) for the coverage raster (≈ 40wt polyneon). */
export const THREAD_WIDTH_MM = 0.4;
/** Coverage raster cell (mm). Fine enough to resolve the gap a row pitch wider
 *  than the thread leaves (so the metric can actually see over-/under-stitching),
 *  cheap enough to run over the corpus. */
export const COVERAGE_CELL_MM = 0.15;

export interface StitchLenStats {
  min: number;
  mean: number;
  median: number;
  p95: number;
  max: number;
  /** coefficient of variation (std/mean) — penetration-spacing evenness; lower = smoother. */
  cv: number;
  /** fraction of stitched segments shorter than SHORT_STITCH_MM. */
  shortPct: number;
}

export interface BenchMetrics extends DesignInfo {
  /** total straight-line distance of jump/travel moves (mm). Lower = tighter routing. */
  travelMm: number;
  /** travel ÷ (travel + thread): the share of needle motion that lays no thread. Lower is better. */
  travelRatio: number;
  /** distribution of real stitched-segment lengths (mm). */
  stitchLen: StitchLenStats;
  /** thread coverage of the fill regions in [0,1] (covered area ÷ region area), or
   *  null when the design has no fill objects. Higher is better (1 = full coverage). */
  fillCoverage: number | null;
  /** predicted net pull-in (mm) from the fabric-pull simulation — how far the sewn
   *  shape gathers inward under thread tension. Lower is better; what pull
   *  compensation exists to cancel. */
  pullInMm: number;
  /** predicted worst single-point displacement (mm) from the same simulation. */
  distortMaxMm: number;
}

/** True when a stitch is a real needle penetration (not a jump/trim/stop marker). */
function isReal(s: EngineStitch): boolean {
  return !s.jump && !s.trim && !s.stop;
}

/** Lengths (mm) of every real stitched segment — consecutive penetrations in the
 *  same colour with no jump/trim between them (mirrors designInfo's thread sum). */
export function stitchSegmentLengths(design: EngineStitch[]): number[] {
  const out: number[] = [];
  let prev: EngineStitch | null = null;
  for (const s of design) {
    if (isReal(s) && prev && isReal(prev) && prev.colorId === s.colorId) {
      out.push(Math.hypot(s.x - prev.x, s.y - prev.y));
    }
    prev = s;
  }
  return out;
}

/** Total travel distance (mm) carried by jump moves. */
export function travelLengthMm(design: EngineStitch[]): number {
  let travel = 0;
  let prev: EngineStitch | null = null;
  for (const s of design) {
    if (s.jump && prev) travel += Math.hypot(s.x - prev.x, s.y - prev.y);
    prev = s;
  }
  return travel;
}

export function summarizeLengths(lengths: number[]): StitchLenStats {
  if (lengths.length === 0) {
    return { min: 0, mean: 0, median: 0, p95: 0, max: 0, cv: 0, shortPct: 0 };
  }
  const sorted = [...lengths].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const at = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];
  const shortCount = sorted.filter((l) => l < SHORT_STITCH_MM).length;
  return {
    min: sorted[0],
    mean,
    median: at(0.5),
    p95: at(0.95),
    max: sorted[n - 1],
    cv: mean > 0 ? Math.sqrt(variance) / mean : 0,
    shortPct: shortCount / n,
  };
}

/** Even-odd point membership across all of a path's rings (outer XOR holes). */
function pointInRings(p: Point, rings: { x: number; y: number }[][]): boolean {
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

/**
 * Thread coverage of the fill regions: rasterize the design's fill polygons into
 * "target" cells, stamp every real stitched segment (with thread width) into
 * "covered" cells, and return covered∩target ÷ target. Approximate (raster + a
 * nominal thread width) but a real, comparable number — a low value means the
 * fill is leaving gaps. Returns null when there are no fill objects.
 */
export function fillCoverage(
  project: Project,
  design: EngineStitch[],
  cellMm = COVERAGE_CELL_MM,
  threadWidthMm = THREAD_WIDTH_MM,
): number | null {
  const fills = project.objects.filter((o) => o.type === "fill" && o.visible && o.paths.length > 0);
  if (fills.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of fills) {
    for (const ring of o.paths) {
      for (const pt of ring) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
  }
  const pad = threadWidthMm;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cellMm));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cellMm));
  const idx = (c: number, r: number) => r * cols + c;
  const target = new Uint8Array(cols * rows);
  const covered = new Uint8Array(cols * rows);

  // Target = cell centres inside any fill region.
  let targetCount = 0;
  for (let r = 0; r < rows; r++) {
    const y = minY + (r + 0.5) * cellMm;
    for (let c = 0; c < cols; c++) {
      const x = minX + (c + 0.5) * cellMm;
      for (const o of fills) {
        if (pointInRings({ x, y }, o.paths)) {
          target[idx(c, r)] = 1;
          targetCount++;
          break;
        }
      }
    }
  }
  if (targetCount === 0) return null;

  // Covered = cells whose centre lies within half the thread width of a real
  // stitched segment (accurate point-to-segment distance, not a square stamp — the
  // square over-covered and hid the density/coverage tradeoff). The thread footprint
  // is the simplest physical model: a capsule of width `threadWidthMm` along each
  // stitch.
  const half = threadWidthMm / 2;
  const distToSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const markSeg = (ax: number, ay: number, bx: number, by: number) => {
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - half - minX) / cellMm));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) + half - minX) / cellMm));
    const r0 = Math.max(0, Math.floor((Math.min(ay, by) - half - minY) / cellMm));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) + half - minY) / cellMm));
    for (let r = r0; r <= r1; r++) {
      const y = minY + (r + 0.5) * cellMm;
      for (let c = c0; c <= c1; c++) {
        const i = idx(c, r);
        if (covered[i]) continue;
        const x = minX + (c + 0.5) * cellMm;
        if (distToSeg(x, y, ax, ay, bx, by) <= half) covered[i] = 1;
      }
    }
  };
  let prev: EngineStitch | null = null;
  for (const s of design) {
    if (isReal(s) && prev && isReal(prev) && prev.colorId === s.colorId) {
      markSeg(prev.x, prev.y, s.x, s.y);
    }
    prev = s;
  }

  let hit = 0;
  for (let i = 0; i < target.length; i++) if (target[i] && covered[i]) hit++;
  return hit / targetCount;
}

/** Compile a project and score it. */
export function benchMetrics(project: Project): BenchMetrics {
  const design = designFor(project);
  const info = designInfo(design, project);
  const travelMm = travelLengthMm(design);
  const stitchLen = summarizeLengths(stitchSegmentLengths(design));
  const travelRatio =
    travelMm + info.threadLengthMm > 0 ? travelMm / (travelMm + info.threadLengthMm) : 0;
  const distort = simulateDistortion(design);
  return {
    ...info,
    travelMm,
    travelRatio,
    stitchLen,
    fillCoverage: fillCoverage(project, design),
    pullInMm: distort.pullInMm,
    distortMaxMm: distort.maxMm,
  };
}

export type { EmbObject };

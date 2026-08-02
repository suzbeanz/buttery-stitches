import type { ThreadColor } from "../../types/project";
import type { EngineStitch } from "../engine";
import type { RasterImage } from "../trace/quantize";
import {
  borderIsTransparent,
  borderIsSolidOpaque,
  borderBackgroundColor,
  removeInnerBackdrop,
} from "../trace/quantize";
import { colorDistance } from "../thread/match";
import { THREAD_WIDTH_MM } from "./metrics";

/**
 * FIDELITY: "did the exported stitches capture the uploaded image?" as one
 * deterministic 0–100 number, plus the component scores that explain it.
 *
 * Both the source image and the compiled stitch stream are rasterized into the
 * same mm-space color-label grid (cells labeled by nearest thread color, or
 * background), then compared four ways:
 *
 *  - regionIoU   — per thread color, intersection-over-union of where the image
 *                  wants that color vs where stitches actually lay it. The
 *                  geometry term. Weighted by √area so a small-but-critical
 *                  region (an eye, a letter) counts more than proportionally.
 *  - chamferMm   — mean symmetric distance between the image's color boundaries
 *                  and the stitched color boundaries. The edge-accuracy term:
 *                  this is the number a better tracer must move.
 *  - deltaE      — mean CIELAB distance between each source pixel and the thread
 *                  color assigned to it. The irreducible thread-gamut term —
 *                  reported honestly, not hidden.
 *  - spill       — fraction of stitched cells landing on source background.
 *
 * Pure math over typed arrays — no canvas, no DOM — so it runs identically in
 * vitest, the bench harness, and the browser. Determinism is the point: the
 * corpus ratchet in imagepipeline.test.ts fails on any regression.
 */

export interface FidelityResult {
  /** composite 0–100 (higher = the file captures the image better). */
  score: number;
  /** √area-weighted mean IoU across thread colors, 0–1. */
  regionIoU: number;
  /** mean symmetric boundary distance, mm (capped at {@link CHAMFER_CAP_MM}). */
  chamferMm: number;
  /** coverage-weighted mean ΔE (CIELAB) between source pixels and their thread. */
  deltaE: number;
  /** fraction of stitched area landing on source background, 0–1. */
  spill: number;
}

/** Grid cell size (mm). 0.15 resolves half a thread width; the dialog may pass
 *  a coarser cell for interactive use. */
export const FIDELITY_CELL_MM = 0.15;
/** Boundary distances are capped here (mm) so one stray region can't blow up
 *  the mean; beyond ~2 mm an edge is simply "wrong", not "wronger". */
export const CHAMFER_CAP_MM = 2;
/** Alpha below this is background (matches the trace pipeline's cutoff). */
const ALPHA_CUTOFF = 128;
/** A pixel this close (ΔE) to the detected page color counts as page. */
const PAGE_DELTA_E = 12;

interface Grid {
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  cellMm: number;
  /** thread index per cell, or -1 for background/empty. */
  labels: Int16Array;
}

/** Label every grid cell with the thread color nearest the source pixel under
 *  it, or -1 for background (transparent, or the detected opaque page color —
 *  the same page detection the trace pipeline uses). */
export function rasterizeSource(
  source: RasterImage,
  mmPerPx: number,
  colors: ThreadColor[],
  grid: Omit<Grid, "labels">,
  removeBackground = true,
  offsetX = 0,
  offsetY = 0,
): { labels: Int16Array; deltaESum: number; foreground: number } {
  const { cols, rows, minX, minY, cellMm } = grid;
  const labels = new Int16Array(cols * rows).fill(-1);
  const transparentBorder = borderIsTransparent(source);
  // Mirror the trace pipeline's background model (imageDataToObjects): with
  // removal on, an opaque page color at the border is background, and a solid
  // CARD floating in transparent margins is peeled at the raster level — the
  // target the stitches are judged against is the image minus what the user
  // asked to remove.
  if (removeBackground && transparentBorder) {
    const stripped = removeInnerBackdrop(source);
    if (stripped) source = stripped.image;
  }
  // Same 0.35 dominance the trace uses to consider a border color background at
  // all — with per-pixel noise (scans, JPEG) the strict default misses the page
  // and the metric would demand the page be stitched. The ΔE tolerance below
  // absorbs the noise around the detected page color.
  const pageRgb =
    removeBackground && !transparentBorder && borderIsSolidOpaque(source, 0.35)
      ? borderBackgroundColor(source)
      : null;

  // Per-source-pixel nearest-thread assignment is the hot loop; cache it per
  // quantized RGB so each distinct color pays the Lab conversion once.
  const nearestCache = new Map<number, number>();
  const nearestThreadIdx = (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b;
    const hit = nearestCache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < colors.length; i++) {
      const d = colorDistance([r, g, b], colors[i].rgb);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    nearestCache.set(key, best);
    return best;
  };

  let deltaESum = 0;
  let foreground = 0;
  for (let row = 0; row < rows; row++) {
    const yMm = minY + (row + 0.5) * cellMm;
    const py = Math.floor((yMm - offsetY) / mmPerPx);
    if (py < 0 || py >= source.height) continue;
    for (let col = 0; col < cols; col++) {
      const xMm = minX + (col + 0.5) * cellMm;
      const px = Math.floor((xMm - offsetX) / mmPerPx);
      if (px < 0 || px >= source.width) continue;
      const o = (py * source.width + px) * 4;
      if (source.data[o + 3] < ALPHA_CUTOFF) continue; // transparent = background
      const r = source.data[o];
      const g = source.data[o + 1];
      const b = source.data[o + 2];
      if (pageRgb && colorDistance([r, g, b], pageRgb) < PAGE_DELTA_E) continue; // page
      const idx = nearestThreadIdx(r, g, b);
      labels[row * cols + col] = idx;
      deltaESum += colorDistance([r, g, b], colors[idx].rgb);
      foreground++;
    }
  }
  return { labels, deltaESum, foreground };
}

/** Stamp every real stitched segment into the grid as a thread-width capsule,
 *  in sew order — later stitches overwrite earlier ones, matching the physical
 *  "last sewn wins" (and the engine's buried-detail model). */
export function rasterizePlan(
  design: EngineStitch[],
  colors: ThreadColor[],
  grid: Omit<Grid, "labels">,
  threadWidthMm = THREAD_WIDTH_MM,
): Int16Array {
  const { cols, rows, minX, minY, cellMm } = grid;
  const labels = new Int16Array(cols * rows).fill(-1);
  const colorIdx = new Map(colors.map((c, i) => [c.id, i]));
  const half = threadWidthMm / 2;

  const stamp = (ax: number, ay: number, bx: number, by: number, label: number) => {
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - half - minX) / cellMm));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) + half - minX) / cellMm));
    const r0 = Math.max(0, Math.floor((Math.min(ay, by) - half - minY) / cellMm));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) + half - minY) / cellMm));
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    for (let r = r0; r <= r1; r++) {
      const y = minY + (r + 0.5) * cellMm;
      for (let c = c0; c <= c1; c++) {
        const x = minX + (c + 0.5) * cellMm;
        let t = L2 > 1e-12 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ddx = x - (ax + t * dx);
        const ddy = y - (ay + t * dy);
        if (ddx * ddx + ddy * ddy <= half * half) labels[r * cols + c] = label;
      }
    }
  };

  let prev: EngineStitch | null = null;
  for (const s of design) {
    const real = !s.jump && !s.stop;
    if (real && prev && !prev.jump && !prev.stop && prev.colorId === s.colorId && !s.trim) {
      const label = colorIdx.get(s.colorId);
      if (label !== undefined) stamp(prev.x, prev.y, s.x, s.y, label);
    }
    prev = s;
  }
  return labels;
}

/** Cells whose label differs from a 4-neighbor (or the edge) — the color
 *  boundaries of a label grid, background included as a "color". */
function boundaryCells(labels: Int16Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const v = labels[i];
      if (v === -1) continue; // boundary lives on the foreground side
      if (
        (c > 0 && labels[i - 1] !== v) ||
        (c < cols - 1 && labels[i + 1] !== v) ||
        (r > 0 && labels[i - cols] !== v) ||
        (r < rows - 1 && labels[i + cols] !== v)
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}

/** Two-pass 3/4-chamfer distance (in cell units ×3) to the nearest set cell. */
function chamferDistance(set: Uint8Array, cols: number, rows: number): Int32Array {
  const INF = 1 << 29;
  const d = new Int32Array(cols * rows).fill(INF);
  for (let i = 0; i < set.length; i++) if (set[i]) d[i] = 0;
  // forward
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let v = d[i];
      if (c > 0) v = Math.min(v, d[i - 1] + 3);
      if (r > 0) {
        v = Math.min(v, d[i - cols] + 3);
        if (c > 0) v = Math.min(v, d[i - cols - 1] + 4);
        if (c < cols - 1) v = Math.min(v, d[i - cols + 1] + 4);
      }
      d[i] = v;
    }
  }
  // backward
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      let v = d[i];
      if (c < cols - 1) v = Math.min(v, d[i + 1] + 3);
      if (r < rows - 1) {
        v = Math.min(v, d[i + cols] + 3);
        if (c < cols - 1) v = Math.min(v, d[i + cols + 1] + 4);
        if (c > 0) v = Math.min(v, d[i + cols - 1] + 4);
      }
      d[i] = v;
    }
  }
  return d;
}

/** Mean distance (mm, capped) from every cell of `from` to the nearest cell of
 *  `to`. Returns 0 when `from` is empty (nothing to be wrong about). */
function meanBoundaryDistance(
  from: Uint8Array,
  toDist: Int32Array,
  cellMm: number,
): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < from.length; i++) {
    if (!from[i]) continue;
    const mm = (toDist[i] / 3) * cellMm;
    sum += Math.min(mm, CHAMFER_CAP_MM);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Score how faithfully a compiled stitch stream reproduces the source image.
 * Returns null when there is nothing to compare (no foreground, no stitches).
 *
 * `mmPerPx` is the same scale the trace ran at, so source pixel (px,py) sits at
 * mm (px·mmPerPx, py·mmPerPx) — the coordinate frame the stitches live in.
 */
export function fidelityScore(
  source: RasterImage,
  design: EngineStitch[],
  colors: ThreadColor[],
  mmPerPx: number,
  {
    cellMm = FIDELITY_CELL_MM,
    removeBackground = true,
    offsetX = 0,
    offsetY = 0,
  }: { cellMm?: number; removeBackground?: boolean; offsetX?: number; offsetY?: number } = {},
): FidelityResult | null {
  if (colors.length === 0) return null;

  // Grid covers the source extent plus wherever the stitches actually went.
  let minX = offsetX;
  let minY = offsetY;
  let maxX = offsetX + source.width * mmPerPx;
  let maxY = offsetY + source.height * mmPerPx;
  for (const s of design) {
    if (s.jump) continue;
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }
  const pad = THREAD_WIDTH_MM;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cellMm));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cellMm));
  const frame = { cols, rows, minX, minY, cellMm };

  const src = rasterizeSource(source, mmPerPx, colors, frame, removeBackground, offsetX, offsetY);
  if (src.foreground === 0) return null;
  const sewn = rasterizePlan(design, colors, frame);

  // Region IoU per thread color, √area-weighted.
  const inter = new Float64Array(colors.length);
  const union = new Float64Array(colors.length);
  const srcArea = new Float64Array(colors.length);
  let stitched = 0;
  let spilled = 0;
  for (let i = 0; i < sewn.length; i++) {
    const a = src.labels[i];
    const b = sewn[i];
    if (a >= 0) srcArea[a]++;
    if (a >= 0 || b >= 0) {
      if (a === b) inter[a]++;
      if (a >= 0) union[a]++;
      if (b >= 0 && a !== b) union[b]++;
    }
    if (b >= 0) {
      stitched++;
      if (a === -1) spilled++;
    }
  }
  if (stitched === 0) return null;
  let iouSum = 0;
  let weightSum = 0;
  for (let i = 0; i < colors.length; i++) {
    if (union[i] === 0) continue;
    const w = Math.sqrt(srcArea[i] || union[i]);
    iouSum += w * (inter[i] / union[i]);
    weightSum += w;
  }
  const regionIoU = weightSum > 0 ? iouSum / weightSum : 0;

  // Symmetric boundary chamfer.
  const srcEdge = boundaryCells(src.labels, cols, rows);
  const sewnEdge = boundaryCells(sewn, cols, rows);
  const dToSewn = chamferDistance(sewnEdge, cols, rows);
  const dToSrc = chamferDistance(srcEdge, cols, rows);
  const chamferMm =
    (meanBoundaryDistance(srcEdge, dToSewn, cellMm) +
      meanBoundaryDistance(sewnEdge, dToSrc, cellMm)) / 2;

  const deltaE = src.deltaESum / src.foreground;
  const spill = spilled / stitched;

  const score =
    100 *
    (0.5 * regionIoU +
      0.25 * Math.exp(-chamferMm / 0.5) +
      0.15 * Math.max(0, 1 - deltaE / 50) +
      0.1 * (1 - spill));

  return { score, regionIoU, chamferMm, deltaE, spill };
}

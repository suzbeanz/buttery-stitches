import { imageDataToObjects, suggestColorCount, type DigitizeDetail } from "./index";
import { consolidateFringeColors } from "../thread/reduce";
import { createEmptyProject, parseProject } from "../project";
import { fixStitches } from "../fix";
import { generateDesign } from "../engine";
import { fidelityScore } from "../bench/fidelity";

/**
 * FIDELITY-DRIVEN AUTO-TUNE — the "beat the one-shot auto-digitizer" move.
 *
 * Commercial auto-digitize picks its parameters once and hopes; this runs the
 * real pipeline over a small deterministic grid of (color count, detail
 * level), SCORES each candidate against the source image with the fidelity
 * metric, and returns the measured winner. Pure math, no randomness: the same
 * image always tunes to the same choice (ties break toward the suggested
 * color count at balanced detail — the current defaults — by grid order).
 *
 * Scoring runs at a coarser raster cell than the dialog badge for speed; the
 * RELATIVE ordering is what matters.
 */

export interface AutoTuneCandidate {
  colors: number;
  detail: DigitizeDetail;
  score: number;
}

export interface AutoTuneResult extends AutoTuneCandidate {
  candidates: AutoTuneCandidate[];
}

export interface AutoTuneOpts {
  hoopWmm: number;
  hoopHmm: number;
  removeBackground: boolean;
  minColors: number;
  maxColors: number;
  /** scoring raster cell (mm); coarse default for interactive use. */
  cellMm?: number;
}

/** Score one (colors, detail) candidate through the dialog's own apply path. */
export function scoreCandidate(
  imageData: ImageData,
  colors: number,
  detail: DigitizeDetail,
  opts: AutoTuneOpts,
): number {
  const fit = 0.92;
  const mmPerPx = Math.min(opts.hoopWmm / imageData.width, opts.hoopHmm / imageData.height) * fit;
  const offsetX = (opts.hoopWmm - imageData.width * mmPerPx) / 2;
  const offsetY = (opts.hoopHmm - imageData.height * mmPerPx) / 2;
  const traced = imageDataToObjects(imageData, colors, {
    mmPerPx,
    offsetX,
    offsetY,
    removeBackground: opts.removeBackground,
    detail,
  });
  if (traced.objects.length === 0) return 0;
  const res = consolidateFringeColors(
    {
      ...createEmptyProject(),
      widthMm: opts.hoopWmm,
      heightMm: opts.hoopHmm,
      colors: traced.colors,
      objects: traced.objects.map((o) => ({ ...o, visible: true })),
    },
    colors,
  );
  const project = fixStitches(parseProject(res));
  const design = generateDesign(project);
  const f = fidelityScore(imageData, design, project.colors, mmPerPx, {
    cellMm: opts.cellMm ?? 0.4,
    removeBackground: opts.removeBackground,
    offsetX,
    offsetY,
  });
  return f?.score ?? 0;
}

/** The deterministic candidate grid, defaults first (they win ties). */
export function autoTuneGrid(
  imageData: ImageData,
  opts: AutoTuneOpts,
): { colors: number; detail: DigitizeDetail }[] {
  const suggested = suggestColorCount(imageData, opts.minColors, opts.maxColors);
  const colorSet = [...new Set([suggested, suggested - 1, suggested + 1])].filter(
    (c) => c >= opts.minColors && c <= opts.maxColors,
  );
  const details: DigitizeDetail[] = ["balanced", "smooth", "detailed"];
  const grid: { colors: number; detail: DigitizeDetail }[] = [];
  for (const colors of colorSet) {
    for (const detail of details) grid.push({ colors, detail });
  }
  return grid;
}

/**
 * Evaluate the grid and pick the measured best. `onProgress` fires before each
 * candidate (UI ticks); pass `yieldBetween` to await a macrotask between
 * candidates so a busy veil can paint.
 */
export async function autoTune(
  imageData: ImageData,
  opts: AutoTuneOpts,
  onProgress?: (done: number, total: number) => void,
  yieldBetween = false,
): Promise<AutoTuneResult> {
  const grid = autoTuneGrid(imageData, opts);
  const candidates: AutoTuneCandidate[] = [];
  let best: AutoTuneCandidate | null = null;
  for (let i = 0; i < grid.length; i++) {
    onProgress?.(i, grid.length);
    if (yieldBetween) await new Promise((r) => setTimeout(r, 0));
    const { colors, detail } = grid[i];
    const score = scoreCandidate(imageData, colors, detail, opts);
    const cand = { colors, detail, score };
    candidates.push(cand);
    // Strict > keeps the earliest (defaults-first) candidate on ties.
    if (!best || score > best.score) best = cand;
  }
  onProgress?.(grid.length, grid.length);
  return { ...(best ?? { colors: opts.minColors, detail: "balanced", score: 0 }), candidates };
}

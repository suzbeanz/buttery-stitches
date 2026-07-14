import type { EngineStitch } from "./index";

/**
 * Density heat map: where is the design packing too much thread?
 *
 * The per-object density *parameter* says what an object asks for; what the
 * fabric actually feels is PENETRATIONS PER AREA — including underlay, edge
 * runs, and overlapping objects stacking on the same spot. This rasterizes the
 * final stitch stream onto a coarse mm grid so the editor can paint a "too
 * dense here" overlay before anything puckers on real fabric. Pure math.
 */

export interface DensityMap {
  /** grid origin (mm). */
  x0: number;
  y0: number;
  /** cell size (mm). */
  cellMm: number;
  cols: number;
  rows: number;
  /** penetrations per cell, row-major. */
  counts: Uint16Array;
}

export interface DensityCell {
  /** cell center (mm). */
  x: number;
  y: number;
  count: number;
  /** 0..1 — how far past the caution threshold toward the hard ceiling. */
  severity: number;
}

/** Cell size: fine enough to localize a hotspot, coarse enough to stay O(fast). */
export const DENSITY_CELL_MM = 1;

/** Penetrations per mm² where the fabric starts to feel it. With a 0.4 mm-thread
 *  at min row spacing 0.3 mm and stitch length ~0.4 mm (satin), a legitimate
 *  single satin layer peaks around ~8/mm²; stacked layers push well past it. */
export const DENSITY_CAUTION_PER_MM2 = 12;
/** Practically guaranteed thread pile-up / needle deflection territory. */
export const DENSITY_DANGER_PER_MM2 = 24;

/** Rasterize needle penetrations (stitch endpoints, excluding jumps/trims). */
export function buildDensityMap(
  design: EngineStitch[],
  cellMm = DENSITY_CELL_MM,
): DensityMap | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  for (const s of design) {
    if (s.jump || s.trim || s.stop) continue;
    any = true;
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }
  if (!any) return null;
  const x0 = Math.floor(minX / cellMm) * cellMm;
  const y0 = Math.floor(minY / cellMm) * cellMm;
  const cols = Math.max(1, Math.ceil((maxX - x0) / cellMm) + 1);
  const rows = Math.max(1, Math.ceil((maxY - y0) / cellMm) + 1);
  // Backstop for pathological bounds (a corrupt import): cap the grid.
  if (cols * rows > 4_000_000) return null;
  const counts = new Uint16Array(cols * rows);
  for (const s of design) {
    if (s.jump || s.trim || s.stop) continue;
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((s.x - x0) / cellMm)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((s.y - y0) / cellMm)));
    const i = cy * cols + cx;
    if (counts[i] < 65535) counts[i]++;
  }
  return { x0, y0, cellMm, cols, rows, counts };
}

/**
 * The cells worth flagging, with severity 0..1 (caution→danger). Returns cell
 * CENTERS in mm so the canvas can paint translucent squares over the design.
 */
export function hotCells(
  map: DensityMap,
  cautionPerMm2 = DENSITY_CAUTION_PER_MM2,
  dangerPerMm2 = DENSITY_DANGER_PER_MM2,
): DensityCell[] {
  const area = map.cellMm * map.cellMm;
  const caution = cautionPerMm2 * area;
  const danger = dangerPerMm2 * area;
  const out: DensityCell[] = [];
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const count = map.counts[r * map.cols + c];
      if (count <= caution) continue;
      out.push({
        x: map.x0 + (c + 0.5) * map.cellMm,
        y: map.y0 + (r + 0.5) * map.cellMm,
        count,
        severity: Math.min(1, (count - caution) / Math.max(1, danger - caution)),
      });
    }
  }
  return out;
}

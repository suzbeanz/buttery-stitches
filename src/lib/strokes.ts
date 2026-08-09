/**
 * Hand-authoring support for satin stroke centerlines. The engine's authored
 * path (object.satinCenterlines → columnsFromCenterlines) snaps rough strokes
 * to the true outline, so hand-authoring only needs strokes that run roughly
 * down the middle of each stroke at the right angle — exactly what a person
 * drags into place in the stroke editor.
 */
import type { EmbObject, Path, Point } from "../types/project";
import { medialColumns } from "./engine/medial";
import { meanStrokeWidthMm, splitComponents } from "./engine/classify";
import { pathsBounds } from "./geometry";

/** Derive the engine's own auto strokes for an object — the starting point
 *  for hand editing. Per component, width-aware resolution (mirrors the
 *  engine's satin path so what you see is what it would sew). */
export function autoCenterlines(paths: Path[]): Path[] {
  const out: Path[] = [];
  for (const comp of splitComponents(paths)) {
    const b = pathsBounds(comp);
    if (!b) continue;
    const span = Math.min(b.maxX - b.minX, b.maxY - b.minY);
    const strokeW = meanStrokeWidthMm(comp);
    const cellMm = Math.max(
      0.06,
      Math.min(0.4, span / 60, strokeW > 0 ? strokeW / 14 : Infinity),
    );
    try {
      for (const col of medialColumns(comp, { density: 0.4, pullScale: 1, cellMm })) {
        if (col.centerline.length >= 2) out.push(col.centerline);
      }
    } catch {
      // a degenerate component contributes no strokes
    }
  }
  return out;
}

/** Index of the stroke point nearest to `p` within `maxMm`, or null. */
export function nearestStrokePoint(
  strokes: Path[],
  p: Point,
  maxMm: number,
): { stroke: number; point: number } | null {
  let best: { stroke: number; point: number } | null = null;
  let bestD = maxMm * maxMm;
  strokes.forEach((st, si) => {
    st.forEach((q, pi) => {
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { stroke: si, point: pi };
      }
    });
  });
  return best;
}

/** Simplify a hand-drawn stroke: drop points closer than `minMm` together. */
export function tidyStroke(stroke: Path, minMm = 0.3): Path {
  const out: Path = [];
  for (const p of stroke) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minMm) out.push(p);
  }
  return out.length >= 2 ? out : stroke;
}

/** True when the object can carry authored strokes (a fill region). */
export function canAuthorStrokes(o: EmbObject): boolean {
  return o.type === "fill" && o.paths.length > 0;
}

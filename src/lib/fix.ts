import type { EmbObject, Project } from "../types/project";
import { polygonArea, polygonPerimeter } from "./trace/classify";

/**
 * "Fix stitches": a smart auto-cleanup pass over a design. It walks an explicit
 * rule tree per object and corrects the settings most likely to cause a bad sew,
 * then groups objects by color to cut thread changes. Pure — returns a new
 * project; the engine's own safeguards (lock stitches, min-stitch filtering,
 * jumps between regions) handle the rest at generation time.
 *
 * Rules:
 *  - running: stitch length clamped to a safe 1–4 mm.
 *  - satin:   density clamped to 0.3–0.5 mm, pull comp 0–0.6 mm, underlay on.
 *  - fill:    density clamped to 0.35–0.5 mm, underlay on, and a SMART stitch
 *             type — text and narrow strokes become satin columns (smooth +
 *             shiny lettering), broad areas stay tatami.
 *  - project: objects grouped by color (stable) so the machine trims less.
 */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Mean width of a shape (2·area / perimeter) — small means a thin stroke. */
function meanWidthMm(object: EmbObject): number {
  const outer = object.paths[0] ?? [];
  if (outer.length < 3) return 0;
  const per = polygonPerimeter(outer);
  return per > 0 ? (2 * polygonArea(outer)) / per : 0;
}

/** Width (mm) below which a fill reads as a stroke and should be satin. */
export const SATIN_WIDTH_THRESHOLD = 3.5;

export function fixObjectStitches(object: EmbObject): EmbObject {
  const params = { ...object.params };

  if (object.type === "running") {
    params.stitchLength = clamp(params.stitchLength ?? 2.5, 1, 4);
  } else if (object.type === "satin") {
    params.density = clamp(params.density ?? 0.4, 0.3, 0.5);
    params.pullComp = clamp(params.pullComp ?? 0.2, 0, 0.6);
    params.underlay = params.underlay ?? true;
  } else {
    // fill
    params.density = clamp(params.density ?? 0.4, 0.35, 0.5);
    params.underlay = params.underlay ?? true;
    // Smart type: lettering and thin strokes → satin; broad areas → tatami.
    const width = meanWidthMm(object);
    params.fillStyle =
      object.text || (width > 0 && width < SATIN_WIDTH_THRESHOLD) ? "satin" : "tatami";
  }

  return { ...object, params };
}

export function fixStitches(project: Project): Project {
  const fixed = project.objects.map(fixObjectStitches);

  // Stable group by color: preserve first-seen color order and the relative
  // order within each color, but bring same-color objects together.
  const colorOrder = new Map<string, number>();
  for (const o of fixed) if (!colorOrder.has(o.colorId)) colorOrder.set(o.colorId, colorOrder.size);
  const grouped = fixed
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const ca = colorOrder.get(a.o.colorId)!;
      const cb = colorOrder.get(b.o.colorId)!;
      return ca !== cb ? ca - cb : a.i - b.i;
    })
    .map((x) => x.o);

  return { ...project, objects: grouped };
}

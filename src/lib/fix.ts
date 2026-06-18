import type { EmbObject, Project } from "../types/project";
import { classifyRegion } from "./engine/classify";
import { recognizeShape } from "./trace/recognize";

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
 *  - project: objects grouped by color (stable) so the machine trims less, and
 *             within a color, fills sew first with satin/running details layered
 *             on top (background → foreground), like a hand-digitized design.
 */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Layer order within a color: broad fills go down first, then satin columns,
 *  then running lines/outlines on top — so details aren't buried by a fill. */
const LAYER_RANK: Record<EmbObject["type"], number> = { fill: 0, satin: 1, running: 2 };

/** Width (mm) below which a fill reads as a stroke and should be satin. */
export const SATIN_WIDTH_THRESHOLD = 3.5;

/** The fill style for a BROAD region (one the classifier called tatami): a
 *  recognized round shape, or a ring band (a fill with a hole), reads best as a
 *  concentric contour; everything else stays a straight tatami. */
function broadFillStyle(rings: EmbObject["paths"]): "tatami" | "contour" {
  const usable = rings.filter((r) => r.length >= 3);
  if (usable.length === 0) return "tatami";
  const rec = recognizeShape(usable[0], 1.0);
  if (rec && (rec.kind === "circle" || rec.kind === "ellipse")) return "contour";
  if (usable.length > 1) return "contour"; // annulus / ring band → echo it
  return "tatami";
}

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
    // SMART STITCH TREATMENT (geometry-driven, like a digitizer's eye):
    //  • thin strokes / rings / text → satin columns (shiny; the engine renders
    //    very-thin columns as running and falls back to tatami where satin won't
    //    cover);
    //  • broad ROUND shapes (a recognized circle/ellipse) and ring bands → CONTOUR
    //    (concentric rows echo the form and catch the light, with none of the
    //    banding straight rows get across a curve);
    //  • broad ANGULAR/irregular areas → tatami at the auto grain angle.
    const kind = classifyRegion(object.paths, { satinMaxWidthMm: SATIN_WIDTH_THRESHOLD });
    params.fillStyle = object.text || kind !== "tatami" ? "satin" : broadFillStyle(object.paths);
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
      if (ca !== cb) return ca - cb; // group by color (fewest thread changes)
      const la = LAYER_RANK[a.o.type];
      const lb = LAYER_RANK[b.o.type];
      if (la !== lb) return la - lb; // fills first, details on top
      return a.i - b.i; // otherwise keep the drawn order (stable)
    })
    .map((x) => x.o);

  return { ...project, objects: grouped };
}

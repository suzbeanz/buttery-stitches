import type { EmbObject, Project } from "../types/project";
import { classifyRegion } from "./engine/classify";
import { recognizeShape } from "./trace/recognize";
import { knockdown } from "./boolean";

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
 *  recognized round shape, or a true ANNULUS (a ring nested around a hole), reads
 *  best as a concentric contour; disjoint pieces and crescents stay tatami. */
function broadFillStyle(rings: EmbObject["paths"]): "tatami" | "contour" {
  const usable = rings.filter((r) => r.length >= 3);
  if (usable.length === 0) return "tatami";
  const rec = recognizeShape(usable[0], 1.0);
  if (rec && (rec.kind === "circle" || rec.kind === "ellipse")) return "contour";
  if (isAnnulus(usable)) return "contour"; // a ring around a hole (frame / band)
  return "tatami";
}

/** Even-odd: is point `p` inside ring `r`? */
function inRing(p: { x: number; y: number }, r: EmbObject["paths"][number]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** True if some ring is NESTED inside another (a hole) — i.e. a real annulus,
 *  not just several disjoint pieces. */
function isAnnulus(rings: EmbObject["paths"]): boolean {
  for (let i = 0; i < rings.length; i++) {
    const c = rings[i][0];
    for (let k = 0; k < rings.length; k++) {
      if (k !== i && inRing(c, rings[k])) return true;
    }
  }
  return false;
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

  return { ...project, objects: knockdownPass(grouped) };
}

/**
 * KNOCKDOWN pass: in sew order, trim each fill where LATER (on-top) fills cover
 * it, leaving a small trap under their edges. Stops two colours stacking into a
 * thread ridge and prevents pull-gaps where they meet. A no-op for the common
 * tiled (abutting, non-overlapping) case, so it never hurts a clean design.
 */
function knockdownPass(objects: EmbObject[], trapMm = 0.35): EmbObject[] {
  // Only BROAD solid fills on top knock down what's beneath — thin lettering and
  // satin details sit on top, and carving their shapes out of a background just
  // adds complex travel for no gain (and no real buildup).
  const causesKnockdown = (h: EmbObject) =>
    h.type === "fill" &&
    !h.params.applique &&
    !h.text &&
    h.params.fillStyle !== "satin" &&
    h.params.fillStyle !== "motif" &&
    h.paths.length > 0;
  return objects.map((o, i) => {
    if (o.type !== "fill" || o.params.applique || o.paths.length === 0) return o;
    const higher = objects.slice(i + 1).filter(causesKnockdown).map((h) => h.paths);
    if (higher.length === 0) return o;
    const trimmed = knockdown(o.paths, higher, trapMm);
    if (trimmed.length === 0) return o;
    // Re-evaluate the broad fill style on the NEW geometry: a circle carved into a
    // crescent should drop from contour to tatami (contour rings travel badly on a
    // lens), while a disc carved into an annulus keeps its clean concentric contour.
    const params =
      o.params.fillStyle === "contour" || o.params.fillStyle === "tatami"
        ? { ...o.params, fillStyle: broadFillStyle(trimmed) }
        : o.params;
    return { ...o, paths: trimmed, params };
  });
}

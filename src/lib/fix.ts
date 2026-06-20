import type { EmbObject, Project } from "../types/project";
import { classifyRegion } from "./engine/classify";
import { recognizeShape } from "./trace/recognize";
import { knockdown } from "./boolean";
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

/** The fill style for a BROAD region (one the classifier called tatami):
 *  • a recognized round shape (circle / ellipse) → CONTOUR (concentric rows echo
 *    the curve and catch the light with none of the banding straight rows show);
 *  • a true RING / BAND — a thin annulus whose wall is narrow relative to its
 *    overall size (a frame, an "O", a washer) → CONTOUR (rows follow the band);
 *  • anything else, including a big blob that merely has a hole punched in it
 *    (a bun with the sausage showing through), → TATAMI. Concentric contour rows
 *    on a big irregular blob read as topographic striping; flat tatami at one
 *    grain reads as a clean solid, the way a pro digitizer fills it. */
function broadFillStyle(rings: EmbObject["paths"]): "tatami" | "contour" {
  const usable = rings.filter((r) => r.length >= 3);
  if (usable.length === 0) return "tatami";
  // Concentric contour only reads well on ONE clean ring/curved band (a badge
  // border, a single 'O'). A multi-region object — a word's worth of letters, a
  // multi-blob mark — echoed per region comes out ringy and boxy (nested rectangles
  // down each stem), so a word of bold type looks far cleaner as a solid tatami
  // fill. Count the disjoint OUTER rings (not nested in another); more than one
  // means a multi-shape object → tatami.
  const outers = usable.filter(
    (r) => !usable.some((o) => o !== r && polygonArea(o) > polygonArea(r) && inRing(centroidOf(r), o)),
  );
  if (outers.length >= 2) return "tatami";
  // Use the LARGEST ring as the outer boundary (traced rings aren't area-sorted).
  const outer = usable.reduce((a, b) => (polygonArea(b) > polygonArea(a) ? b : a));
  // Contour rows only read as smooth concentric rings on a BIG shape. On a small
  // feature (an eye, a nose, a dot) the handful of rings spiral into the centre
  // and look like a scribbled swirl — so anything below this size fills solid.
  const outerDia = 2 * Math.sqrt(polygonArea(outer) / Math.PI); // equivalent diameter
  if (outerDia < CONTOUR_MIN_DIAMETER_MM) return "tatami";
  const rec = recognizeShape(outer, 1.0);
  if (rec && (rec.kind === "circle" || rec.kind === "ellipse")) return "contour";
  if (isThinBand(usable, outer)) return "contour"; // a frame / ring band
  return "tatami";
}

/** Below this equivalent diameter (mm) a round shape fills solid (tatami), not
 *  contour — too few rings to read as concentric instead of a spiral scribble. */
const CONTOUR_MIN_DIAMETER_MM = 14;

/** A region is a thin BAND (→ contour) when it wraps a hole AND its wall is thin
 *  relative to its size: net (wall) area over a holes-aware mean width tells us
 *  the band width, and we call it thin when that width is under ~30% of the
 *  outer's equivalent diameter. A blob with a small hole fails this (wide wall),
 *  so it fills as flat tatami like a hand-digitized solid.
 *
 *  The wall-width test alone is fooled by an ORGANIC outline (a traced photo, fur,
 *  foliage): a wildly jagged boundary has huge perimeter, which deflates the mean
 *  width and masquerades as a thin band — then contour turns it into a topographic
 *  scribble. So a band must also be reasonably SMOOTH (a real frame/ring is); we
 *  gate on the outer's circularity (4π·area / perimeter², 1 for a circle). */
function isThinBand(rings: EmbObject["paths"], outer: EmbObject["paths"][number]): boolean {
  const holes = rings.filter((r) => r !== outer && inRing(centroidOf(r), outer));
  if (holes.length === 0) return false; // no hole → not a band
  const outerArea = polygonArea(outer);
  const outerPer = polygonPerimeter(outer);
  if (outerPer <= 0) return false;
  const circularity = (4 * Math.PI * outerArea) / (outerPer * outerPer);
  if (circularity < 0.4) return false; // jagged/organic outline → not a clean band
  const netArea = outerArea - holes.reduce((s, h) => s + polygonArea(h), 0);
  if (netArea <= 0) return false;
  const totalPer = outerPer + holes.reduce((s, h) => s + polygonPerimeter(h), 0);
  if (totalPer <= 0) return false;
  const bandWidth = (2 * netArea) / totalPer; // holes-aware mean wall width
  const outerDia = 2 * Math.sqrt(outerArea / Math.PI); // equivalent diameter
  return outerDia > 0 && bandWidth / outerDia < 0.3;
}

/** Centroid of a ring (average of its vertices). */
function centroidOf(r: EmbObject["paths"][number]): { x: number; y: number } {
  let x = 0, y = 0;
  for (const p of r) {
    x += p.x;
    y += p.y;
  }
  return { x: x / r.length, y: y / r.length };
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

export function fixObjectStitches(object: EmbObject): EmbObject {
  const params = { ...object.params };

  if (object.type === "running") {
    params.stitchLength = clamp(params.stitchLength ?? 2.5, 1, 4);
  } else if (object.type === "satin") {
    params.density = clamp(params.density ?? 0.4, 0.3, 0.5);
    params.pullComp = clamp(params.pullComp ?? 0.2, 0, 0.6);
    params.underlay = params.underlay ?? true;
  } else {
    // fill — default to a dense 0.35 mm row spacing (was 0.40) so solid areas read
    // rich and opaque like professional output, not airy with fabric showing
    // between rows; the floor drops to 0.30 mm so a user can push to premium-dense.
    params.density = clamp(params.density ?? 0.35, 0.3, 0.5);
    params.underlay = params.underlay ?? true;
    // SMART STITCH TREATMENT (geometry-driven, like a digitizer's eye):
    //  • thin strokes / rings / text → satin columns (shiny; the engine renders
    //    very-thin columns as running and falls back to tatami where satin won't
    //    cover);
    //  • broad ROUND shapes (a recognized circle/ellipse) and ring bands → CONTOUR
    //    (concentric rows echo the form and catch the light, with none of the
    //    banding straight rows get across a curve);
    //  • broad ANGULAR/irregular areas → tatami at the auto grain angle.
    // Preserve a DECORATIVE style the user deliberately chose (gradient, blend,
    // motif) — only auto-decide for the assignable defaults (tatami/satin/contour
    // /unset), so an "auto-fix" never destroys a deliberate effect.
    // Auto-decide the fill style ONLY when it's unset or the plain default. Any
    // style the object already declares — a decorative effect (gradient/blend/
    // motif), or a satin/contour the digitizer (or auto-trace) deliberately chose
    // for line-art — is respected; the engine still falls back safely (satin →
    // tatami) where the geometry won't take it.
    const explicit = !!params.fillStyle && params.fillStyle !== "tatami";
    if (!explicit) {
      const kind = classifyRegion(object.paths, { satinMaxWidthMm: SATIN_WIDTH_THRESHOLD });
      params.fillStyle = object.text || kind !== "tatami" ? "satin" : broadFillStyle(object.paths);
    }
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

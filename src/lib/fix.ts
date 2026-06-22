import type { EmbObject, Project } from "../types/project";
import { classifyRegion, isSmallRoundFill } from "./engine/classify";
import { recognizeShape } from "./trace/recognize";
import { knockdown, seamTrap } from "./boolean";
import { polygonArea, polygonPerimeter } from "./trace/classify";
import { pathsBounds } from "./geometry";

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

/** A small detail needs no underlay — the foundation just adds bulk under a
 *  feature too small to benefit. Suppress it when the shape's smaller bbox
 *  dimension or its bbox area falls below these (pros skip underlay on tiny bits). */
const UNDERLAY_MIN_DIM_MM = 2.5;
const UNDERLAY_MIN_AREA_MM2 = 12;

/** A genuine sub-millimetre speck: a fill tiny in BOTH min-dimension AND area —
 *  trace noise, not a feature. Dropped so it doesn't sew as a lump (the area-only
 *  despeckle in trace can miss a thin sliver). Thresholds are deliberately tight so
 *  a real small mark (e.g. a 3.4 mm-long, 0.5 mm-tall detail) survives. */
const SPECK_MIN_DIM_MM = 0.5;
const SPECK_MIN_AREA_MM2 = 1.2;

/** True when an object is small enough that underlay is just needless bulk. */
function isSmallElement(paths: EmbObject["paths"]): boolean {
  const b = pathsBounds(paths);
  if (!b) return true;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  return Math.min(w, h) < UNDERLAY_MIN_DIM_MM || w * h < UNDERLAY_MIN_AREA_MM2;
}

/** True when a fill is a genuine sub-mm speck that should be dropped. */
function isSpeck(o: EmbObject): boolean {
  if (o.type !== "fill" || o.paths.length === 0) return false;
  const b = pathsBounds(o.paths);
  if (!b) return true;
  const minDim = Math.min(b.maxX - b.minX, b.maxY - b.minY);
  const outer = o.paths.reduce((a, r) => (Math.abs(polygonArea(r)) > Math.abs(polygonArea(a)) ? r : a));
  return minDim < SPECK_MIN_DIM_MM && Math.abs(polygonArea(outer)) < SPECK_MIN_AREA_MM2;
}

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
    // Underlay on by default, but suppressed for a small detail (just bulk there).
    params.underlay = params.underlay ?? !isSmallElement(object.paths);
  } else {
    // fill — density depends on role:
    //  • a broad solid fill defaults to a dense 0.32 mm row spacing so areas read
    //    rich and opaque like professional output, not airy with fabric showing;
    //  • a line-art outline (rendered as a thin satin network) defaults to a lighter
    //    0.40 mm — standard satin spacing that covers a thin band fully without
    //    piling stitches into a heavy ridge (the outline is often the bulk of a
    //    cartoon's stitch count). The floor stays 0.30 mm so a user can push denser.
    params.density = clamp(params.density ?? (params.lineArt ? 0.4 : 0.32), 0.3, 0.5);
    // Underlay on by default, but suppressed for a small detail (just bulk there).
    params.underlay = params.underlay ?? !isSmallElement(object.paths);
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
      // A small round dot (a golf ball, an eye) sews smooth as a satin block, where
      // tatami leaves rough little rows — so prefer satin for it too.
      params.fillStyle =
        object.text || kind !== "tatami" || isSmallRoundFill(object.paths)
          ? "satin"
          : broadFillStyle(object.paths);
    }
  }

  return { ...object, params };
}

/** What a clean-up pass changed — so the UI can tell the user what happened
 *  (the geometry often looks identical in edit view, only stitch-out differs). */
export interface CleanupReport {
  /** fills whose fill style was assigned or changed (e.g. → satin / contour) */
  fillStylesSet: number;
  /** objects whose density was clamped to a safe value */
  densityFixed: number;
  /** objects that had underlay turned on */
  underlayEnabled: number;
  /** the stitch order changed (objects regrouped by color) */
  reordered: boolean;
  /** fills whose edges were trapped against a neighbour */
  seamsTrapped: number;
}

export function fixStitches(project: Project): Project {
  return fixStitchesWithReport(project).project;
}

/** Like `fixStitches`, but also reports what changed (for user feedback). */
export function fixStitchesWithReport(project: Project): { project: Project; report: CleanupReport } {
  const original = project.objects;
  const fixed = original.map(fixObjectStitches);

  let fillStylesSet = 0;
  let densityFixed = 0;
  let underlayEnabled = 0;
  fixed.forEach((f, i) => {
    const o = original[i];
    if ((o.params.fillStyle ?? "") !== (f.params.fillStyle ?? "")) fillStylesSet++;
    if (f.params.density !== undefined && o.params.density !== f.params.density) densityFixed++;
    if (o.params.underlay !== true && f.params.underlay === true) underlayEnabled++;
  });

  // Drop genuine sub-mm specks (trace noise the area-only despeckle can miss) so
  // they don't sew as lumps. Done after the change report so its indices stay aligned.
  const kept = fixed.filter((o) => !isSpeck(o));

  // Stable group by color: preserve first-seen color order and the relative
  // order within each color, but bring same-color objects together.
  const colorOrder = new Map<string, number>();
  for (const o of kept) if (!colorOrder.has(o.colorId)) colorOrder.set(o.colorId, colorOrder.size);
  const grouped = kept
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
  const reordered = grouped.length !== fixed.length || grouped.some((o, i) => o.id !== kept[i].id);

  const trapped = knockdownPass(grouped);
  // knockdownPass returns the SAME object reference when it leaves a fill alone,
  // so a changed reference means its edges were trapped.
  let seamsTrapped = 0;
  trapped.forEach((t, i) => {
    if (t !== grouped[i]) seamsTrapped++;
  });

  return {
    project: { ...project, objects: trapped },
    report: { fillStylesSet, densityFixed, underlayEnabled, reordered, seamsTrapped },
  };
}

/**
 * SEAM pass: in sew order, make each fill share a clean `trapMm` seam with the
 * LATER (on-top) fills around it. Two complementary raster ops do this:
 *  • seamTrap grows the fill a sliver UNDER any higher fill it merely ABUTS (the
 *    common tiled, auto-digitized case) so fabric pull can't open a gap; then
 *  • knockdown trims where higher fills OVERLAP it, clamping every seam to exactly
 *    `trapMm` inside the higher's edge — stopping colours stacking into a ridge.
 * Both are no-ops for an isolated fill, so they never hurt a clean design.
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
    // Grow under abutting neighbours first, then trim overlaps to the trap width.
    const trapped = seamTrap(o.paths, higher, trapMm);
    const trimmed = knockdown(trapped, higher, trapMm);
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

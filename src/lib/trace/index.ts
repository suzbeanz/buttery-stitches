import ImageTracer from "imagetracerjs";
import type { EmbObject, Path, Point, ThreadColor } from "../../types/project";
import { newId } from "../id";
import { makeObjectFromPaths } from "../objects";
import { pathsBounds } from "../geometry";
import { smoothRingKeepingCorners } from "../smooth";
import { douglasPeucker } from "./simplify";
import { polygonArea, polygonPerimeter } from "./classify";
import { recognizeShape } from "./recognize";
import { idealizeDesign } from "./idealize";
import {
  quantizeImage,
  borderBackgroundColor,
  borderIsTransparent,
  borderIsSolidOpaque,
  removeInnerBackdrop,
  dist2 as colorDist2,
  distToSegment2,
  RESCUE_OUTLIER_MIN_DIST2,
  BLEND_SEGMENT_MAX_DIST2,
  type RGB,
} from "./quantize";
import { stackSmallFeatures } from "./stack";
import { nameForRgb } from "./colorname";
import { weldSliverGaps } from "./weld";

import { upscaleFactor, hasAntiAliasing, upscaleBilinear, upscaleNearest } from "./upscale";
import { DETAIL_PRESETS } from "./types";
import type { DigitizeDetail, DigitizeOptions, DigitizeResult } from "./types";

export * from "./simplify";
export * from "./classify";
export * from "./quantize";
export * from "./types";
export * from "./upscale";
export * from "./livepaint";
export * from "./fur";
export type { DigitizeDetail, DigitizeOptions, DigitizeResult };

/** The slice of imagetracerjs's tracedata we consume. */
interface TraceSegment {
  type: "L" | "Q";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3?: number;
  y3?: number;
}
interface TracePath {
  segments: TraceSegment[];
  isholepath: boolean;
  holechildren: number[];
}
interface TracePalette {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface Tracedata {
  layers: TracePath[][];
  palette: TracePalette[];
  width: number;
  height: number;
}

/** Samples along a quadratic from (x1,y1) via control (x2,y2) to (x3,y3). */
const Q_SAMPLES = 6;

/**
 * Vertices of a traced path (px). Each segment contributes its start point;
 * quadratic ("Q") segments also contribute sampled interior points so imported
 * curves (a circle, a logo's rounded edges) come out smooth instead of faceted.
 * Douglas–Peucker later drops any sample that lies on a straight run.
 */
function pathToPolylinePx(path: TracePath): Point[] {
  const pts: Point[] = [];
  for (const s of path.segments) {
    pts.push({ x: s.x1, y: s.y1 });
    if (s.type === "Q" && s.x3 !== undefined && s.y3 !== undefined) {
      for (let i = 1; i < Q_SAMPLES; i++) {
        const t = i / Q_SAMPLES;
        const mt = 1 - t;
        pts.push({
          x: mt * mt * s.x1 + 2 * mt * t * s.x2 + t * t * s.x3,
          y: mt * mt * s.y1 + 2 * mt * t * s.y2 + t * t * s.y3,
        });
      }
    }
  }
  return pts;
}

function toMm(pts: Point[], mmPerPx: number, ox: number, oy: number): Path {
  return pts.map((p) => ({ x: p.x * mmPerPx + ox, y: p.y * mmPerPx + oy }));
}

/** Does a px polyline reach the image border? The actual background does (it runs
 *  to the edges); a foreground island of the same colour (a white ball on a white
 *  page) sits in the interior and does not — so this distinguishes the two. */
function touchesBorder(pts: Point[], w: number, h: number): boolean {
  const m = Math.max(2, Math.min(w, h) * 0.015);
  for (const p of pts) {
    if (p.x <= m || p.y <= m || p.x >= w - m || p.y >= h - m) return true;
  }
  return false;
}

/** Does a thin region RUN ALONG one image edge (most of its points hugging a
 *  single border)? Screenshots and re-saved images carry 1–2px frame lines and
 *  edge shading that trace as a long stroke pinned to the border — an artifact
 *  of the capture, never part of the subject. A real subject element merely
 *  TOUCHING the edge (a pole reaching the top) fails this: only a small
 *  fraction of its points hug any one border. */
function hugsImageEdge(pts: Point[], w: number, h: number): boolean {
  // The ENTIRE region must live inside a narrow band against one edge (its far
  // side included — a 3px frame line's inner side still sits within the band).
  const band = Math.max(4, Math.min(w, h) * 0.03);
  let maxL = 0, maxR = 0, maxT = 0, maxB = 0;
  for (const p of pts) {
    maxL = Math.max(maxL, p.x);
    maxR = Math.max(maxR, w - p.x);
    maxT = Math.max(maxT, p.y);
    maxB = Math.max(maxB, h - p.y);
  }
  return maxL <= band || maxR <= band || maxT <= band || maxB <= band;
}

/** Straightening tolerance (mm) for the ring-cleanup pass. The tracer leaves a small
 *  (~0.2–0.5 mm) smooth bow on edges that are meant to be straight; re-simplifying a
 *  non-primitive ring at this tolerance collapses the bow to a true straight line while
 *  real corners (which deviate far more) survive. Above ~0.6 mm it starts clipping
 *  genuine small features, so keep it modest. */
const STRAIGHTEN_TOL_MM = 0.5;

/** Above this many traced regions the input isn't a clean logo — it's a photo /
 *  noisy scan. The O(n²) polish passes (idealize/stack/underlap) are skipped so
 *  a pathological image returns a bounded result in seconds instead of freezing.
 *  Real designs peak in the low tens of regions; only un-digitisable input
 *  approaches this. */
const PATHOLOGICAL_RING_CAP = 200;

/**
 * Convert imagetracerjs tracedata into stitch objects (Section 5, steps 3–5).
 * Pure — feed it a tracedata object and it returns colors + classified
 * objects, grouped by color to minimize thread changes. The actual tracing
 * (which needs a canvas) lives in `imageDataToObjects`.
 */
export function tracedataToObjects(
  td: Tracedata,
  opts: DigitizeOptions,
): DigitizeResult {
  const {
    mmPerPx,
    offsetX = 0,
    offsetY = 0,
    simplifyTolMm = 0.3,
    minAreaMm2 = 2,
    removeBackground = true,
    shapeSnap = true,
    straightenTolMm = STRAIGHTEN_TOL_MM,
    strokeMaxWidthMm = STROKE_MAX_WIDTH_MM,
  } = opts;

  const simp = (pts: Point[]): Path =>
    douglasPeucker(toMm(pts, mmPerPx, offsetX, offsetY), simplifyTolMm);

  // The artwork can never legitimately exceed its own raster: a snapped
  // primitive (an ellipse fitted to a region touching the image edge) can
  // overshoot the bitmap by a fraction of a millimetre, which then lands
  // stitches outside the hoop the layout was fitted to. Clamp every cleaned
  // ring into the image rectangle — a sub-millimetre flat spot at the edge is
  // invisible; stitches outside the hoop are a machine fault.
  const boundW = offsetX + td.width * mmPerPx;
  const boundH = offsetY + td.height * mmPerPx;
  const clampToImage = (ring: Path): Path =>
    ring.map((p) => ({
      x: Math.min(boundW, Math.max(offsetX, p.x)),
      y: Math.min(boundH, Math.max(offsetY, p.y)),
    }));

  // Identify the background. Prefer the border color (robust: a big subject
  // isn't the background) by matching it to the nearest palette layer; otherwise
  // fall back to the largest-area color.
  // The nearest-palette match must actually be CLOSE: when a stripped card left
  // no card-coloured pixels at all, "nearest to white" is whatever random hue
  // happens to be lightest (a yellow pole), and marking it background deletes a
  // real part of the subject. If nothing in the palette resembles the
  // background colour, there is nothing left to remove.
  const BG_MATCH_MAX_DIST2 = 90 * 90;
  // Looser bound for dropping thin HALO slivers of a near-background shade (an
  // anti-alias blend hugging the subject's outline). Whole regions are never
  // deleted at this distance — only stroke-classified slivers.
  const BG_HALO_MAX_DIST2 = 150 * 150;
  // Halo-ANNULUS gate (see the region loop): a background-coloured ring wrapping
  // most of the canvas with almost no ink is page, not art. "Mostly hollow" —
  // real filled art is far above this; a wrap-around band is far below it.
  const HALO_MAX_INK_FRACTION = 0.35;
  // …and it must span this fraction of the canvas in BOTH dimensions, so a
  // compact ring-shaped charm or letter counter never qualifies.
  const HALO_MIN_CANVAS_SPAN = 0.55;
  let bgIndex = -1;
  if (removeBackground) {
    const bg = opts.backgroundRgb;
    if (bg) {
      let bd = BG_MATCH_MAX_DIST2;
      td.palette.forEach((p, ci) => {
        if (p.a === 0) return;
        const d = (p.r - bg[0]) ** 2 + (p.g - bg[1]) ** 2 + (p.b - bg[2]) ** 2;
        if (d < bd) {
          bd = d;
          bgIndex = ci;
        }
      });
    } else {
      let maxArea = -1;
      td.layers.forEach((layer, ci) => {
        let area = 0;
        for (const path of layer) {
          if (!path.isholepath) area += polygonArea(simp(pathToPolylinePx(path)));
        }
        if (area > maxArea) {
          maxArea = area;
          bgIndex = ci;
        }
      });
    }
  }

  const colors: ThreadColor[] = [];
  const built: { object: EmbObject; area: number; stroke: boolean }[] = [];

  // Human hue names for the palette ("Red", "Light Blue", "Black") so the
  // dialog's color list reads at a glance; duplicates get a counter. The
  // transparent slot is skipped so it can't claim a name a real color needs.
  const paletteNames: string[] = [];
  {
    const used = new Map<string, number>();
    for (const p of td.palette) {
      if (!p || p.a === 0) {
        paletteNames.push("");
        continue;
      }
      const base = nameForRgb([p.r, p.g, p.b]);
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      paletteNames.push(n === 1 ? base : `${base} ${n}`);
    }
  }

  td.layers.forEach((layer, ci) => {
    // The background COLOUR is kept as a layer (don't skip it wholesale) so that a
    // foreground object the SAME colour as the background — a white ball on a white
    // page — survives; only the actual background region (the one touching the
    // image border) is dropped below, per region.
    // Background-ness is judged by colour DISTANCE, not palette index alone:
    // k-means routinely splits the background's anti-alias halo into extra
    // shades, and if only the nearest one is treated as background the others
    // survive as a pale fringe sewn around the subject. Two tolerances: strict
    // for deleting whole border-touching REGIONS (high stakes), loose for the
    // thin STROKE slivers — a halo shade is a blend of background and subject
    // (a grey-green ring between a white page and a green mound), so it sits
    // farther from the background than any real region should, while genuine
    // outline linework is high-contrast and stays far outside even the loose
    // bound.
    const pal = td.palette[ci];
    if (!pal || pal.a === 0) return;
    const bg = opts.backgroundRgb;
    const bgDist2 = bg
      ? (pal.r - bg[0]) ** 2 + (pal.g - bg[1]) ** 2 + (pal.b - bg[2]) ** 2
      : Infinity;
    const isBackground = ci === bgIndex || (bgIndex >= 0 && bgDist2 <= BG_MATCH_MAX_DIST2);
    const isNearBackground = isBackground || (bgIndex >= 0 && bgDist2 <= BG_HALO_MAX_DIST2);

    const colorId = newId("color");
    const color: ThreadColor = {
      id: colorId,
      rgb: [pal.r, pal.g, pal.b],
      name: paletteNames[ci] || `Color ${ci + 1}`,
    };

    // Separate each colour's regions into SOLID blobs and thin LINE-ART. Bold
    // outlines and fur/detail strokes trace as long, thin regions; filling them
    // shatters them into slivers (and carves holes into the colour beneath). So
    // thin regions are pulled into their own object that the engine renders as a
    // running/satin line laid OVER the fills — the way a hand digitizer outlines
    // a shape — while broad regions stay solid fills. Tiny specks (area) and short
    // thin fringe (length) are despeckled. The nonzero fill engine handles each
    // object's disjoint blobs + holes together.
    // Ring cleanup: snap a true primitive (circle/ellipse/rectangle/polygon) if one
    // fits, else STRAIGHTEN — re-simplify at ~0.5 mm so the trace's small smooth bow
    // on a "straight" edge collapses to a true straight line (real corners deviate far
    // more and survive DP), then corner-aware smooth so genuine curves stay smooth.
    // This is what kills the "shakily drawn" look regardless of the detail preset.
    const straighten = (r: Path) => smoothRingKeepingCorners(douglasPeucker(r, straightenTolMm), 0.6);
    const clean = (r: Path) =>
      shapeSnap ? (recognizeShape(r, 1.0)?.ring ?? straighten(r)) : straighten(r);
    const fillRings: Path[] = [];
    const strokeRings: Path[] = [];
    // Suspected page-background rings (the halo gate below) go into their OWN
    // object so the flag never taints real art of the same colour (the white
    // lettering that shares the white ring's layer).
    const haloRings: Path[] = [];
    let fillArea = 0;
    let strokeArea = 0;
    let haloArea = 0;

    layer.forEach((path) => {
      if (path.isholepath) return; // pulled in via a parent's holechildren
      const pxOuter = pathToPolylinePx(path);
      // Drop the real background (border-touching) but keep same-colour islands.
      if (isBackground && touchesBorder(pxOuter, td.width, td.height)) return;
      const rawOuter = simp(pxOuter);
      const area = polygonArea(rawOuter);
      if (area < minAreaMm2) return; // despeckle
      const perim = polygonPerimeter(rawOuter);
      const meanWidth = perim > 0 ? (2 * area) / perim : 0; // ≈ stroke width for a thin shape
      const length = perim / 2;
      const elongation = meanWidth > 0 ? length / meanWidth : 0;
      // Holes (computed up front so they can inform classification). Tiny holes are
      // trace noise, not real openings, so they're dropped here too.
      const rawHoles = (path.holechildren ?? [])
        .map((idx) => layer[idx])
        .filter(Boolean)
        .map((h) => simp(pathToPolylinePx(h)))
        .filter((h) => polygonArea(h) >= minAreaMm2);
      // Hole-aware line-art NETWORK test. `meanWidth` above looks only at the OUTER
      // boundary, so a CONNECTED outline whose silhouette is the whole subject (a
      // truck's black linework, a picture frame, a thin ring) reads as one big solid
      // blob and gets tatami-filled — heavy and wrong. Subtract the holes to recover
      // the TRUE wall width and how sparsely ink fills its silhouette: a thin-walled,
      // mostly-hollow region is line art to stitch down its centerline, not fill.
      const holeArea = rawHoles.reduce((s, h) => s + polygonArea(h), 0);
      const holePerim = rawHoles.reduce((s, h) => s + polygonPerimeter(h), 0);
      const inkArea = Math.max(0, area - holeArea);
      const wallWidth = perim + holePerim > 0 ? (2 * inkArea) / (perim + holePerim) : 0;
      const inkFraction = area > 0 ? inkArea / area : 1;
      // HALO ANNULUS: a background-coloured RING that wraps (nearly) the whole
      // canvas with almost no ink is usually the PAGE showing through between
      // the subject and the removed background — an anti-alias halo at object
      // scale that once sewed ~2000 useless stitches padding under a design's
      // border. But a DELIBERATE rim (a crest's white ring) is geometrically
      // indistinguishable — a real user's design has exactly this signature —
      // so the tracer must never silently decide. The region is SEGREGATED into
      // its own flagged object (see haloRings) that the digitize dialog offers
      // as an explicit keep/skip, default skipped-but-visible: the common case
      // stays junk-free, and a wanted rim is one tap away instead of silently
      // destroyed. The gate stays narrow — strict colour match to the DETECTED
      // background, annulus topology, mostly hollow, spanning most of the
      // canvas in BOTH dimensions — so lettering, a white ball on a white page,
      // and small ring charms never even get flagged.
      if (isBackground && rawHoles.length > 0 && inkFraction < HALO_MAX_INK_FRACTION) {
        const ob = pathsBounds([rawOuter]);
        if (
          ob &&
          ob.maxX - ob.minX >= HALO_MIN_CANVAS_SPAN * (boundW - offsetX) &&
          ob.maxY - ob.minY >= HALO_MIN_CANVAS_SPAN * (boundH - offsetY)
        ) {
          haloRings.push(...[rawOuter, ...rawHoles].map(clean).map(clampToImage));
          haloArea += area;
          return;
        }
      }
      const isNetwork = wallWidth > 0 && wallWidth < NETWORK_MAX_WALL_MM && inkFraction < NETWORK_MAX_INK_FRACTION;
      // Line-art stroke = a thin holey NETWORK, OR thin AND long AND genuinely
      // ELONGATED (length ≫ width). The elongation test separates a true single
      // stroke (an outline, a fur line) from a jagged shading blob that merely has a
      // low mean width — the blob stays a solid fill instead of fragmenting into a
      // mess of medial stubs.
      let isStroke =
        isNetwork ||
        (meanWidth < strokeMaxWidthMm && length >= STROKE_MIN_LENGTH_MM && elongation >= STROKE_MIN_ELONGATION);
      // A LETTERFORM-scale shape — thin like a stroke but short and compact (the
      // glyphs of small crest text) — sews far better through the FILL path: the
      // engine's auto-satin there is the same machinery the fonts use (junction
      // residual patching, no cartoon-scale regularization), which is why big
      // fill-classified letters read crisp while line-art-classified small ones
      // wobbled. Cartoon linework is long or a holey network, so this never
      // reclassifies it.
      if (isStroke && !isNetwork && length < LETTER_MAX_LENGTH_MM) isStroke = false;
      // An INTERIOR island of the background color at ANTI-ALIAS scale is edge
      // fringe (a blend remnant hugging a boundary) — never artwork. But only at
      // that scale: white LETTERING on a white-page source is thin, stroke-shaped
      // and background-colored too, and a crest's "ST LOUIS" must sew, not vanish
      // because the page happened to match. Real AA fringe is sub-thread width
      // (and the raster-level blend dissolution catches most of it upstream);
      // anything wider that matches the background is deliberate light-colored
      // detail — a hand digitizer sews it (the garment isn't always white).
      if (isNearBackground && isStroke && meanWidth < BG_SLIVER_MAX_WIDTH_MM) return;
      // A thin stroke pinned along one image border is a capture artifact (a
      // screenshot frame line, resize edge shading) — never subject linework.
      if (isStroke && hugsImageEdge(pxOuter, td.width, td.height)) return;
      // WELD SLIVER GAPS (fills only): a hole tracking the outer at sub-thread
      // distance leaves an unsewable "crescent" of ink that ridges under later
      // colours. Snap those stretches onto the outer and rebuild the region so
      // the crescent never exists; the straighten in clean() then smooths the
      // rebuild. Returns null when nothing needed welding (the common case).
      const welded = !isStroke && rawHoles.length > 0
        ? weldSliverGaps(rawOuter, rawHoles, { minAreaMm2 })
        : null;
      const rings = (welded ?? [rawOuter, ...rawHoles]).map(clean).map(clampToImage);
      if (isStroke) {
        strokeRings.push(...rings);
        strokeArea += area;
      } else {
        fillRings.push(...rings);
        fillArea += area;
      }
    });

    let used = false;
    // Name traced objects by their colour ("Red fill", "Black outline") so the
    // region-review walkthrough reads legibly instead of "Fill 1, Fill 2, …".
    // (The SVG import already names by colour; this brings the raster path level.)
    const colorName = color.name || `Color ${ci + 1}`;
    if (fillRings.length > 0) {
      built.push({ object: makeObjectFromPaths("fill", fillRings, colorId, `${colorName} fill`), area: fillArea, stroke: false });
      used = true;
    }
    if (strokeRings.length > 0) {
      // These regions are thin by construction → declare satin so the engine medial-
      // axes each into a column and renders the very-thin ones as running lines (it
      // falls back to tatami per-region where satin can't cover). Declared here, not
      // left to re-classification, because a scattered BAG of strokes can fool the
      // whole-object width heuristic.
      // Underlay stays ON: the references run a stabilising pass beneath every
      // satin stroke (the engine skips it for hairline bean columns itself), and
      // without it wide strokes — a tire wall — sink into the fabric.
      const strokeObj = makeObjectFromPaths("fill", strokeRings, colorId, `${colorName} outline`);
      strokeObj.params = { fillStyle: "satin", lineArt: true };
      built.push({ object: strokeObj, area: strokeArea, stroke: true });
      used = true;
    }
    if (haloRings.length > 0) {
      // Its OWN object, distinctively named + flagged: the dialog shows it as a
      // keep/skip decision (default skip) and Check design warns if it ever
      // reaches a project undecided. Kept separate so same-coloured real art
      // (the lettering) stays unflagged and independently sewable.
      const haloObj = makeObjectFromPaths("fill", haloRings, colorId, `${colorName} ring (background?)`);
      haloObj.suspectedBackground = true;
      built.push({ object: haloObj, area: haloArea, stroke: false });
      used = true;
    }
    if (used) colors.push(color);
  });

  // Sew solid fills first (largest → smallest), then all line-art strokes, so the
  // outlines and detail land crisply ON TOP of the fills instead of being buried.
  built.sort((a, b) => Number(a.stroke) - Number(b.stroke) || b.area - a.area);
  const objects = built.map((b) => b.object);

  // PATHOLOGICAL-INPUT GUARD. The polish passes below (idealize, stack, underlap)
  // are O(n²) in region count. A clean logo has tens of regions (the truck: 61,
  // a crest: 35); a PHOTO or noisy scan shatters into hundreds–thousands, where
  // those passes take minutes and freeze the tab — and add nothing, since you
  // can't idealize noise or gap-proof a thousand specks. Above this cap we skip
  // them and return the basic (already sewable) trace. Real designs never
  // approach it; only un-digitisable input does.
  const totalRings = objects.reduce((s, o) => s + o.paths.length, 0);
  if (totalRings > PATHOLOGICAL_RING_CAP) return { colors, objects };

  const ordered = opts.idealize === false ? objects : idealizeDesign(objects);
  // Gap-proof the color boundaries LAST — after idealization, or a re-snapped
  // primitive would undo the expansion. Stacking runs first (a filled hole
  // needs no underlap), then the remaining boundaries get the underlap.
  if (opts.underlap === false) return { colors, objects: ordered };
  return { colors, objects: stackSmallFeatures(ordered) };
}

/** A traced region thinner than this (mean width, mm) is line-art (a stroke), not
 *  a fill — rendered as a running/satin line over the fills rather than filled. */
const STROKE_MAX_WIDTH_MM = 2.2;
/** Thin regions shorter than this (mm) are anti-aliasing fringe, not strokes. */
const STROKE_MIN_LENGTH_MM = 5;
/** A stroke must be this many times longer than it is wide — a true line, not a
 *  jagged shading blob that merely has a low mean width. */
const STROKE_MIN_ELONGATION = 3.5;
/** A near-background stroke is dropped as anti-alias fringe only below this
 *  mean width (mm) — the blend-remnant scale. Wider background-coloured
 *  strokes are deliberate light detail (white lettering on a white-page
 *  source) and must sew. */
const BG_SLIVER_MAX_WIDTH_MM = 0.55;
/** A thin shape shorter than this (mm) is letterform-scale: it takes the fill
 *  path (font-quality auto-satin) instead of the cartoon line-art path. */
const LETTER_MAX_LENGTH_MM = 12;

/** A holey, thin-walled region — a picture frame, a ring, or a logo's whole
 *  connected outline network — is line art: stitched down its medial centerline,
 *  not tatami-filled. Caught when the TRUE wall width (holes subtracted) is thin
 *  AND ink fills less than half its silhouette. The width cap sits a little above
 *  STROKE_MAX_WIDTH_MM because the medial engine satin-fills the wider stretches
 *  and only runs the genuinely thin ones, so a mixed-width network is safe here. */
const NETWORK_MAX_WALL_MM = 3.0;
const NETWORK_MAX_INK_FRACTION = 0.5;

/**
 * imagetracerjs trace options. Because we hand it a pre-quantized FLAT image
 * (see imageDataToObjects), there is no anti-aliasing to fight: a higher pathomit
 * drops tiny stray paths and a touch of blur softens the pixel staircase before
 * tracing, so each color comes out as a clean solid region.
 */
const TRACE_OPTIONS = {
  pathomit: 8,
  ltres: 1,
  qtres: 1,
  rightangleenhance: true,
  colorquantcycles: 1,
  blurradius: 1,
  blurdelta: 20,
};


/**
 * Full auto-digitize: a raster segmentation pre-pass (median-cut quantization
 * flattens the photo/logo to N solid colors) followed by tracing each color into
 * a solid fill. Flattening first is what makes the result look like real
 * embroidery instead of a fringe of sliver outlines. `numberOfColors` is
 * user-adjustable (2–12).
 */
export function imageDataToObjects(
  imageData: ImageData,
  numberOfColors: number,
  opts: DigitizeOptions,
): DigitizeResult {
  // A SMALL source (a 128px icon) traced at hoop size magnifies every pixel
  // stair-step into a visible wobble — half a millimetre per pixel turns clean
  // logo curves into lumpy blobs. Upscale with smooth interpolation first so
  // edge positions are sub-pixel accurate before quantization; every later
  // stage (simplify, straighten, min-area) works in mm and is scale-free.
  const factor = upscaleFactor(imageData.width, imageData.height);
  if (factor > 1) {
    imageData = (hasAntiAliasing(imageData)
      ? upscaleBilinear(imageData, factor)
      : upscaleNearest(imageData, factor)) as ImageData;
    opts = { ...opts, mmPerPx: opts.mmPerPx / factor };
  }
  // A solid OPAQUE background (a logo on white) would otherwise eat one of the
  // user's colour slots — quantizing 4 brand colours + white to 4 merges two brands
  // into mud. Give the background its own slot (N+1) so all N requested colours stay
  // distinct; the background colour is then removed below, leaving N foreground ones.
  const transparentBg = borderIsTransparent(imageData);
  // Clipart is often a subject on a solid CARD that itself floats on transparent
  // margins. The border is transparent, so the opaque-background path never runs —
  // strip the card at the raster level instead, or "Remove background" silently
  // keeps a giant card-coloured fill AND the card eats a palette slot.
  let source = imageData;
  let cardRgb: [number, number, number] | undefined;
  if (transparentBg && opts.removeBackground !== false) {
    const stripped = removeInnerBackdrop(imageData);
    if (stripped) {
      source = stripped.image as ImageData;
      cardRgb = [
        Math.round(stripped.card[0]),
        Math.round(stripped.card[1]),
        Math.round(stripped.card[2]),
      ];
    }
  }
  // Dominance is lenient (0.35): the background only needs to be the border's main
  // colour, not almost all of it — a subject that reaches the image edge (a mound
  // that runs off the left border) must not cancel the background's slot.
  const opaqueBg = !transparentBg && opts.removeBackground !== false && borderIsSolidOpaque(source, 0.35);
  // …but DROPPING that colour is destructive, so it needs a much stronger signal.
  // A dark-dominant image (a checkerboard, a dark picture-frame, a full-bleed
  // barcode) has a border split ~50/50, so the plurality "background" is really
  // the SUBJECT — removing it silently deletes half the design. Only auto-remove
  // when one colour genuinely OWNS the border (a real logo-on-white is 0.9+); at
  // 0.7 a checkerboard/barcode border no longer qualifies and its ink is kept. An
  // explicit opts.removeBackground (true/false) always wins over this heuristic.
  const bgConfident = !transparentBg && borderIsSolidOpaque(source, 0.7);
  // Blend-band thickness scales with the upscale factor (bilinear turns a 1px
  // AA ribbon into a factor-px one).
  const flat = quantizeImage(source, opaqueBg ? numberOfColors + 1 : numberOfColors, {
    blendSliverMaxPx: 2 + 2 * factor,
  });
  // The background colour: caller-supplied, else a stripped card's colour, else
  // detected from the (now palette-flat) border. The card takes precedence over
  // border detection — after stripping, the border is mostly transparent and its
  // few remaining opaque pixels are the SUBJECT touching the edge (a pole tip),
  // which must not be declared the background.
  const backgroundRgb = opts.backgroundRgb ?? cardRgb ?? borderBackgroundColor(flat) ?? undefined;
  // Hand ImageTracer OUR palette so it traces against our (saliency-aware k-means)
  // colors instead of re-quantizing the image with its own population-based pass —
  // which would drop small high-contrast features (a pet's eyes, nose, mouth) that
  // matter far more than their pixel count. colorsampling: 0 forces it to use the
  // fixed palette verbatim.
  const pal = flat.palette.map(([r, g, b]) => ({ r, g, b, a: 255 }));
  // A transparent background (the common transparent-PNG logo) has no palette slot,
  // so ImageTracer would snap every see-through pixel to the nearest brand colour
  // and trace a phantom full-canvas fill (e.g. black → green). Give it a transparent
  // layer to absorb those pixels — tracedataToObjects drops a:0 layers — and skip the
  // opaque background hunt, which would otherwise mis-drop the largest real colour.
  if (transparentBg) pal.push({ r: 0, g: 0, b: 0, a: 0 });
  // Detail level steers trace smoothing/omission AND the downstream
  // simplify/despeckle defaults together. Explicit opts still override the preset.
  const preset = DETAIL_PRESETS[opts.detail ?? "balanced"];
  const td = ImageTracer.imagedataToTracedata(
    { width: flat.width, height: flat.height, data: flat.data } as ImageData,
    {
      ...TRACE_OPTIONS,
      // pathomit is in PIXELS of path length — scale it with the upscale factor
      // so despeckling strength is resolution-independent (a "small stray piece"
      // is the same physical size whether the source arrived at 128px or 512px).
      pathomit: preset.pathomit * factor,
      blurradius: preset.blurradius,
      ltres: preset.ltres,
      qtres: preset.qtres,
      pal,
      colorsampling: 0,
      numberofcolors: pal.length,
    },
  ) as Tracedata;
  return tracedataToObjects(td, {
    simplifyTolMm: preset.simplifyTolMm,
    minAreaMm2: preset.minAreaMm2,
    ...opts,
    backgroundRgb,
    // A stripped card's colour still counts as the background downstream, so the
    // sliver-drop erases the anti-alias halo the card left around the subject
    // (interior blobs of that colour — the white ball — survive, as always).
    // Opaque path: auto-remove only when the border is strongly dominated
    // (bgConfident); an explicit caller value still overrides.
    removeBackground: transparentBg ? cardRgb !== undefined : (opts.removeBackground ?? bgConfident),
  });
}

/**
 * Cheap "is this a photo?" estimate: sample pixels and count distinct colors
 * quantized to 4 bits per channel. High counts mean a photographic image that
 * will digitize roughly (v1 is for logos / line art).
 */
export function estimateColorComplexity(imageData: ImageData): number {
  const { data } = imageData;
  const seen = new Set<number>();
  const step = Math.max(4, Math.floor(data.length / 4 / 2000)) * 4;
  for (let i = 0; i + 3 < data.length; i += step) {
    if (data[i + 3] < 8) continue; // skip transparent
    const key =
      ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    seen.add(key);
  }
  return seen.size;
}

/**
 * Suggest a sensible starting thread-color count for an image, graded between
 * `min` and `max`. A card behind transparent margins is stripped first, so the
 * backdrop neither counts as a colour nor swamps the shares (a white card is
 * most of the pixels, and every real colour's share shrinks under it). Sampled
 * pixels are bucketed coarsely (3 bits/channel, so anti-alias fringe lands in
 * its parents' buckets) and a bucket counts as a thread-worthy colour when it
 * covers ≥1.5% of the subject. Counting DISTINCT meaningful colours — not area
 * coverage — is what keeps a small feature (a gold pole, a dark hole) counted
 * even when one big colour dominates the pixels. Below the 1.5% bar, a RARE
 * bucket still counts when it is perceptually far from every major colour AND
 * off the blend segment between every major pair — a pet's dark eye is a real
 * thread at 0.3% of the pixels, while the anti-alias mid-grey between black and
 * white (equally far from both) is not.
 */
/** A sub-1.5% bucket can still count as a thread only above this share —
 *  below it single noise pixels would masquerade as details. */
const SUGGEST_DETAIL_MIN_SHARE = 0.002;
/** …and only with several corroborating samples: one or two stray pixels can
 *  land anywhere (and a lone sample has zero scatter by definition), while a
 *  real feature turns up repeatedly under the strided scan. */
const SUGGEST_DETAIL_MIN_SAMPLES = 3;
/** …and only when its samples are TIGHT: summed per-channel variance of a
 *  genuine flat detail (a pet's eye) is ≈0, while noise or anti-alias samples
 *  that happen to share a coarse bucket scatter across its 32-unit span
 *  (uniform spread ≈ 32²/12 ≈ 85 per channel, ≈250 summed). */
const SUGGEST_DETAIL_MAX_SCATTER = 150;

export function suggestColorCount(imageData: ImageData, min = 2, max = 12): number {
  let img: { data: Uint8ClampedArray | number[] } = imageData;
  if (borderIsTransparent(imageData)) {
    const stripped = removeInnerBackdrop(imageData);
    if (stripped) img = stripped.image;
  }
  const data = img.data as Uint8ClampedArray;
  const counts = new Map<number, number>();
  // Per-bucket channel sums and squared sums: means for the distance tests,
  // variance for the tightness test.
  const sums = new Map<number, [number, number, number, number, number, number]>();
  const step = Math.max(4, Math.floor(data.length / 4 / 4000)) * 4;
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += step) {
    if (data[i + 3] < 8) continue; // skip transparent
    const key = ((data[i] >> 5) << 10) | ((data[i + 1] >> 5) << 5) | (data[i + 2] >> 5);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const s = sums.get(key) ?? [0, 0, 0, 0, 0, 0];
    for (let c = 0; c < 3; c++) {
      s[c] += data[i + c];
      s[c + 3] += data[i + c] * data[i + c];
    }
    sums.set(key, s);
    total++;
  }
  if (total === 0) return min;
  const meanOf = (key: number): RGB => {
    const s = sums.get(key)!;
    const f = counts.get(key)!;
    return [Math.round(s[0] / f), Math.round(s[1] / f), Math.round(s[2] / f)];
  };
  const majors: RGB[] = [];
  let n = 0;
  for (const [key, f] of counts) {
    if (f / total >= 0.015) {
      n++;
      majors.push(meanOf(key));
    }
  }
  // Rare-but-distinct details. Known limit: below SUGGEST_DETAIL_MIN_SHARE the
  // deterministic-but-noisy single-sample buckets would count, so a truly tiny
  // feature relies on the quantizer's rescue pass (which sees every pixel), not
  // on this suggestion.
  for (const [key, f] of counts) {
    const share = f / total;
    if (share >= 0.015 || share < SUGGEST_DETAIL_MIN_SHARE) continue;
    if (f < SUGGEST_DETAIL_MIN_SAMPLES) continue;
    const s = sums.get(key)!;
    const scatter =
      (s[3] + s[4] + s[5]) / f -
      ((s[0] / f) ** 2 + (s[1] / f) ** 2 + (s[2] / f) ** 2);
    if (scatter > SUGGEST_DETAIL_MAX_SCATTER) continue; // noise/AA sharing a bucket
    const mean = meanOf(key);
    const farFromAll = majors.every(
      (m) => colorDist2(m, mean[0], mean[1], mean[2]) > RESCUE_OUTLIER_MIN_DIST2,
    );
    if (!farFromAll) continue;
    // Anti-alias mid-tones are far from BOTH parents yet sit on the straight
    // line between them — the same segment test the blend-sliver dissolver uses.
    let onBlendSegment = false;
    for (let a = 0; a < majors.length && !onBlendSegment; a++)
      for (let b = a + 1; b < majors.length; b++)
        if (distToSegment2(mean, majors[a], majors[b]) <= BLEND_SEGMENT_MAX_DIST2) {
          onBlendSegment = true;
          break;
        }
    if (!onBlendSegment) n++;
  }
  return Math.max(min, Math.min(max, n));
}

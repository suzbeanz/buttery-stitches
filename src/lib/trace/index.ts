import ImageTracer from "imagetracerjs";
import type { EmbObject, Path, Point, ThreadColor } from "../../types/project";
import { newId } from "../id";
import { makeObjectFromPaths } from "../objects";
import { smoothRingKeepingCorners } from "../smooth";
import { douglasPeucker } from "./simplify";
import { polygonArea, polygonPerimeter } from "./classify";
import { recognizeShape } from "./recognize";
import { quantizeImage, borderBackgroundColor, borderIsTransparent, borderIsSolidOpaque } from "./quantize";

export * from "./simplify";
export * from "./classify";
export * from "./quantize";

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

export interface DigitizeOptions {
  /** millimeters per source pixel (sets the physical size) */
  mmPerPx: number;
  /** translate the whole design (mm), e.g. to center it in the hoop */
  offsetX?: number;
  offsetY?: number;
  /** Douglas–Peucker tolerance (default 0.3 mm) */
  simplifyTolMm?: number;
  /** drop shapes smaller than this (default 1 mm²) */
  minAreaMm2?: number;
  /** shapes thinner than this become running stitches (default 1.2 mm) */
  runningMaxWidth?: number;
  /** skip the background color (usually the fabric) */
  removeBackground?: boolean;
  /** the detected background RGB (from the image border); falls back to area. */
  backgroundRgb?: [number, number, number];
  /** how much fine detail to keep vs how bold/clean to simplify (default
   *  "balanced"). Drives trace smoothing, path simplification, and despeckling
   *  together; explicit simplifyTolMm/minAreaMm2 still override. */
  detail?: DigitizeDetail;
}

/** Detail level for auto-digitize: bolder & cleaner ↔ finer & busier. */
export type DigitizeDetail = "smooth" | "balanced" | "detailed";

export interface DigitizeResult {
  colors: ThreadColor[];
  objects: EmbObject[];
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
  } = opts;

  const simp = (pts: Point[]): Path =>
    douglasPeucker(toMm(pts, mmPerPx, offsetX, offsetY), simplifyTolMm);

  // Identify the background. Prefer the border color (robust: a big subject
  // isn't the background) by matching it to the nearest palette layer; otherwise
  // fall back to the largest-area color.
  let bgIndex = -1;
  if (removeBackground) {
    const bg = opts.backgroundRgb;
    if (bg) {
      let bd = Infinity;
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

  td.layers.forEach((layer, ci) => {
    // The background COLOUR is kept as a layer (don't skip it wholesale) so that a
    // foreground object the SAME colour as the background — a white ball on a white
    // page — survives; only the actual background region (the one touching the
    // image border) is dropped below, per region.
    const isBackground = ci === bgIndex;
    const pal = td.palette[ci];
    if (!pal || pal.a === 0) return;

    const colorId = newId("color");
    const color: ThreadColor = {
      id: colorId,
      rgb: [pal.r, pal.g, pal.b],
      name: `Color ${ci + 1}`,
    };

    // Separate each colour's regions into SOLID blobs and thin LINE-ART. Bold
    // outlines and fur/detail strokes trace as long, thin regions; filling them
    // shatters them into slivers (and carves holes into the colour beneath). So
    // thin regions are pulled into their own object that the engine renders as a
    // running/satin line laid OVER the fills — the way a hand digitizer outlines
    // a shape — while broad regions stay solid fills. Tiny specks (area) and short
    // thin fringe (length) are despeckled. The nonzero fill engine handles each
    // object's disjoint blobs + holes together.
    const clean = (r: Path) => recognizeShape(r, 1.0)?.ring ?? smoothRingKeepingCorners(r, 0.8);
    const fillRings: Path[] = [];
    const strokeRings: Path[] = [];
    let fillArea = 0;
    let strokeArea = 0;

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
      const isNetwork = wallWidth > 0 && wallWidth < NETWORK_MAX_WALL_MM && inkFraction < NETWORK_MAX_INK_FRACTION;
      // Line-art stroke = a thin holey NETWORK, OR thin AND long AND genuinely
      // ELONGATED (length ≫ width). The elongation test separates a true single
      // stroke (an outline, a fur line) from a jagged shading blob that merely has a
      // low mean width — the blob stays a solid fill instead of fragmenting into a
      // mess of medial stubs.
      const isStroke =
        isNetwork ||
        (meanWidth < STROKE_MAX_WIDTH_MM && length >= STROKE_MIN_LENGTH_MM && elongation >= STROKE_MIN_ELONGATION);
      // An INTERIOR island of the background color that is a thin sliver is the
      // background showing THROUGH a gap between two foreground shapes (between sail
      // panels, between letters) — not a feature. Stitching it would lay a line of
      // background-colored thread where there should be bare fabric, so drop it. A
      // genuine same-as-background feature (a white ball on a white page) is blobby,
      // not a sliver, so it fails this test and survives.
      if (isBackground && isStroke) return;
      const rings = [clean(rawOuter), ...rawHoles.map(clean)];
      if (isStroke) {
        strokeRings.push(...rings);
        strokeArea += area;
      } else {
        fillRings.push(...rings);
        fillArea += area;
      }
    });

    let used = false;
    if (fillRings.length > 0) {
      built.push({ object: makeObjectFromPaths("fill", fillRings, colorId), area: fillArea, stroke: false });
      used = true;
    }
    if (strokeRings.length > 0) {
      // These regions are thin by construction → declare satin so the engine medial-
      // axes each into a column and renders the very-thin ones as running lines (it
      // falls back to tatami per-region where satin can't cover). Declared here, not
      // left to re-classification, because a scattered BAG of strokes can fool the
      // whole-object width heuristic.
      const strokeObj = makeObjectFromPaths("fill", strokeRings, colorId);
      strokeObj.params = { fillStyle: "satin", lineArt: true, underlay: false };
      built.push({ object: strokeObj, area: strokeArea, stroke: true });
      used = true;
    }
    if (used) colors.push(color);
  });

  // Sew solid fills first (largest → smallest), then all line-art strokes, so the
  // outlines and detail land crisply ON TOP of the fills instead of being buried.
  built.sort((a, b) => Number(a.stroke) - Number(b.stroke) || b.area - a.area);
  return { colors, objects: built.map((b) => b.object) };
}

/** A traced region thinner than this (mean width, mm) is line-art (a stroke), not
 *  a fill — rendered as a running/satin line over the fills rather than filled. */
const STROKE_MAX_WIDTH_MM = 2.2;
/** Thin regions shorter than this (mm) are anti-aliasing fringe, not strokes. */
const STROKE_MIN_LENGTH_MM = 5;
/** A stroke must be this many times longer than it is wide — a true line, not a
 *  jagged shading blob that merely has a low mean width. */
const STROKE_MIN_ELONGATION = 3.5;

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
 * Per-detail-level knobs. "balanced" matches the long-standing defaults. Higher
 * `pathomit`/`blurradius`/`ltres`/`qtres` and a larger min-area drop tiny pieces
 * and smooth the pixel staircase (bolder, fewer thread stops); lower values keep
 * fine lines and small features (busier, more stitches).
 */
const DETAIL_PRESETS: Record<
  DigitizeDetail,
  { pathomit: number; blurradius: number; ltres: number; qtres: number; simplifyTolMm: number; minAreaMm2: number }
> = {
  smooth: { pathomit: 16, blurradius: 3, ltres: 1.5, qtres: 1.5, simplifyTolMm: 0.5, minAreaMm2: 3 },
  balanced: { pathomit: 8, blurradius: 1, ltres: 1, qtres: 1, simplifyTolMm: 0.3, minAreaMm2: 1 },
  detailed: { pathomit: 3, blurradius: 0, ltres: 0.5, qtres: 0.5, simplifyTolMm: 0.15, minAreaMm2: 0.4 },
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
  // A solid OPAQUE background (a logo on white) would otherwise eat one of the
  // user's colour slots — quantizing 4 brand colours + white to 4 merges two brands
  // into mud. Give the background its own slot (N+1) so all N requested colours stay
  // distinct; the background colour is then removed below, leaving N foreground ones.
  const transparentBg = borderIsTransparent(imageData);
  const opaqueBg = !transparentBg && opts.removeBackground !== false && borderIsSolidOpaque(imageData);
  const flat = quantizeImage(imageData, opaqueBg ? numberOfColors + 1 : numberOfColors);
  // Detect the background from the (now palette-flat) border unless the caller
  // already supplied one.
  const backgroundRgb = opts.backgroundRgb ?? borderBackgroundColor(flat) ?? undefined;
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
      pathomit: preset.pathomit,
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
    removeBackground: transparentBg ? false : opts.removeBackground,
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
 * `min` and `max` (not the old binary "logo→4 / photo→8"). We bucket sampled
 * pixels into the same 4-bit-per-channel space, then count how many of the most
 * frequent buckets it takes to cover ~92% of the (opaque) pixels — i.e. the
 * DOMINANT colors, ignoring anti-alias fringe and sparse noise. A flat 3-color
 * logo lands near 3; a busy illustration lands higher; a photo saturates at `max`.
 */
export function suggestColorCount(imageData: ImageData, min = 2, max = 12): number {
  const { data } = imageData;
  const counts = new Map<number, number>();
  const step = Math.max(4, Math.floor(data.length / 4 / 4000)) * 4;
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += step) {
    if (data[i + 3] < 8) continue; // skip transparent
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }
  if (total === 0) return min;
  const freqs = [...counts.values()].sort((a, b) => b - a);
  const target = total * 0.92;
  let acc = 0;
  let n = 0;
  for (const f of freqs) {
    acc += f;
    n++;
    if (acc >= target) break;
  }
  return Math.max(min, Math.min(max, n));
}

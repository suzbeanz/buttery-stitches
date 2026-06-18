import ImageTracer from "imagetracerjs";
import type { EmbObject, Path, Point, ThreadColor } from "../../types/project";
import { newId } from "../id";
import { makeObjectFromPaths } from "../objects";
import { smoothRingKeepingCorners } from "../smooth";
import { douglasPeucker } from "./simplify";
import { polygonArea } from "./classify";
import { recognizeShape } from "./recognize";
import { quantizeImage, borderBackgroundColor } from "./quantize";

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
}

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
  const built: { object: EmbObject; area: number }[] = [];

  td.layers.forEach((layer, ci) => {
    if (ci === bgIndex) return;
    const pal = td.palette[ci];
    if (!pal || pal.a === 0) return;

    const colorId = newId("color");
    const color: ThreadColor = {
      id: colorId,
      rgb: [pal.r, pal.g, pal.b],
      name: `Color ${ci + 1}`,
    };

    // Build ONE solid fill object per color from all its regions (the nonzero
    // fill engine handles disjoint blobs + their holes in a single object). We
    // deliberately produce SOLID fills rather than per-region running outlines:
    // that's what makes an auto-digitized logo look like real embroidery and
    // keeps it to a clean object-per-color instead of dozens of slivers. Tiny
    // specks are despeckled by area. The user can convert any region to satin in
    // the editor for crisp strokes.
    const fillRings: Path[] = [];
    let outerArea = 0;

    layer.forEach((path) => {
      if (path.isholepath) return; // pulled in via a parent's holechildren
      const rawOuter = simp(pathToPolylinePx(path));
      const area = polygonArea(rawOuter);
      if (area < minAreaMm2) return; // despeckle
      outerArea += area;
      const rawHoles = (path.holechildren ?? [])
        .map((idx) => layer[idx])
        .filter(Boolean)
        .map((h) => simp(pathToPolylinePx(h)))
        .filter((h) => polygonArea(h) >= minAreaMm2);
      // SMART SHAPES: if a traced region is really a circle / ellipse / rectangle /
      // regular polygon, snap it to the exact primitive (it then stitches as a true
      // shape with a clean axis). Otherwise smooth the curved runs while KEEPING
      // sharp corners crisp, so a logo's angles and a star's points stay sharp
      // instead of melting into the tracer's rounded blocks.
      const clean = (r: Path) => recognizeShape(r, 1.0)?.ring ?? smoothRingKeepingCorners(r, 0.8);
      fillRings.push(clean(rawOuter), ...rawHoles.map(clean));
    });

    if (fillRings.length > 0) {
      built.push({ object: makeObjectFromPaths("fill", fillRings, colorId), area: outerArea });
      colors.push(color);
    }
  });

  // Stitch the largest fills first so smaller details land on top, not buried.
  built.sort((a, b) => b.area - a.area);
  return { colors, objects: built.map((b) => b.object) };
}

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
  const flat = quantizeImage(imageData, numberOfColors);
  // Detect the background from the (now palette-flat) border unless the caller
  // already supplied one.
  const backgroundRgb = opts.backgroundRgb ?? borderBackgroundColor(flat) ?? undefined;
  // Hand ImageTracer OUR palette so it traces against our (saliency-aware k-means)
  // colors instead of re-quantizing the image with its own population-based pass —
  // which would drop small high-contrast features (a pet's eyes, nose, mouth) that
  // matter far more than their pixel count. colorsampling: 0 forces it to use the
  // fixed palette verbatim.
  const pal = flat.palette.map(([r, g, b]) => ({ r, g, b, a: 255 }));
  const td = ImageTracer.imagedataToTracedata(
    { width: flat.width, height: flat.height, data: flat.data } as ImageData,
    { ...TRACE_OPTIONS, pal, colorsampling: 0, numberofcolors: pal.length },
  ) as Tracedata;
  return tracedataToObjects(td, { ...opts, backgroundRgb });
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

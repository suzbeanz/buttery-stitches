import ImageTracer from "imagetracerjs";
import type { EmbObject, Path, Point, ThreadColor } from "../../types/project";
import { newId } from "../id";
import { makeObjectFromPaths } from "../objects";
import { douglasPeucker } from "./simplify";
import { polygonArea } from "./classify";

export * from "./simplify";
export * from "./classify";

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
  /** skip the largest-area color (usually the background) */
  removeBackground?: boolean;
}

export interface DigitizeResult {
  colors: ThreadColor[];
  objects: EmbObject[];
}

/** Segment start points form the polygon's vertices (px). */
function pathToPolylinePx(path: TracePath): Point[] {
  return path.segments.map((s) => ({ x: s.x1, y: s.y1 }));
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

  // Identify the background as the color covering the most area.
  let bgIndex = -1;
  if (removeBackground) {
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
      const outer = simp(pathToPolylinePx(path));
      const area = polygonArea(outer);
      if (area < minAreaMm2) return; // despeckle
      outerArea += area;
      const holes = (path.holechildren ?? [])
        .map((idx) => layer[idx])
        .filter(Boolean)
        .map((h) => simp(pathToPolylinePx(h)))
        .filter((h) => polygonArea(h) >= minAreaMm2);
      fillRings.push(outer, ...holes);
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
 * imagetracerjs trace options tuned for clean, solid embroidery (not line art).
 * A light blur merges the anti-aliasing fringe between color regions before
 * tracing, and a higher pathomit drops the tiny stray paths — together these cut
 * an auto-digitized logo from dozens of sliver objects down to a clean handful.
 */
const TRACE_OPTIONS = {
  pathomit: 16,
  ltres: 1,
  qtres: 1,
  rightangleenhance: true,
  colorquantcycles: 3,
  blurradius: 2,
  blurdelta: 20,
};

/**
 * Full auto-digitize: quantize + trace the image (imagetracerjs) and convert to
 * stitch objects. `numberOfColors` is user-adjustable (2–12).
 */
export function imageDataToObjects(
  imageData: ImageData,
  numberOfColors: number,
  opts: DigitizeOptions,
): DigitizeResult {
  const td = ImageTracer.imagedataToTracedata(imageData, {
    ...TRACE_OPTIONS,
    numberofcolors: numberOfColors,
  }) as Tracedata;
  return tracedataToObjects(td, opts);
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

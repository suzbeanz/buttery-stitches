import ImageTracer from "imagetracerjs";
import type { EmbObject, Path, Point, ThreadColor } from "../../types/project";
import { newId } from "../id";
import { makeObjectFromPaths } from "../objects";
import { douglasPeucker } from "./simplify";
import { classifyShape, polygonArea } from "./classify";

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
    minAreaMm2 = 1,
    runningMaxWidth = 1.2,
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
  const objects: EmbObject[] = [];

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

    // Collect every region of this color first, then emit ONE fill object for
    // all the filled blobs (the tatami engine clips with even-odd, so disjoint
    // outers + their holes coexist in a single object). Thin slivers stay as
    // individual running objects. This keeps a logo to a handful of objects
    // instead of one per traced blob.
    const fillRings: Path[] = [];
    const runningObjects: EmbObject[] = [];

    layer.forEach((path) => {
      if (path.isholepath) return; // pulled in via a parent's holechildren
      const outer = simp(pathToPolylinePx(path));
      const cls = classifyShape(outer, { runningMaxWidth, minAreaMm2 });
      if (!cls) return; // despeckled

      if (cls.type === "fill") {
        const holes = (path.holechildren ?? [])
          .map((idx) => layer[idx])
          .filter(Boolean)
          .map((h) => simp(pathToPolylinePx(h)));
        fillRings.push(outer, ...holes);
      } else {
        runningObjects.push(makeObjectFromPaths("running", [outer], colorId));
      }
    });

    if (fillRings.length > 0) {
      objects.push(makeObjectFromPaths("fill", fillRings, colorId));
    }
    objects.push(...runningObjects);

    if (fillRings.length > 0 || runningObjects.length > 0) colors.push(color);
  });

  return { colors, objects };
}

/** imagetracerjs trace options tuned for clean logos / line art. */
const TRACE_OPTIONS = {
  pathomit: 8,
  ltres: 1,
  qtres: 1,
  rightangleenhance: true,
  colorquantcycles: 3,
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

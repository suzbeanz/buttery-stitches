/**
 * VECTOR import — the second half of "make it perfect". A logo is almost always
 * born as an SVG (or PDF/AI, which are vector too). Tracing rasterizes it first,
 * so a 71 mm crest arrives as 474 px and its 5 px text is lost before we start.
 * Importing the VECTORS instead means exact outlines, exact circles, exact curve
 * geometry — no resolution ceiling. This module is the PURE core: given the SVG's
 * shapes already flattened to polygon rings (the browser DOM does that — see
 * svgParse.ts), it maps them into the hoop, quantises their fills to a thread
 * budget, and groups them into stitch objects — the same DigitizeResult the
 * raster tracer returns, so everything downstream (the dialog, fixStitches, the
 * engine, the text-retype assist) works unchanged.
 */
import type { EmbObject, Path, ThreadColor } from "../../types/project";
import { newId } from "../id";
import { makeObjectFromPaths } from "../objects";
import { douglasPeucker } from "./simplify";
import { polygonArea } from "./classify";
import { nameForRgb } from "./colorname";
import type { DigitizeResult } from "./index";

export type RGB = [number, number, number];

/** One filled shape from an SVG: outer rings + hole rings, already in a single
 *  user-unit space (all transforms baked in), with its resolved fill colour. */
export interface SvgShape {
  /** Closed rings in SVG user units. Winding distinguishes holes downstream via
   *  even-odd depth, exactly like the tracer's layers. */
  rings: Path[];
  fill: RGB;
}

export interface SvgImportOptions {
  /** Bounding box of the artwork in user units (the SVG viewBox or content bbox). */
  contentW: number;
  contentH: number;
  /** Target hoop size (mm). The art is scaled to fit with a margin and centred. */
  hoopWmm: number;
  hoopHmm: number;
  /** Fraction of the hoop the art fills (default 0.92, matching the raster path). */
  fit?: number;
  /** Collapse the palette to at most this many threads (0/undefined = keep all
   *  distinct fills). */
  maxColors?: number;
  /** Drop shapes smaller than this (mm², default 1). */
  minAreaMm2?: number;
  /** Simplify flattened rings at this tolerance (mm, default 0.2 — vectors are
   *  already clean, so this only drops collinear run points). */
  simplifyTolMm?: number;
}

/** Perceptual (chroma-weighted) distance², matching the quantizer's metric so a
 *  vector palette reduces the same way a raster one does. */
function dist2(a: RGB, b: RGB): number {
  const y1 = 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2];
  const y2 = 0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2];
  const cb1 = a[2] - y1, cb2 = b[2] - y2;
  const cr1 = a[0] - y1, cr2 = b[0] - y2;
  return (y1 - y2) ** 2 + 5 * ((cb1 - cb2) ** 2 + (cr1 - cr2) ** 2);
}

/** Reduce a set of colours (each with an area weight) to at most `k` by greedily
 *  merging the closest pair, area-weighting the survivor. Returns a map from every
 *  original colour key to its final RGB. */
function reducePalette(colors: { rgb: RGB; area: number }[], k: number): Map<string, RGB> {
  const key = (c: RGB) => c.join(",");
  // Merge exact duplicates first.
  const buckets = new Map<string, { rgb: RGB; area: number }>();
  for (const c of colors) {
    const kk = key(c.rgb);
    const b = buckets.get(kk);
    if (b) b.area += c.area;
    else buckets.set(kk, { rgb: [...c.rgb] as RGB, area: c.area });
  }
  let nodes = [...buckets.values()];
  while (k > 0 && nodes.length > k) {
    // Find the closest pair (perceptual).
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = dist2(nodes[i].rgb, nodes[j].rgb);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    const a = nodes[bi], b = nodes[bj];
    const total = a.area + b.area || 1;
    const merged: RGB = [
      Math.round((a.rgb[0] * a.area + b.rgb[0] * b.area) / total),
      Math.round((a.rgb[1] * a.area + b.rgb[1] * b.area) / total),
      Math.round((a.rgb[2] * a.area + b.rgb[2] * b.area) / total),
    ];
    nodes = nodes.filter((_, i) => i !== bi && i !== bj);
    nodes.push({ rgb: merged, area: total });
  }
  // Map each original colour to its nearest survivor.
  const out = new Map<string, RGB>();
  for (const c of colors) {
    let best = nodes[0]?.rgb ?? c.rgb, bd = Infinity;
    for (const n of nodes) {
      const d = dist2(c.rgb, n.rgb);
      if (d < bd) {
        bd = d;
        best = n.rgb;
      }
    }
    out.set(key(c.rgb), best);
  }
  return out;
}

/**
 * Turn flattened SVG shapes into a DigitizeResult (colors + objects) placed in
 * the hoop. Shapes keep their EXACT vector geometry — only scaled to mm and
 * lightly de-duplicated — so the import has no raster resolution ceiling.
 */
export function svgShapesToObjects(shapes: SvgShape[], opts: SvgImportOptions): DigitizeResult {
  const {
    contentW,
    contentH,
    hoopWmm,
    hoopHmm,
    fit = 0.92,
    maxColors = 0,
    minAreaMm2 = 1,
    simplifyTolMm = 0.2,
  } = opts;
  if (shapes.length === 0 || contentW <= 0 || contentH <= 0) return { colors: [], objects: [] };

  // Scale user units → mm to fit the hoop with a margin, centred.
  const mmPerUnit = Math.min(hoopWmm / contentW, hoopHmm / contentH) * fit;
  const offX = (hoopWmm - contentW * mmPerUnit) / 2;
  const offY = (hoopHmm - contentH * mmPerUnit) / 2;
  const toMm = (ring: Path): Path =>
    ring.map((p) => ({ x: p.x * mmPerUnit + offX, y: p.y * mmPerUnit + offY }));

  // Scale + simplify each shape's rings; keep shapes with real area.
  interface Scaled {
    rings: Path[];
    fill: RGB;
    area: number;
  }
  const scaled: Scaled[] = [];
  for (const s of shapes) {
    const rings = s.rings
      .map((r) => douglasPeucker(toMm(r), simplifyTolMm))
      .filter((r) => r.length >= 3);
    if (rings.length === 0) continue;
    // Net area = outer minus holes (largest ring is the outer boundary).
    const areas = rings.map((r) => Math.abs(polygonArea(r)));
    const outer = Math.max(...areas);
    const holes = areas.reduce((s2, a) => s2 + a, 0) - outer;
    const net = outer - holes;
    if (net < minAreaMm2) continue;
    scaled.push({ rings, fill: s.fill, area: net });
  }
  if (scaled.length === 0) return { colors: [], objects: [] };

  // Optional palette reduction to a thread budget.
  const remap = maxColors > 0
    ? reducePalette(scaled.map((s) => ({ rgb: s.fill, area: s.area })), maxColors)
    : null;
  const finalFill = (rgb: RGB): RGB => (remap ? remap.get(rgb.join(",")) ?? rgb : rgb);

  // One thread per distinct final colour; one object per colour holding all its
  // shapes (matching the tracer's colour-grouped output).
  const colorIdByRgb = new Map<string, string>();
  const colors: ThreadColor[] = [];
  const ringsByColor = new Map<string, Path[]>();
  const areaByColor = new Map<string, number>();
  const usedNames = new Map<string, number>();
  for (const s of scaled) {
    const rgb = finalFill(s.fill);
    const kk = rgb.join(",");
    let cid = colorIdByRgb.get(kk);
    if (!cid) {
      cid = newId("color");
      colorIdByRgb.set(kk, cid);
      const base = nameForRgb(rgb);
      const n = (usedNames.get(base) ?? 0) + 1;
      usedNames.set(base, n);
      colors.push({ id: cid, rgb, name: n === 1 ? base : `${base} ${n}` });
      ringsByColor.set(cid, []);
    }
    ringsByColor.get(cid)!.push(...s.rings);
    areaByColor.set(cid, (areaByColor.get(cid) ?? 0) + s.area);
  }

  // Largest colour first (background-like areas sew first), matching the tracer.
  const ordered = [...colors].sort((a, b) => (areaByColor.get(b.id) ?? 0) - (areaByColor.get(a.id) ?? 0));
  const objects: EmbObject[] = ordered.map((c) =>
    makeObjectFromPaths("fill", ringsByColor.get(c.id)!, c.id, c.name),
  );
  return { colors: ordered, objects };
}

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
import { railsFromCenterline } from "../geometry";
import { douglasPeucker } from "./simplify";
import { polygonArea } from "./classify";
import { nameForRgb } from "./colorname";
import type { DigitizeResult } from "./index";

export type RGB = [number, number, number];

/** One shape from an SVG, already in a single user-unit space (all transforms
 *  baked in). Either a FILLED shape (rings; sub-path rings are its own holes via
 *  fill-rule parity) or a STROKED path (centerline + width) — linework a logo
 *  draws with `stroke` rather than ink shapes. */
export interface SvgShape {
  /** Closed rings in SVG user units (filled shapes). */
  rings: Path[];
  fill: RGB;
  /** Present for stroke-only paths: the flattened centerline(s) and the stroke
   *  width in user units. `fill` then carries the STROKE colour. */
  stroke?: { centerlines: Path[]; widthUnits: number; closed: boolean[] };
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
 *
 * SVG PAINTS shapes over each other in document order — z-order IS the
 * semantics. So each shape becomes its OWN object, in document order: sew
 * order = paint order, and the apply-time knockdown pass resolves overlaps
 * (later shapes subtract from earlier fills; small features stack on top)
 * exactly as it does for hand-drawn designs. Merging a colour's shapes into
 * one multi-ring object is WRONG here: two same-colour overlapping shapes
 * would toggle fill parity and punch a bare hole where they overlap.
 *
 * Stroke-only paths (linework a logo draws with `stroke`) become SATIN
 * columns down their centerline at the stroke's width.
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

  // Scale + simplify each shape, keeping DOCUMENT ORDER; drop specks.
  interface Scaled {
    fill: RGB;
    area: number;
    rings?: Path[]; // filled shape
    satin?: { rails: [Path, Path][]; widthMm: number }; // stroked path
  }
  const scaled: Scaled[] = [];
  for (const s of shapes) {
    if (s.stroke) {
      const widthMm = s.stroke.widthUnits * mmPerUnit;
      if (widthMm < 0.3) continue; // sub-thread hairline
      const rails: [Path, Path][] = [];
      let len = 0;
      s.stroke.centerlines.forEach((cl, i) => {
        const center = douglasPeucker(toMm(cl), simplifyTolMm);
        if (center.length < 2) return;
        rails.push(railsFromCenterline(center, widthMm, s.stroke!.closed[i] ?? false));
        for (let k = 1; k < center.length; k++)
          len += Math.hypot(center[k].x - center[k - 1].x, center[k].y - center[k - 1].y);
      });
      const area = len * widthMm;
      if (rails.length === 0 || area < minAreaMm2) continue;
      scaled.push({ fill: s.fill, area, satin: { rails, widthMm } });
      continue;
    }
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

  // One thread per distinct final colour (first-appearance order); one object
  // PER SHAPE in document order (paint order = sew order; knockdown resolves
  // overlaps at apply time).
  const colorIdByRgb = new Map<string, string>();
  const colors: ThreadColor[] = [];
  const usedNames = new Map<string, number>();
  const colorIdFor = (rgb: RGB): string => {
    const kk = rgb.join(",");
    let cid = colorIdByRgb.get(kk);
    if (!cid) {
      cid = newId("color");
      colorIdByRgb.set(kk, cid);
      const base = nameForRgb(rgb);
      const n = (usedNames.get(base) ?? 0) + 1;
      usedNames.set(base, n);
      colors.push({ id: cid, rgb, name: n === 1 ? base : `${base} ${n}` });
    }
    return cid;
  };
  const objects: EmbObject[] = [];
  for (const s of scaled) {
    const cid = colorIdFor(finalFill(s.fill));
    const cname = colors.find((c) => c.id === cid)?.name;
    if (s.satin) {
      // Each stroked sub-path is its own satin column (left/right rails).
      for (const [left, right] of s.satin.rails) {
        objects.push(makeObjectFromPaths("satin", [left, right], cid, cname));
      }
    } else {
      objects.push(makeObjectFromPaths("fill", s.rings!, cid, cname));
    }
  }
  return { colors, objects };
}

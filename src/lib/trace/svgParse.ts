/**
 * Browser SVG → flattened shapes. Uses the DOM's own SVG engine (never an
 * external parser): we mount the SVG offscreen, walk every fillable element,
 * flatten its geometry to points with `getPointAtLength`, and bake in the full
 * transform chain via `getCTM`. That gives exact polygon rings in one user-unit
 * space, plus each element's resolved fill — which svgShapesToObjects maps into
 * the hoop. Browser-only (needs a live SVG DOM); the pure mapping/quantisation
 * lives in svgImport.ts and is headless-tested.
 */
import type { Path } from "../../types/project";
import type { RGB, SvgShape } from "./svgImport";

/** Sample step (user units) when flattening a path — fine enough that even a big
 *  logo's curves stay smooth; the mm-space simplify drops the redundant points. */
const FLATTEN_STEP = 1.5;

/** Normalise any CSS colour syntax to RGB via a probe node, or null. */
function cssToRgb(el: Element, css: string): RGB | null {
  if (!css || css === "none") return null;
  const win = el.ownerDocument?.defaultView;
  const probe = el.ownerDocument!.createElement("span");
  probe.style.color = css;
  el.ownerDocument!.body.appendChild(probe);
  const rgb = (win ? win.getComputedStyle(probe).color : "") || "";
  probe.remove();
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Resolve a paint that may be a url(#gradient) reference. Embroidery is flat
 * colour, so a gradient flattens to its VISUAL MIDPOINT — the interpolated
 * colour at offset 0.5 (a red field shaded e0304e→c8102e→8e0a20 sews as the
 * middle red, exactly what a digitizer would pick). Follows one href level
 * (stops defined on a referenced base gradient, the common icon-pack export).
 * References resolve inside the element's OWN mounted SVG root — never the
 * page document, where an unrelated app element could share the id. An
 * unresolvable reference honours SVG's paint fallback when the author gave
 * one (`fill="url(#missing) red"`); with no fallback the shape is SKIPPED,
 * matching the spec's "not rendered" — never CSS's inherited-colour fallback,
 * which painted every gradient-filled logo as one black slab.
 */
function paintToRgb(el: Element, css: string): RGB | null {
  const ref = css.match(/url\(\s*["']?#([^"')\s]+)["']?\s*\)\s*(.*)$/i);
  if (!ref) return cssToRgb(el, css);
  const fallback = ref[2].trim();
  const fallbackRgb = () =>
    fallback && fallback.toLowerCase() !== "none" ? cssToRgb(el, fallback) : null;
  // Scope id resolution to the outermost SVG this element is mounted in.
  let root: Element = el;
  while ((root as SVGElement).ownerSVGElement) root = (root as SVGElement).ownerSVGElement!;
  const byId = (id: string): Element | null => {
    try {
      return root.querySelector(`#${CSS.escape(id)}`);
    } catch {
      return null;
    }
  };
  let node: Element | null = byId(ref[1]);
  let stops = node ? Array.from(node.querySelectorAll("stop")) : [];
  if (node && stops.length === 0) {
    const href = node.getAttribute("href") || node.getAttribute("xlink:href") || "";
    node = href.startsWith("#") ? byId(href.slice(1)) : null;
    if (node) stops = Array.from(node.querySelectorAll("stop"));
  }
  const parsed = stops
    .map((s) => {
      const raw = (s.getAttribute("offset") || "0").trim();
      const n = parseFloat(raw);
      const o = !isFinite(n) ? 0 : raw.endsWith("%") ? n / 100 : n;
      const color =
        (s.getAttribute("stop-color") || (s as SVGElement).style?.stopColor || "").trim() ||
        (el.ownerDocument?.defaultView?.getComputedStyle(s).stopColor ?? "");
      const rgb = color ? cssToRgb(s, color) : null;
      return rgb ? { o: Math.max(0, Math.min(1, o)), rgb } : null;
    })
    .filter((s): s is { o: number; rgb: RGB } => s !== null)
    .sort((a, b) => a.o - b.o);
  if (parsed.length === 0) return fallbackRgb();
  const t = 0.5;
  let lo = parsed[0];
  let hi = parsed[parsed.length - 1];
  for (const s of parsed) {
    if (s.o <= t) lo = s;
    if (s.o >= t) {
      hi = s;
      break;
    }
  }
  if (hi.o <= lo.o) return lo.rgb;
  const f = (t - lo.o) / (hi.o - lo.o);
  return [0, 1, 2].map((k) => Math.round(lo.rgb[k] + (hi.rgb[k] - lo.rgb[k]) * f)) as RGB;
}

/** The element's FILL colour, or null when unpainted (fill:none / transparent). */
function parseFill(el: Element): RGB | null {
  const win = el.ownerDocument?.defaultView;
  const style = win ? win.getComputedStyle(el) : null;
  const fill = (style?.fill || el.getAttribute("fill") || "").trim();
  const opacity = parseFloat(style?.fillOpacity || el.getAttribute("fill-opacity") || "1");
  if (!fill || fill === "none" || opacity === 0) return null;
  return paintToRgb(el, fill);
}

/** The element's STROKE paint + width (user units), or null when unstroked.
 *  Logos often draw their linework (an arch, a divider) as strokes — dropping
 *  those silently loses whole design elements. */
function parseStroke(el: Element): { rgb: RGB; width: number } | null {
  const win = el.ownerDocument?.defaultView;
  const style = win ? win.getComputedStyle(el) : null;
  const stroke = (style?.stroke || el.getAttribute("stroke") || "").trim();
  const opacity = parseFloat(style?.strokeOpacity || el.getAttribute("stroke-opacity") || "1");
  if (!stroke || stroke === "none" || opacity === 0) return null;
  const width = parseFloat(style?.strokeWidth || el.getAttribute("stroke-width") || "1");
  if (!(width > 0)) return null;
  const rgb = paintToRgb(el, stroke);
  return rgb ? { rgb, width } : null;
}

/** Apply an SVGMatrix (element's CTM relative to the root) to a point. */
function applyCTM(m: DOMMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** Flatten one <path>/<rect>/<circle>/<ellipse>/<polygon> into closed rings in
 *  root user units (transforms baked in via its CTM). A path with sub-paths (an
 *  'O', a letter with a counter) yields one ring per sub-path. */
function flattenElement(el: SVGGraphicsElement, rootCTM: DOMMatrix): Path[] {
  const total = (el as SVGGeometryElement).getTotalLength?.() ?? 0;
  if (!total) return [];
  const ctm = el.getCTM();
  // CTM maps element space → nearest viewport; compose with the inverse root so
  // every shape lands in ONE shared space.
  const m = rootCTM.inverse().multiply(ctm ?? new DOMMatrix());
  const rings: Path[] = [];
  let cur: Path = [];
  let prev: { x: number; y: number } | null = null;
  const n = Math.max(2, Math.ceil(total / FLATTEN_STEP));
  for (let i = 0; i <= n; i++) {
    const pt = (el as SVGGeometryElement).getPointAtLength((total * i) / n);
    const p = applyCTM(m, pt.x, pt.y);
    // A large jump = a new sub-path (getPointAtLength walks them contiguously,
    // so a discontinuity marks the boundary between an outer and a counter).
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > FLATTEN_STEP * 8) {
      if (cur.length >= 3) rings.push(cur);
      cur = [];
    }
    cur.push(p);
    prev = p;
  }
  if (cur.length >= 3) rings.push(cur);
  return rings;
}

const FILLABLE = "path, rect, circle, ellipse, polygon";

/** Containers whose shape content is NOT rendered directly: definitions
 *  (gradients' probe shapes, clip/mask/pattern content, symbol templates).
 *  Walking them imported phantom shapes — a pattern's swatch rect or a
 *  symbol's template landed in the artwork at a bogus transform. Matching is
 *  case-sensitive for SVG elements in an HTML document, so the camelCase
 *  names are written as-is. */
const NON_RENDERED = "defs, symbol, clipPath, mask, pattern, marker, linearGradient, radialGradient";

/** True when the element doesn't render: `display:none` on it or any ancestor
 *  (display does not inherit, so every ancestor is checked), or a computed
 *  `visibility` other than visible (visibility DOES inherit — and a child
 *  re-showing itself with visibility:visible correctly reads visible here). */
function isHidden(el: Element, root: Element): boolean {
  const win = el.ownerDocument?.defaultView;
  if (!win) return false;
  const vis = win.getComputedStyle(el).visibility;
  if (vis === "hidden" || vis === "collapse") return true;
  for (let a: Element | null = el; a; a = a.parentElement) {
    if (win.getComputedStyle(a).display === "none") return true;
    if (a === root) break;
  }
  return false;
}

/** Parse SVG text into flattened, fill-resolved shapes plus the artwork bbox.
 *  Returns null if the string isn't a usable SVG. */
export function parseSvgShapes(svgText: string): { shapes: SvgShape[]; contentW: number; contentH: number } | null {
  if (typeof document === "undefined") return null;
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg || doc.querySelector("parsererror")) return null;

  // Mount offscreen so getCTM/getPointAtLength/getComputedStyle resolve.
  const host = document.createElement("div");
  host.setAttribute("style", "position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden");
  const live = svg.cloneNode(true) as SVGSVGElement;
  host.appendChild(live);
  document.body.appendChild(host);
  try {
    const rootCTM = live.getCTM() ?? live.getScreenCTM() ?? new DOMMatrix();
    const shapes: SvgShape[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (rings: Path[]) => {
      for (const r of rings)
        for (const p of r) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
    };
    for (const el of Array.from(live.querySelectorAll(FILLABLE)) as SVGGraphicsElement[]) {
      // Definition content (defs/pattern/clipPath/symbol/gradient/mask/marker
      // internals) is not itself artwork, and hidden elements don't render.
      if (el.closest(NON_RENDERED)) continue;
      if (isHidden(el, live)) continue;
      const fill = parseFill(el);
      const stroke = parseStroke(el);
      if (!fill && !stroke) continue;
      const rings = flattenElement(el, rootCTM);
      if (rings.length === 0) continue;
      if (fill) {
        shapes.push({ rings, fill });
        grow(rings);
      }
      if (stroke) {
        // The stroke rides the same flattened geometry: each sub-path ring is a
        // centerline; closed when its ends meet.
        const closed = rings.map((r) => {
          const a = r[0], b = r[r.length - 1];
          return Math.hypot(a.x - b.x, a.y - b.y) < FLATTEN_STEP * 2;
        });
        shapes.push({ rings: [], fill: stroke.rgb, stroke: { centerlines: rings, widthUnits: stroke.width, closed } });
        grow(rings);
      }
    }
    if (shapes.length === 0 || !isFinite(minX)) return null;
    // Normalise so the artwork starts at the origin (content bbox, not viewBox —
    // robust to padding/whitespace around the design).
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const shift = (r: Path) => r.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    for (const s of shapes) {
      s.rings = s.rings.map(shift);
      if (s.stroke) s.stroke.centerlines = s.stroke.centerlines.map(shift);
    }
    return { shapes, contentW, contentH };
  } finally {
    host.remove();
  }
}

export type { SvgShape };

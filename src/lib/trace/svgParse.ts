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
import { blendWithWhite, clipShapeRings, insideEvenOdd } from "./svgImport";
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
 * A pattern fill flattens to the pattern content's DOMINANT flat colour —
 * embroidery can't sew a repeating swatch, and in this art class a pattern is
 * a texture whose overall read IS its main colour (dot grids, hatching on a
 * ground). Colours are weighted by each pattern shape's bbox area, so the
 * ground rect outweighs the dots riding on it. Children painted with nested
 * url() paints are skipped (no recursive resolution). Null when the pattern
 * paints nothing resolvable.
 */
function patternDominantRgb(pattern: Element): RGB | null {
  const win = pattern.ownerDocument?.defaultView;
  const buckets = new Map<string, { rgb: RGB; w: number }>();
  for (const child of Array.from(pattern.querySelectorAll(FILLABLE)) as SVGGraphicsElement[]) {
    const raw = (
      child.getAttribute("fill") ||
      (child as SVGElement).style?.fill ||
      (win ? win.getComputedStyle(child).fill : "") ||
      ""
    ).trim();
    if (!raw || raw.toLowerCase() === "none" || /url\(/i.test(raw)) continue;
    const rgb = cssToRgb(child, raw);
    if (!rgb) continue;
    let w = 1;
    try {
      const bb = child.getBBox();
      w = Math.max(1, bb.width * bb.height);
    } catch {
      /* getBBox can throw for unrendered content — weight it once */
    }
    const key = rgb.join(",");
    const b = buckets.get(key);
    if (b) b.w += w;
    else buckets.set(key, { rgb, w });
  }
  let best: { rgb: RGB; w: number } | null = null;
  for (const b of buckets.values()) if (!best || b.w > best.w) best = b;
  return best?.rgb ?? null;
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
  if (node && node.tagName.toLowerCase() === "pattern") {
    // Pattern fill → the content's dominant flat colour. Follows one href
    // level for content-less patterns (a base pattern carrying the tiles),
    // mirroring the gradient href convention below.
    let pat: Element | null = node;
    if (!pat.querySelector(FILLABLE)) {
      const href = pat.getAttribute("href") || pat.getAttribute("xlink:href") || "";
      pat = href.startsWith("#") ? byId(href.slice(1)) : null;
    }
    const dominant = pat ? patternDominantRgb(pat) : null;
    return dominant ?? fallbackRgb();
  }
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

/** The element's FILL colour + fill-opacity, or null when unpainted
 *  (fill:none / fill-opacity 0). Partial opacity is returned for the caller to
 *  flatten (blend toward white), not dropped. */
function parseFill(el: Element): { rgb: RGB; alpha: number } | null {
  const win = el.ownerDocument?.defaultView;
  const style = win ? win.getComputedStyle(el) : null;
  const fill = (style?.fill || el.getAttribute("fill") || "").trim();
  const opacity = parseFloat(style?.fillOpacity || el.getAttribute("fill-opacity") || "1");
  if (!fill || fill === "none" || opacity === 0) return null;
  const rgb = paintToRgb(el, fill);
  return rgb ? { rgb, alpha: Number.isFinite(opacity) ? opacity : 1 } : null;
}

/** The element's STROKE paint + width (user units) + stroke-opacity, or null
 *  when unstroked. Logos often draw their linework (an arch, a divider) as
 *  strokes — dropping those silently loses whole design elements. */
function parseStroke(el: Element): { rgb: RGB; width: number; alpha: number } | null {
  const win = el.ownerDocument?.defaultView;
  const style = win ? win.getComputedStyle(el) : null;
  const stroke = (style?.stroke || el.getAttribute("stroke") || "").trim();
  const opacity = parseFloat(style?.strokeOpacity || el.getAttribute("stroke-opacity") || "1");
  if (!stroke || stroke === "none" || opacity === 0) return null;
  const width = parseFloat(style?.strokeWidth || el.getAttribute("stroke-width") || "1");
  if (!(width > 0)) return null;
  const rgb = paintToRgb(el, stroke);
  return rgb ? { rgb, width, alpha: Number.isFinite(opacity) ? opacity : 1 } : null;
}

/** Cumulative element `opacity` from el up through the mounted root. Unlike
 *  fill-opacity it applies to the whole subtree, doesn't inherit, and stacks
 *  multiplicatively — a shape at opacity .8 inside a group at opacity .5
 *  renders at .4. */
function groupOpacity(el: Element, root: Element): number {
  const win = el.ownerDocument?.defaultView;
  if (!win) return 1;
  let alpha = 1;
  for (let a: Element | null = el; a; a = a.parentElement) {
    const o = parseFloat(win.getComputedStyle(a).opacity || "1");
    if (Number.isFinite(o)) alpha *= Math.max(0, Math.min(1, o));
    if (a === root) break;
  }
  return alpha;
}

/** Apply an SVGMatrix (element's CTM relative to the root) to a point. */
function applyCTM(m: DOMMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** Hard cap on samples per element — a guard against a pathological CTM scale
 *  turning one path into millions of points. */
const MAX_SAMPLES = 20000;

/** Flatten one geometry element into closed rings in root user units
 *  (transforms baked in via its CTM). A path with sub-paths (an 'O', a letter
 *  with a counter) yields one ring per sub-path. `stepUnits` is the sample
 *  step in ROOT user units. */
function flattenElement(el: SVGGraphicsElement, rootCTM: DOMMatrix, stepUnits = FLATTEN_STEP): Path[] {
  const total = (el as SVGGeometryElement).getTotalLength?.() ?? 0;
  if (!total) return [];
  // SCREEN CTMs, not getCTM: getCTM stops at the NEAREST viewport, so a shape
  // inside a nested <svg> (a materialised <symbol> instance) would lose every
  // transform outside it. The screen CTM carries the full chain — composing
  // with the inverse root screen CTM cancels the offscreen-mount offset and
  // lands every shape in ONE shared root-user-unit space.
  const ctm = el.getScreenCTM() ?? el.getCTM();
  const m = rootCTM.inverse().multiply(ctm ?? new DOMMatrix());
  // getTotalLength is LOCAL length; samples must land ~stepUnits apart in ROOT
  // space or a scaled-up instance (a symbol's 30x viewport, a scale() group)
  // makes every sample step exceed the sub-path discontinuity threshold below
  // and the whole shape shreds into sub-3-point "rings" and vanishes. Scale =
  // the matrix's largest axis growth (exact for the rotate/scale/translate
  // transforms flat art uses).
  const scale = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)) || 1;
  const n = Math.max(2, Math.min(MAX_SAMPLES, Math.ceil((total * scale) / stepUnits)));
  const rings: Path[] = [];
  let cur: Path = [];
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i <= n; i++) {
    const pt = (el as SVGGeometryElement).getPointAtLength((total * i) / n);
    const p = applyCTM(m, pt.x, pt.y);
    // A large jump = a new sub-path (getPointAtLength walks them contiguously,
    // so a discontinuity marks the boundary between an outer and a counter).
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > stepUnits * 8) {
      if (cur.length >= 3) rings.push(cur);
      cur = [];
    }
    cur.push(p);
    prev = p;
  }
  if (cur.length >= 3) rings.push(cur);
  return rings;
}

/** Geometry elements the walk flattens. <line> and <polyline> are stroke-first
 *  geometry (icon linework, underlines, zig-zag borders): both flatten fine via
 *  getTotalLength/getPointAtLength. A <polyline> can also carry a fill (painted
 *  as if closed); a <line> encloses no area, so its fill is ignored. */
const FILLABLE = "path, rect, circle, ellipse, polygon, polyline, line";

/**
 * Flatten one clipPath's content to rings in root user space. userSpaceOnUse
 * (the default) means the clip's coordinates live in the REFERENCING element's
 * user space, so the clip children are re-mounted under a temporary group
 * carrying that element's root-relative matrix — the DOM engine then resolves
 * their CTMs (own transforms included) exactly as it would in a real render.
 * objectBoundingBox units prepend the element's bbox mapping.
 */
function flattenClipRings(
  clipEl: Element,
  refEl: SVGGraphicsElement,
  live: SVGSVGElement,
  rootCTM: DOMMatrix,
  stepUnits: number,
): Path[] {
  let rel = rootCTM.inverse().multiply(refEl.getScreenCTM() ?? refEl.getCTM() ?? new DOMMatrix());
  if (clipEl.getAttribute("clipPathUnits") === "objectBoundingBox") {
    try {
      const bb = refEl.getBBox();
      rel = rel.translate(bb.x, bb.y).scale(bb.width || 1, bb.height || 1);
    } catch {
      /* bbox unavailable — fall back to user space */
    }
  }
  const g = live.ownerDocument.createElementNS(SVGNS, "g");
  g.setAttribute("transform", `matrix(${rel.a} ${rel.b} ${rel.c} ${rel.d} ${rel.e} ${rel.f})`);
  for (const child of Array.from(clipEl.children)) g.appendChild(child.cloneNode(true));
  live.appendChild(g);
  try {
    const rings: Path[] = [];
    for (const c of Array.from(g.querySelectorAll(FILLABLE)) as SVGGraphicsElement[]) {
      rings.push(...flattenElement(c, rootCTM, stepUnits));
    }
    return rings;
  } finally {
    g.remove();
  }
}

/**
 * Every clip region applying to `el`: one flattened ring-set per `clip-path`
 * on the element or an ancestor (Figma/Illustrator wrap whole exports in a
 * clip group). Returns null when a clipPath resolves to no geometry — per
 * spec that clips the element to NOTHING, so it isn't rendered. A dangling
 * url(#missing) clip reference applies no clipping (modern css-masking
 * behavior, matching what the browser actually paints).
 */
function collectClips(
  el: Element,
  live: SVGSVGElement,
  rootCTM: DOMMatrix,
  stepUnits: number,
): Path[][] | null {
  const win = el.ownerDocument?.defaultView;
  const sets: Path[][] = [];
  for (let a: Element | null = el; a; a = a.parentElement) {
    const raw = a.getAttribute("clip-path") || (win ? win.getComputedStyle(a).clipPath : "") || "";
    const m = raw.match(/url\(\s*["']?#([^"')\s]+)/i);
    if (m) {
      let clipEl: Element | null = null;
      try {
        clipEl = live.querySelector(`#${CSS.escape(m[1])}`);
      } catch {
        clipEl = null;
      }
      if (clipEl && clipEl.tagName.toLowerCase() === "clippath") {
        const rings = flattenClipRings(clipEl, a as SVGGraphicsElement, live, rootCTM, stepUnits);
        if (rings.length === 0) return null;
        sets.push(rings);
      }
    }
    if (a === live) break;
  }
  return sets;
}

/** Containers whose shape content is NOT rendered directly: definitions
 *  (gradients' probe shapes, clip/mask/pattern content, symbol templates).
 *  Walking them imported phantom shapes — a pattern's swatch rect or a
 *  symbol's template landed in the artwork at a bogus transform. Matching is
 *  case-sensitive for SVG elements in an HTML document, so the camelCase
 *  names are written as-is. */
const NON_RENDERED = "defs, symbol, clipPath, mask, pattern, marker, linearGradient, radialGradient";

const SVGNS = "http://www.w3.org/2000/svg";

/** <use> attributes that must NOT copy onto the instance group: geometry and
 *  linking live on the group/instance itself; everything else (fill, stroke,
 *  class, style, opacity, clip-path, display…) inherits into the instance
 *  exactly as SVG specifies for use shadows. */
const USE_OWN_ATTRS = new Set(["href", "xlink:href", "x", "y", "width", "height", "id", "transform"]);

/**
 * Materialise every <use> instance as a real subtree, IN PLACE. querySelectorAll
 * never returns the shapes a live <use> instantiates (they render in a closed
 * shadow tree), so icon-pack exports built on use/symbol imported as nothing.
 * Each <use> becomes a <g transform="{use transform} translate(x y)"> holding a
 * clone of its target — the DOM engine then resolves the full CTM chain for the
 * walk exactly as it does for authored shapes. A <symbol>/<svg> target becomes
 * a nested <svg> carrying the symbol's viewBox plus the use's width/height, so
 * the engine bakes the symbol's viewport mapping into getCTM too. Passes are
 * bounded so nested (or maliciously cyclic) use chains terminate.
 */
function expandUses(root: SVGSVGElement): void {
  const doc = root.ownerDocument;
  for (let pass = 0; pass < 6; pass++) {
    const uses = Array.from(root.querySelectorAll("use"));
    if (uses.length === 0) return;
    for (const use of uses) {
      const g = doc.createElementNS(SVGNS, "g");
      const x = parseFloat(use.getAttribute("x") || "0") || 0;
      const y = parseFloat(use.getAttribute("y") || "0") || 0;
      const tf = use.getAttribute("transform") ?? "";
      // Per spec the x/y shift applies AFTER the use's own transform.
      g.setAttribute("transform", `${tf} translate(${x} ${y})`.trim());
      for (const attr of Array.from(use.attributes)) {
        if (!USE_OWN_ATTRS.has(attr.name)) g.setAttribute(attr.name, attr.value);
      }
      const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
      let target: Element | null = null;
      if (href.startsWith("#")) {
        try {
          target = root.querySelector(`#${CSS.escape(href.slice(1))}`);
        } catch {
          target = null;
        }
      }
      if (target) {
        const clone = target.cloneNode(true) as SVGElement;
        clone.removeAttribute("id"); // instances must not duplicate the target id
        const tag = clone.tagName.toLowerCase();
        if (tag === "symbol" || tag === "svg") {
          // Instantiate as a real nested <svg> so the viewBox→viewport mapping
          // lands in the children's CTMs. Size precedence per spec: the use's
          // width/height, else the symbol's own; with neither, fall back to the
          // root's viewBox size (the offscreen mount has a 0-sized viewport, so
          // the spec's 100% default would collapse the instance to nothing).
          const inst = doc.createElementNS(SVGNS, "svg");
          for (const attr of Array.from(clone.attributes)) inst.setAttribute(attr.name, attr.value);
          const w = use.getAttribute("width");
          const h = use.getAttribute("height");
          if (w) inst.setAttribute("width", w);
          if (h) inst.setAttribute("height", h);
          const vb = root.viewBox?.baseVal;
          if (!inst.getAttribute("width")) inst.setAttribute("width", String(vb?.width || 100));
          if (!inst.getAttribute("height")) inst.setAttribute("height", String(vb?.height || 100));
          while (clone.firstChild) inst.appendChild(clone.firstChild);
          g.appendChild(inst);
        } else {
          g.appendChild(clone);
        }
      }
      use.replaceWith(g);
    }
  }
}

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
 *  `textCount` reports visible <text> elements — deliberately NOT traced
 *  (rasterized type sews badly; the studio's Text tool sets crisp lettering),
 *  so the dialog can point the user there. Returns null if the string isn't a
 *  usable SVG. */
export function parseSvgShapes(
  svgText: string,
): { shapes: SvgShape[]; contentW: number; contentH: number; textCount: number } | null {
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
    // Materialise use/symbol instances first: their shadow-rendered shapes are
    // invisible to querySelectorAll, and the walk below needs real elements.
    expandUses(live);
    // Screen CTM so nested viewports resolve — see flattenElement.
    const rootCTM = live.getScreenCTM() ?? live.getCTM() ?? new DOMMatrix();
    // Sample step in root user units. FLATTEN_STEP is tuned for the common
    // few-hundred-to-few-thousand-unit viewBox; a 24-unit icon viewBox would
    // flatten a circle to ~16 points, so small canvases scale the step down
    // (the mm-space simplify drops any excess).
    const vb = live.viewBox?.baseVal;
    const step =
      vb && vb.width > 0 && vb.height > 0
        ? Math.min(FLATTEN_STEP, Math.max(vb.width, vb.height) / 512)
        : FLATTEN_STEP;
    // Visible <text> with real content — surfaced, never traced.
    const textCount = Array.from(live.querySelectorAll("text")).filter(
      (t) => !t.closest(NON_RENDERED) && (t.textContent ?? "").trim().length > 0 && !isHidden(t, live),
    ).length;
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
      // A <line> encloses no area — fill paints nothing on it per spec.
      const fill = el.tagName.toLowerCase() === "line" ? null : parseFill(el);
      const stroke = parseStroke(el);
      if (!fill && !stroke) continue;
      // Whole-subtree translucency (element/group `opacity`) flattens into the
      // colour: embroidery has no alpha, and in this flat-art class a
      // translucent overlay reads as its colour washed toward the white page.
      const alpha = groupOpacity(el, live);
      if (alpha === 0) continue;
      // clip-path on the element or an ancestor. null = clipped to nothing.
      const clips = collectClips(el, live, rootCTM, step);
      if (clips === null) continue;
      const rings = flattenElement(el, rootCTM, step);
      if (rings.length === 0) continue;
      if (fill) {
        let fillRings = rings;
        for (const c of clips) {
          fillRings = clipShapeRings(fillRings, c);
          if (fillRings.length === 0) break;
        }
        if (fillRings.length > 0) {
          shapes.push({ rings: fillRings, fill: blendWithWhite(fill.rgb, fill.alpha * alpha) });
          grow(fillRings);
        }
      }
      if (stroke) {
        // The stroke rides the same flattened geometry: each sub-path ring is a
        // centerline; closed when its ends meet. Clip LIMIT for strokes: a
        // centerline entirely outside a clip is dropped, but a partially
        // clipped one keeps its full run — splitting satin columns at the clip
        // edge is disproportionate for this flat-art class.
        const kept = rings.filter((r) => clips.every((c) => r.some((p) => insideEvenOdd(p, c))));
        if (kept.length > 0) {
          const closed = kept.map((r) => {
            const a = r[0], b = r[r.length - 1];
            return Math.hypot(a.x - b.x, a.y - b.y) < step * 2;
          });
          shapes.push({
            rings: [],
            fill: blendWithWhite(stroke.rgb, stroke.alpha * alpha),
            stroke: { centerlines: kept, widthUnits: stroke.width, closed },
          });
          grow(kept);
        }
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
    return { shapes, contentW, contentH, textCount };
  } finally {
    host.remove();
  }
}

export type { SvgShape };

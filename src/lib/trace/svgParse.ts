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

/** Parse `none`/`#rgb`/`#rrggbb`/`rgb(...)`/named-ish fills to an RGB, or null
 *  when the element isn't painted (fill:none / fully transparent). */
function parseFill(el: Element): RGB | null {
  const win = el.ownerDocument?.defaultView;
  const style = win ? win.getComputedStyle(el) : null;
  const fill = (style?.fill || el.getAttribute("fill") || "").trim();
  const opacity = parseFloat(style?.fillOpacity || el.getAttribute("fill-opacity") || "1");
  if (!fill || fill === "none" || opacity === 0) return null;
  // Let the browser normalise any colour syntax to rgb() by probing a temp node.
  const probe = el.ownerDocument!.createElement("span");
  probe.style.color = fill;
  el.ownerDocument!.body.appendChild(probe);
  const rgb = (win ? win.getComputedStyle(probe).color : "") || "";
  probe.remove();
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
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
    for (const el of Array.from(live.querySelectorAll(FILLABLE)) as SVGGraphicsElement[]) {
      const fill = parseFill(el);
      if (!fill) continue;
      const rings = flattenElement(el, rootCTM);
      if (rings.length === 0) continue;
      shapes.push({ rings, fill });
      for (const r of rings)
        for (const p of r) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
    }
    if (shapes.length === 0 || !isFinite(minX)) return null;
    // Normalise so the artwork starts at the origin (content bbox, not viewBox —
    // robust to padding/whitespace around the design).
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    for (const s of shapes)
      s.rings = s.rings.map((r) => r.map((p) => ({ x: p.x - minX, y: p.y - minY })));
    return { shapes, contentW, contentH };
  } finally {
    host.remove();
  }
}

export type { SvgShape };

/**
 * USER-DRIVEN text replacement — the professional move that OCR can't do.
 *
 * Auto-OCR fails exactly where a crest needs help: small, stylized, rotated, or
 * low-resolution text. So instead of guessing the string, we let the user TYPE
 * it (one line per text element, in reading order). We then find the traced
 * glyph CLUSTER each line refers to, read its position, size and ANGLE straight
 * from the geometry, and drop in authored font lettering that sews perfectly —
 * the same crisp satin the app's lettering tool produces, because nothing is
 * traced. This is the single biggest quality unlock for logos and crests.
 *
 * Pure and headless-testable: given the user's lines, the traced objects and a
 * font, it returns the lettering objects to add and the rough traced ids to drop.
 */
import type { Font } from "opentype.js";
import type { EmbObject, Point } from "../../types/project";
import { layoutText } from "../text/layout";
import { applyMatrix, pathsBounds } from "../geometry";
import { polygonArea } from "./classify";
import { splitFillRegions } from "../engine/fill";

/** A text-like cluster the UI can highlight and ask the user to name. Stable id,
 *  an oriented preview quad (mm, for the overlay), and the geometry placement
 *  needs. */
export interface DetectedTextCluster {
  id: string;
  angleDeg: number;
  heightMm: number;
  lengthMm: number;
  cx: number;
  cy: number;
  colorId: string;
  /** four corners (mm) of the oriented box, for drawing the highlight. */
  quad: Point[];
  /** traced object ids this cluster's glyphs belong to (dropped when replaced). */
  removeIds: string[];
}

export interface ManualTextOptions {
  /** What the user typed for each detected cluster, keyed by cluster id. Empty or
   *  missing → that cluster is left as the plain trace. */
  assignments: Record<string, string>;
  clusters: DetectedTextCluster[];
  objects: EmbObject[];
  font: Font;
  fontId?: string;
}

export interface ManualTextResult {
  textObjects: EmbObject[];
  removeIds: string[];
  /** Number of clusters the user named and were placed. */
  placed: number;
}

/** One glyph-scale piece: a connected region of a traced fill, tagged with the
 *  object it came from (so the whole object can be dropped when replaced). */
interface GlyphPiece {
  objectId: string;
  colorId: string;
  cx: number;
  cy: number;
  dim: number;
  area: number;
}

/** A detected cluster of small glyph-like shapes: its member object ids, oriented
 *  frame (centre, axis angle, extents along/across the run), and dominant ink. */
interface Cluster {
  ids: string[];
  cx: number;
  cy: number;
  angleRad: number; // direction the text RUNS (baseline), from PCA
  lengthMm: number; // extent along the run
  heightMm: number; // extent across the run (cap height)
  colorId: string;
  /** centre projected onto the cross-axis, for reading-order sorting. */
  order: number;
}

const DEFAULT_MIN_HEIGHT_MM = 3;
/** A glyph shape is small and compact — a letter, not a logo mark. */
const GLYPH_MAX_DIM_MM = 16;
const GLYPH_MIN_AREA_MM2 = 0.4;
/** Two glyph shapes join a cluster when their gap is under this multiple of the
 *  local glyph size (letter spacing is a fraction of cap height). */
const CLUSTER_GAP_FACTOR = 2.2;
/** …and only when they're the SAME size family — a big word and a small word
 *  can sit adjacent in one colour (a crest's CITY above ST LOUIS), and merging
 *  them would letter the small word at the big word's height. */
const CLUSTER_SIZE_RATIO = 1.9;

/** Glyph-scale candidate PIECES: each connected region of a fill object judged
 *  on its own (a word's letters are separate rings inside one traced object, so
 *  the whole-object bbox spans the word — we must split into regions first). */
function glyphCandidates(objects: EmbObject[]): GlyphPiece[] {
  const out: GlyphPiece[] = [];
  for (const o of objects) {
    if (o.type !== "fill") continue;
    for (const region of splitFillRegions(o.paths)) {
      const b = pathsBounds(region);
      if (!b) continue;
      const w = b.maxX - b.minX;
      const h = b.maxY - b.minY;
      const dim = Math.max(w, h);
      if (dim > GLYPH_MAX_DIM_MM || dim <= 0) continue;
      const area = region.reduce((s, r) => s + Math.abs(polygonArea(r)), 0);
      if (area < GLYPH_MIN_AREA_MM2) continue;
      out.push({ objectId: o.id, colorId: o.colorId, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, dim, area });
    }
  }
  return out;
}

/** Group glyph candidates into runs by spatial proximity (single-link). */
function clusterGlyphs(cands: ReturnType<typeof glyphCandidates>): number[][] {
  const n = cands.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const gap = Math.hypot(cands[i].cx - cands[j].cx, cands[i].cy - cands[j].cy);
      const size = (cands[i].dim + cands[j].dim) / 2;
      const ratio = Math.max(cands[i].dim, cands[j].dim) / Math.max(1e-6, Math.min(cands[i].dim, cands[j].dim));
      if (gap <= size * CLUSTER_GAP_FACTOR && ratio <= CLUSTER_SIZE_RATIO) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(i);
  }
  return [...groups.values()].filter((g) => g.length >= 2); // a word is ≥2 glyphs
}

/** Oriented frame of a glyph group via PCA on the member centres. */
function frameOf(members: number[], cands: ReturnType<typeof glyphCandidates>): Cluster {
  let cx = 0, cy = 0;
  for (const i of members) {
    cx += cands[i].cx;
    cy += cands[i].cy;
  }
  cx /= members.length;
  cy /= members.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const i of members) {
    const dx = cands[i].cx - cx;
    const dy = cands[i].cy - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // Principal axis = the direction the letters march along.
  let angleRad = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // A single-glyph-wide column (all centres nearly coincident) has no reliable
  // axis — fall back to the members' own tallest extent orientation.
  if (Math.abs(sxx - syy) < 1e-6 && Math.abs(sxy) < 1e-6) angleRad = 0;
  // Project every member's footprint (centre ± half its dim) onto the along/
  // cross axes for the run's extents. Cross extent ≈ cap height.
  const ux = Math.cos(angleRad), uy = Math.sin(angleRad);
  let loA = Infinity, hiA = -Infinity, loC = Infinity, hiC = -Infinity;
  const colorArea = new Map<string, number>();
  const objIds = new Set<string>();
  for (const i of members) {
    const r = cands[i].dim / 2;
    for (const [ox, oy] of [[r, r], [-r, r], [r, -r], [-r, -r]] as const) {
      const px = cands[i].cx + ox, py = cands[i].cy + oy;
      const a = (px - cx) * ux + (py - cy) * uy;
      const cc = -(px - cx) * uy + (py - cy) * ux;
      loA = Math.min(loA, a); hiA = Math.max(hiA, a);
      loC = Math.min(loC, cc); hiC = Math.max(hiC, cc);
    }
    colorArea.set(cands[i].colorId, (colorArea.get(cands[i].colorId) ?? 0) + cands[i].area);
    objIds.add(cands[i].objectId);
  }
  let colorId = cands[members[0]].colorId, best = -1;
  for (const [cid, a] of colorArea) {
    if (a > best) {
      best = a;
      colorId = cid;
    }
  }
  return {
    ids: [...objIds],
    cx, cy, angleRad,
    lengthMm: hiA - loA,
    heightMm: hiC - loC,
    colorId,
    order: 0,
  };
}

let clusterSeq = 0;

/** Detect text-like clusters in a traced result: rows of similar-sized compact
 *  glyph shapes. Each is returned with a stable id and an oriented preview quad
 *  so the dialog can highlight it and ask the user what it says. Deterministic
 *  order (top-to-bottom, left-to-right) so ids are stable across a redraw. */
export function detectTextClusters(objects: EmbObject[], minHeightMm = DEFAULT_MIN_HEIGHT_MM): DetectedTextCluster[] {
  const cands = glyphCandidates(objects);
  const groups = clusterGlyphs(cands);
  const raw = groups
    .map((g) => frameOf(g, cands))
    .filter((c) => c.heightMm >= minHeightMm)
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  return raw.map((c, i) => {
    const ca = Math.cos(c.angleRad), sa = Math.sin(c.angleRad);
    const hl = c.lengthMm / 2, hc = c.heightMm / 2;
    // Oriented box corners: centre ± half-length along run ± half-height across.
    const quad: Point[] = ([[hl, hc], [hl, -hc], [-hl, -hc], [-hl, hc]] as const).map(
      ([a, cc]) => ({ x: c.cx + a * ca - cc * sa, y: c.cy + a * sa + cc * ca }),
    );
    return {
      id: `txt-${i}-${clusterSeq++}`,
      angleDeg: (c.angleRad * 180) / Math.PI,
      heightMm: c.heightMm,
      lengthMm: c.lengthMm,
      cx: c.cx,
      cy: c.cy,
      colorId: c.colorId,
      quad,
      removeIds: c.ids,
    };
  });
}

/** Replace each user-named cluster with authored font lettering, rotated to the
 *  cluster's run angle and sized to its cap height. Clusters the user left blank
 *  keep their plain trace. */
export function placeManualText(opts: ManualTextOptions): ManualTextResult {
  const { assignments, clusters, font, fontId } = opts;
  const textObjects: EmbObject[] = [];
  const removeIds: string[] = [];
  let placed = 0;
  for (const cl of clusters) {
    const text = (assignments[cl.id] ?? "").trim();
    if (!text) continue;
    const { object } = layoutText({
      text,
      font,
      fontId,
      heightMm: cl.heightMm,
      colorId: cl.colorId,
      name: text,
    });
    if (object.paths.length === 0) continue;
    const rad = (cl.angleDeg * Math.PI) / 180;
    const ca = Math.cos(rad), sa = Math.sin(rad);
    const rotated = applyMatrix(object.paths, [ca, sa, -sa, ca, 0, 0]);
    const rb = pathsBounds(rotated)!;
    const dx = cl.cx - (rb.minX + rb.maxX) / 2;
    const dy = cl.cy - (rb.minY + rb.maxY) / 2;
    textObjects.push({
      ...object,
      paths: rotated.map((r) => r.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
      satinCenterlines: object.satinCenterlines
        ? applyMatrix(object.satinCenterlines, [ca, sa, -sa, ca, dx, dy])
        : undefined,
    });
    removeIds.push(...cl.removeIds);
    placed++;
  }
  return { textObjects, removeIds, placed };
}

/** Apply the result to a traced object list: drop rough glyphs, append clean
 *  lettering last (sewn on top). */
export function applyManualText(objects: EmbObject[], res: ManualTextResult): EmbObject[] {
  if (res.placed === 0) return objects;
  const drop = new Set(res.removeIds);
  return [...objects.filter((o) => !drop.has(o.id)), ...res.textObjects];
}

export { frameOf as _frameOf, glyphCandidates as _glyphCandidates, clusterGlyphs as _clusterGlyphs };

/**
 * PURE text layout: turn a string + a parsed opentype font into embroidery
 * geometry. Everything is in millimeters and there is no DOM or network here,
 * so the whole module is unit-testable in node.
 *
 * The output is a SINGLE fill EmbObject whose `paths` are rings (outer + holes)
 * in mm, mirroring how the tracer builds fills: the tatami engine clips with an
 * even-odd rule, so a glyph's counter (the hole in a/e/o) is simply another
 * ring inside the same object, and disjoint letters are separate outer rings.
 * Because it is one object, the text scales and moves as a single unit.
 *
 * QUALITY NOTE: v1 text is a tatami FILL (the engine adds underlay + lock
 * stitches automatically). For a crisper edge the user can apply the existing
 * "Add satin outline" control to the resulting fill object afterwards.
 */
import type { EmbObject, GlyphTweak, Path, Point } from "../../types/project";
import { makeObjectFromPaths } from "../objects";
import { pathsBounds, polylineLength } from "../geometry";
import { authoredAlphabet, type AuthoredAlphabet } from "./authored";
// opentype is only used as a type here; parsing happens in fonts.ts. This keeps
// layout pure (it never fetches or reads files — the caller passes the Font).
import type { Font } from "opentype.js";

export interface TextLayoutOptions {
  text: string;
  font: Font;
  /** target cap/letter height in mm (the bbox height of the typed text). */
  heightMm: number;
  /** extra space between letters in mm (may be negative to tighten). */
  letterSpacingMm?: number;
  /** line spacing as a multiple of the letter height (default 1.35). Multiline
   *  text is split on "\n" and each line is centered. */
  lineSpacing?: number;
  /** bend the text along a circular arc: +deg arches up (∩), −deg down (∪),
   *  0 = straight (default). The typed width subtends this sweep angle. */
  archDeg?: number;
  /** lay the line around a circle of this baseline radius (mm) — each glyph is
   *  rigidly rotated onto the circle (no shear), centered at the top or bottom.
   *  Overrides `archDeg`. Top + bottom text on the same radius form a badge. */
  circleRadiusMm?: number;
  /** which side of the circle the text sits on (default "top"). "bottom" keeps
   *  the letters upright and reading left-to-right (tops pointing inward). */
  circleSide?: "top" | "bottom";
  /** lay the text along an arbitrary open polyline (mm). Each glyph is rigidly
   *  rotated to the path's tangent and stands on its left side. Overrides arch &
   *  circle. Centered along the path by default. */
  pathMm?: Point[];
  /** color id for the generated fill object. */
  colorId: string;
  /** optional object name. */
  name?: string;
  /** curve flattening tolerance in mm (default 0.4). */
  flattenToleranceMm?: number;
  /** font id, used to look up the AUTHORED per-glyph satin decomposition for the
   *  flagship face (Oswald). When the font has an authored alphabet, the laid-out
   *  object carries `satinCenterlines` so the engine sews the diagonal-junction
   *  glyphs from clean strokes instead of an auto skeleton. */
  fontId?: string;
  /** Per-glyph manual tweaks keyed by VISIBLE glyph index: reading order across
   *  all lines, counting ONLY glyphs that produce geometry (whitespace is
   *  skipped) — see TextSpec.glyphTweaks. Each tweak is applied in the glyph's
   *  LOCAL frame after normal layout (dx along the local baseline, dy along its
   *  normal; rotate/scale about the glyph's own baseline anchor), in EVERY
   *  baseline mode — straight, multiline, arch, circle, and path. */
  glyphTweaks?: Record<number, GlyphTweak>;
}

/** A single opentype path command (the subset fonts actually emit). */
interface OtCommand {
  type: "M" | "L" | "C" | "Q" | "Z";
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

function quadAt(p0: Point, c: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
  };
}

function cubicAt(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const cc = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + cc * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + cc * c2.y + d * p1.y,
  };
}

/** Rough curve length, used to choose a sensible sample count. */
function controlPolyLength(...pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

/**
 * Convert one glyph's opentype path commands into closed rings (polylines) in
 * the same coordinate space as the commands, densifying curves so no segment is
 * longer than `tol` mm. Each Z (or each M after the first) starts a new ring.
 * The commands are already scaled to mm by the caller.
 */
/** Hard ceiling on curve subdivision. A zero/NaN tolerance makes `len/tol`
 *  diverge to Infinity → the flattening loop never ends and the tab OOMs. Even a
 *  legitimately tiny tolerance can't produce more than this many points per
 *  segment; a real glyph curve at a sane tolerance uses a few dozen. */
const MAX_CURVE_STEPS = 4096;
function stepsFor(len: number, tol: number): number {
  if (!(tol > 0) || !Number.isFinite(len)) return 2;
  return Math.max(2, Math.min(MAX_CURVE_STEPS, Math.ceil(len / tol)));
}

function commandsToRings(commands: OtCommand[], tol: number): Path[] {
  const rings: Path[] = [];
  let ring: Path = [];
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };

  const push = (p: Point) => {
    ring.push(p);
    cur = p;
  };
  const closeRing = () => {
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M": {
        closeRing();
        start = { x: cmd.x!, y: cmd.y! };
        cur = start;
        ring = [start];
        break;
      }
      case "L": {
        push({ x: cmd.x!, y: cmd.y! });
        break;
      }
      case "Q": {
        const c = { x: cmd.x1!, y: cmd.y1! };
        const end = { x: cmd.x!, y: cmd.y! };
        const steps = stepsFor(controlPolyLength(cur, c, end), tol);
        for (let i = 1; i <= steps; i++) push(quadAt(cur, c, end, i / steps));
        break;
      }
      case "C": {
        const c1 = { x: cmd.x1!, y: cmd.y1! };
        const c2 = { x: cmd.x2!, y: cmd.y2! };
        const end = { x: cmd.x!, y: cmd.y! };
        const steps = stepsFor(controlPolyLength(cur, c1, c2, end), tol);
        for (let i = 1; i <= steps; i++) push(cubicAt(cur, c1, c2, end, i / steps));
        break;
      }
      case "Z": {
        closeRing();
        cur = start;
        break;
      }
    }
  }
  closeRing();
  return rings;
}

/** Which rings of `object.paths` belong to one VISIBLE glyph (a contiguous
 *  range — rings are emitted glyph by glyph in reading order). */
export interface GlyphRange {
  ringStart: number;
  ringCount: number;
}

export interface TextLayoutResult {
  /** the single fill object containing all rings, centered on the origin. */
  object: EmbObject;
  /** total advance width of the typed text in mm (after scaling). */
  widthMm: number;
  /** Ring ranges of `object.paths` per VISIBLE glyph (reading order across all
   *  lines, whitespace skipped). The index into this array is exactly the key
   *  used by `glyphTweaks` — it lets a UI hit-test / highlight single letters. */
  glyphs?: GlyphRange[];
}

/**
 * Lay out `text` in `font` at `heightMm` and return ONE fill EmbObject whose
 * rings are centered on the origin (the caller positions it in the hoop).
 *
 * Scaling: a font's em is `unitsPerEm` font units. We scale so that the typed
 * text's actual bounding-box height equals `heightMm` (intuitive "make the
 * letters this tall"). If the text has no geometry (e.g. only spaces) the
 * object has no rings.
 */
/**
 * Glyphs for a string, resilient to fonts whose OpenType shaping features
 * (GSUB/ccmp ligatures) opentype.js can't process — it throws on those. We try
 * the shaped path first; on failure we fall back to per-character base glyphs
 * (no ligatures/contextual forms, which is fine for embroidery lettering), so
 * every valid font is usable rather than crashing the text tool.
 */
function glyphsFor(font: Font, text: string) {
  try {
    return font.stringToGlyphs(text);
  } catch {
    return Array.from(text).map((ch) => font.charToGlyph(ch));
  }
}

/** Bend centered rings along a circular arc: +deg ∩, −deg ∪, 0 = straight. The
 *  radius is derived from `radiusFrom` (the rings, by default) so a parallel set
 *  — authored stroke centerlines — can be bent on the SAME arc. */
function archRings(rings: Path[], archDeg: number, radiusFrom: Path[] = rings): Path[] {
  if (!archDeg || rings.length === 0) return rings;
  const b = pathsBounds(radiusFrom);
  if (!b) return rings;
  const W = b.maxX - b.minX;
  if (W <= 0) return rings;
  const R = W / (archDeg * (Math.PI / 180)); // signed radius (sweep = archDeg)
  return rings.map((ring) =>
    ring.map((p) => {
      const phi = p.x / R;
      const r = R - p.y; // y down: lower points sit nearer the (upper) center
      return { x: r * Math.sin(phi), y: R - r * Math.cos(phi) };
    }),
  );
}

/** One glyph laid flat (font units, baseline y=0): its rings, any authored
 *  centerlines, and its advance-center x. */
interface FlatGlyph {
  rings: Path[];
  strokes: Path[];
  cx: number;
}

/** Lay a string flat, per glyph, in font units. */
function glyphsFlat(
  font: Font,
  text: string,
  emSize: number,
  spacingUnits: number,
  flattenTol: number,
  authored: AuthoredAlphabet | null,
): { glyphs: FlatGlyph[]; width: number } {
  const items = authored
    ? Array.from(text).map((ch) => ({ ch, glyph: font.charToGlyph(ch) }))
    : glyphsFor(font, text).map((glyph) => ({ ch: undefined as string | undefined, glyph }));
  const glyphs: FlatGlyph[] = [];
  let penX = 0;
  for (const { ch, glyph } of items) {
    const path = glyph.getPath(penX, 0, emSize) as { commands: OtCommand[] };
    const rings = commandsToRings(path.commands, flattenTol);
    const adv = glyph.advanceWidth ?? 0;
    const strokes: Path[] = [];
    const spec = authored && ch ? authored[ch] : undefined;
    if (spec && rings.length) {
      const b = pathsBounds(rings);
      if (b) {
        const w = b.maxX - b.minX;
        const h = b.maxY - b.minY;
        for (const st of spec) strokes.push(st.map(([nx, ny]) => ({ x: b.minX + nx * w, y: b.minY + ny * h })));
      }
    }
    glyphs.push({ rings, strokes, cx: penX + adv / 2 });
    penX += adv + spacingUnits;
  }
  return { glyphs, width: penX };
}

interface CircularOpts {
  font: Font;
  emSize: number;
  spacingUnits: number;
  flattenTol: number;
  authored: AuthoredAlphabet | null;
  heightMm: number;
  provScale: number;
  radius: number;
  side: "top" | "bottom";
  colorId: string;
  name?: string;
  tweaks?: Record<number, GlyphTweak>;
}

/**
 * Lay one line around a circle of baseline radius R (mm). Each glyph is RIGIDLY
 * rotated onto the circle (no shear — embroidery letters shouldn't distort) and
 * the string is centered at the top (12 o'clock) or bottom (6 o'clock). Bottom
 * text stays upright and reads left-to-right (tops pointing inward), the way a
 * badge's lower legend sits. The circle is centered on the origin so a top line
 * and a bottom line at the same radius line up into one badge.
 */
function layoutCircular(text: string, o: CircularOpts): TextLayoutResult {
  const { glyphs, width } = glyphsFlat(o.font, text, o.emSize, o.spacingUnits, o.flattenTol, o.authored);
  const allRings = glyphs.flatMap((g) => g.rings);
  const bb = pathsBounds(allRings);
  if (!bb) {
    return { object: makeObjectFromPaths("fill", [], o.colorId, o.name ?? "Text"), widthMm: 0 };
  }
  const scale = bb.maxY - bb.minY > 0 ? o.heightMm / (bb.maxY - bb.minY) : o.provScale;
  const R = o.radius;
  const Wmm = width * scale;
  const bottom = o.side === "bottom";

  // When the typed run is longer than the circle can hold, its angular sweep
  // (Wmm/R) exceeds a full turn and glyphs wrap back onto the same polar sector,
  // physically overlapping. Compress the angular POSITIONS (not the glyph sizes —
  // letters stay rigid) into an available arc just under 2π so they pack tightly
  // instead of piling up. A run that already fits (the common case) is untouched:
  // k = 1, so its layout is byte-for-byte identical.
  const MAX_SWEEP = 2 * Math.PI * 0.92; // leave an 8% seam gap so ends don't touch
  const sweep = R > 0 ? Wmm / R : 0;
  const k = sweep > MAX_SWEEP ? MAX_SWEEP / sweep : 1;

  const rings: Path[] = [];
  const strokes: Path[] = [];
  const ranges: GlyphRange[] = [];
  let vis = 0; // VISIBLE glyph counter (whitespace renders nothing → skipped)
  for (const g of glyphs) {
    const visible = g.rings.length > 0;
    const tw = visible ? normTweak(o.tweaks?.[vis]) : null;
    const cxmm = g.cx * scale;
    const theta = (k * (cxmm - Wmm / 2)) / R; // arc-length → angle; centered at top/bottom
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const place = (p: Point): Point => {
      let lx = p.x * scale - cxmm; // offset within the glyph (mm)
      let ly = p.y * scale; // y-down: letter body is negative (above baseline)
      if (tw) {
        // LOCAL frame tweak: dx slides along the circular baseline, dy along
        // the radius; rotate/scale about the glyph's baseline anchor (0,0).
        const q = tweakLocal(lx, ly, tw);
        lx = q.x;
        ly = q.y;
      }
      return bottom
        ? { x: R * s + lx * c + ly * s, y: R * c - lx * s + ly * c }
        : { x: R * s + lx * c - ly * s, y: -R * c + lx * s + ly * c };
    };
    if (visible) ranges.push({ ringStart: rings.length, ringCount: g.rings.length });
    for (const r of g.rings) rings.push(r.map(place));
    for (const st of g.strokes) strokes.push(st.map(place));
    if (visible) vis++;
  }

  const object = makeObjectFromPaths("fill", rings, o.colorId, o.name ?? "Text");
  object.params = { ...object.params, fillStyle: "satin" };
  if (strokes.length) object.satinCenterlines = strokes;
  return { object, widthMm: Wmm, glyphs: ranges };
}

/** Densify a polyline so no segment exceeds `step` mm — gives smooth tangents. */
function densify(path: Point[], step: number): Point[] {
  const out: Point[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** Point + unit tangent at arc-length `s` along a polyline (cumulative `cum`). */
function sampleAt(path: Point[], cum: number[], s: number): { p: Point; t: Point } {
  const total = cum[cum.length - 1];
  const ss = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < ss) i++;
  const segLen = cum[i] - cum[i - 1] || 1e-9;
  const u = (ss - cum[i - 1]) / segLen;
  const a = path[i - 1];
  const b = path[i];
  return {
    p: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u },
    t: { x: (b.x - a.x) / segLen, y: (b.y - a.y) / segLen },
  };
}

interface PathLayoutOpts {
  font: Font;
  emSize: number;
  spacingUnits: number;
  flattenTol: number;
  authored: AuthoredAlphabet | null;
  heightMm: number;
  provScale: number;
  colorId: string;
  name?: string;
  tweaks?: Record<number, GlyphTweak>;
}

/**
 * Lay one line along an arbitrary open polyline (mm). Each glyph is RIGIDLY
 * rotated to the path's tangent at its position and stands on the path's left
 * side (tops away from the path) — no shear. The text is centered along the path.
 * Authored satin centerlines ride the same per-glyph transform.
 */
function layoutOnPath(text: string, rawPath: Point[], o: PathLayoutOpts): TextLayoutResult {
  const { glyphs, width } = glyphsFlat(o.font, text, o.emSize, o.spacingUnits, o.flattenTol, o.authored);
  const allRings = glyphs.flatMap((g) => g.rings);
  const bb = pathsBounds(allRings);
  if (!bb) return { object: makeObjectFromPaths("fill", [], o.colorId, o.name ?? "Text"), widthMm: 0 };
  const scale = bb.maxY - bb.minY > 0 ? o.heightMm / (bb.maxY - bb.minY) : o.provScale;

  const path = densify(rawPath, 0.5);
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = cum[cum.length - 1];
  const Wmm = width * scale;
  const startS = Math.max(0, (total - Wmm) / 2); // center the run along the path

  const rings: Path[] = [];
  const strokes: Path[] = [];
  const ranges: GlyphRange[] = [];
  let vis = 0; // VISIBLE glyph counter (whitespace renders nothing → skipped)
  for (const g of glyphs) {
    const visible = g.rings.length > 0;
    const tw = visible ? normTweak(o.tweaks?.[vis]) : null;
    const cxmm = g.cx * scale;
    const { p, t } = sampleAt(path, cum, startS + cxmm);
    const place = (q: Point): Point => {
      let lx = q.x * scale - cxmm; // along the path
      let ly = q.y * scale; // y-down: letter body negative (stands on the left side)
      if (tw) {
        // LOCAL frame tweak: dx slides along the path's tangent, dy along its
        // normal; rotate/scale about the glyph's baseline anchor (0,0).
        const w = tweakLocal(lx, ly, tw);
        lx = w.x;
        ly = w.y;
      }
      return { x: p.x + lx * t.x - ly * t.y, y: p.y + lx * t.y + ly * t.x };
    };
    if (visible) ranges.push({ ringStart: rings.length, ringCount: g.rings.length });
    for (const r of g.rings) rings.push(r.map(place));
    for (const st of g.strokes) strokes.push(st.map(place));
    if (visible) vis++;
  }

  const object = makeObjectFromPaths("fill", rings, o.colorId, o.name ?? "Text");
  object.params = { ...object.params, fillStyle: "satin" };
  if (strokes.length) object.satinCenterlines = strokes;
  return { object, widthMm: Wmm, glyphs: ranges };
}

/** Finite value or the fallback (guards NaN/Infinity from a corrupt file or a
 *  half-typed UI field before it cascades into every coordinate). */
const finiteOr = (v: number | undefined, def: number): number =>
  v !== undefined && Number.isFinite(v) ? v : def;

/** A sanitized glyph tweak ready to apply (rotation precomputed as cos/sin).
 *  Junk components (NaN, non-positive scale — from a hand-edited or corrupt
 *  file) coerce to their identity value, and a fully-identity tweak returns
 *  null so untweaked layout stays on the exact untouched code path. */
interface NormTweak {
  dx: number;
  dy: number;
  s: number;
  c: number;
  sn: number;
}

function normTweak(t: GlyphTweak | undefined): NormTweak | null {
  if (!t) return null;
  const dx = finiteOr(t.dx, 0);
  const dy = finiteOr(t.dy, 0);
  const rot = finiteOr(t.rotDeg, 0);
  let s = finiteOr(t.scale, 1);
  if (!(s > 0)) s = 1;
  s = Math.max(0.1, Math.min(10, s));
  if (dx === 0 && dy === 0 && rot === 0 && s === 1) return null;
  const r = (rot * Math.PI) / 180;
  return { dx, dy, s, c: Math.cos(r), sn: Math.sin(r) };
}

/** Apply a tweak to a point in the glyph's LOCAL frame (anchor at the origin,
 *  x along the baseline, y down toward the descender side): scale + rotate
 *  about the anchor, then nudge. Every baseline mode places the result with
 *  its own rigid transform, so dx rides ALONG an arched/circular/path baseline
 *  and dy along the local normal — never global x/y. */
function tweakLocal(lx: number, ly: number, t: NormTweak): Point {
  return {
    x: t.s * (t.c * lx - t.sn * ly) + t.dx,
    y: t.s * (t.sn * lx + t.c * ly) + t.dy,
  };
}

/** True when the record holds at least one effective (non-identity) tweak. */
function hasTweaks(tw: Record<number, GlyphTweak> | undefined): boolean {
  return !!tw && Object.values(tw).some((t) => normTweak(t) !== null);
}

export function layoutText(opts: TextLayoutOptions): TextLayoutResult {
  const {
    text,
    font,
    colorId,
    name,
    fontId,
  } = opts;

  // SANITIZE numeric inputs. These are user-editable and stored verbatim, so a
  // NaN height or a zero flatten tolerance reaches here from a corrupt file or a
  // mid-edit field. A non-finite height divides every coordinate to NaN; a zero
  // tolerance makes curve flattening subdivide without bound (OOM). Coerce each
  // to a sane finite value BEFORE any geometry is derived from it.
  const heightMm = Math.max(0.5, finiteOr(opts.heightMm, 10)); // positive, real
  const letterSpacingMm = finiteOr(opts.letterSpacingMm, 0);
  const lineSpacing = Math.max(0.1, finiteOr(opts.lineSpacing, 1.35));
  // Clamp the arch sweep below a full turn: an arch past ~360° wraps the strip
  // back onto itself so the glyphs overlap, and is never a real design intent.
  const archDeg = Math.max(-350, Math.min(350, finiteOr(opts.archDeg, 0)));
  const flattenToleranceMm = Math.max(0.05, Math.min(5, finiteOr(opts.flattenToleranceMm, 0.4)));

  const authored = authoredAlphabet(fontId);
  const unitsPerEm = font.unitsPerEm || 1000;
  const emSize = unitsPerEm;
  const provScale = heightMm / unitsPerEm;
  const spacingUnits = provScale > 0 ? letterSpacingMm / provScale : 0;
  const flattenTol = flattenToleranceMm / provScale;

  // Path baseline: rigid per-glyph placement along an arbitrary polyline. Drop
  // any non-finite point first so a stray NaN vertex can't poison the tangents,
  // then require a REAL extent — a path whose points are all (near-)coincident
  // has zero length, which collapses every glyph onto one point (0 stitches,
  // silently). Such a path can't carry text, so fall through to straight layout.
  const cleanPath = opts.pathMm?.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const pathLen = cleanPath ? polylineLength(cleanPath) : 0;
  if (cleanPath && cleanPath.length >= 2 && pathLen > 0.1) {
    return layoutOnPath(text.replace(/\n/g, " "), cleanPath, {
      font, emSize, spacingUnits, flattenTol, authored, heightMm, provScale, colorId, name,
      tweaks: opts.glyphTweaks,
    });
  }

  // Circular baseline: rigid per-glyph placement on a circle (no shear), centered
  // at top or bottom. Overrides arch/multiline.
  if (opts.circleRadiusMm && opts.circleRadiusMm > 0) {
    return layoutCircular(text.replace(/\n/g, " "), {
      font, emSize, spacingUnits, flattenTol, authored, heightMm, provScale,
      radius: opts.circleRadiusMm, side: opts.circleSide ?? "top", colorId, name,
      tweaks: opts.glyphTweaks,
    });
  }

  // One row per line; each centered on x=0 and stacked downward. Laid PER GLYPH
  // so per-glyph tweaks can act in each glyph's own local frame.
  const lines = text.split("\n");
  const laid = lines.map((ln) => glyphsFlat(font, ln, emSize, spacingUnits, flattenTol, authored));
  const lineHeightUnits = unitsPerEm * lineSpacing;

  // Authored satin centerlines ride through the SAME transforms as the rings so
  // they stay glued to their glyphs (per-line offset → global scale → arch).
  // `placedGlyphs` tracks, per VISIBLE glyph (whitespace renders nothing and is
  // skipped — reading order across lines), its contiguous ring/stroke ranges and
  // its baseline anchor (advance-center) in the raw font-unit space.
  const rawRings: Path[] = [];
  const rawStrokes: Path[] = [];
  const placedGlyphs: {
    ringStart: number;
    ringCount: number;
    strokeStart: number;
    strokeCount: number;
    anchor: Point;
  }[] = [];
  laid.forEach(({ glyphs, width }, i) => {
    const dx = -width / 2; // center each line horizontally
    const dy = i * lineHeightUnits;
    const place = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
    for (const g of glyphs) {
      if (g.rings.length) {
        placedGlyphs.push({
          ringStart: rawRings.length,
          ringCount: g.rings.length,
          strokeStart: rawStrokes.length,
          strokeCount: g.strokes.length,
          anchor: { x: g.cx + dx, y: dy },
        });
      }
      for (const ring of g.rings) rawRings.push(ring.map(place));
      for (const s of g.strokes) rawStrokes.push(s.map(place));
    }
  });

  const totalWidth = Math.max(...laid.map((l) => l.width), 0);
  if (rawRings.length === 0) {
    return {
      object: makeObjectFromPaths("fill", [], colorId, name ?? "Text"),
      widthMm: totalWidth * provScale,
      glyphs: [],
    };
  }

  // Height reference = a single line's height (so multiline keeps letter size),
  // taken from the first line that has geometry.
  const refLine = laid.find((l) => l.glyphs.some((g) => g.rings.length > 0));
  const refBounds = refLine ? pathsBounds(refLine.glyphs.flatMap((g) => g.rings)) : null;
  const refHeight = refBounds ? refBounds.maxY - refBounds.minY : 0;
  const bounds = pathsBounds(rawRings)!;
  const scale = refHeight > 0 ? heightMm / refHeight : provScale;

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const center = (p: Point) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale });
  const scaled: Path[] = rawRings.map((ring) => ring.map(center));
  const scaledStrokes: Path[] = rawStrokes.map((s) => s.map(center));

  // PER-GLYPH TWEAKS (mm, local frame), applied to the centered mm geometry
  // BEFORE the arch bend: pre-arch x becomes arc length and y becomes the
  // radial offset, so a dx nudge slides ALONG the arched baseline and a dy
  // nudge along its local normal. Scale/centering above and the arch radius /
  // recenter below are all derived from the UNTWEAKED rings, so every
  // untouched glyph comes out byte-identical.
  const anyTweaks = hasTweaks(opts.glyphTweaks);
  let tweakedRings = scaled;
  let tweakedStrokes = scaledStrokes;
  if (anyTweaks) {
    tweakedRings = scaled.slice();
    tweakedStrokes = scaledStrokes.slice();
    placedGlyphs.forEach((g, vi) => {
      const tw = normTweak(opts.glyphTweaks?.[vi]);
      if (!tw) return;
      const a = center(g.anchor); // glyph anchor in the same centered mm space
      const apply = (p: Point): Point => {
        const q = tweakLocal(p.x - a.x, p.y - a.y, tw);
        return { x: a.x + q.x, y: a.y + q.y };
      };
      for (let r = g.ringStart; r < g.ringStart + g.ringCount; r++)
        tweakedRings[r] = tweakedRings[r].map(apply);
      for (let s = g.strokeStart; s < g.strokeStart + g.strokeCount; s++)
        tweakedStrokes[s] = tweakedStrokes[s].map(apply);
    });
  }

  // Bend rings AND strokes along the SAME arc (one radius from the UNTWEAKED
  // rings' width), then re-center both by the UNTWEAKED arched box so the
  // object sits on the origin and a tweak moves only its own glyph.
  let rings = archRings(tweakedRings, archDeg, scaled);
  let strokes = archRings(tweakedStrokes, archDeg, scaled);
  if (archDeg) {
    const ab = pathsBounds(anyTweaks ? archRings(scaled, archDeg, scaled) : rings);
    if (ab) {
      const acx = (ab.minX + ab.maxX) / 2;
      const acy = (ab.minY + ab.maxY) / 2;
      const recenter = (r: Path) => r.map((p) => ({ x: p.x - acx, y: p.y - acy }));
      rings = rings.map(recenter);
      strokes = strokes.map(recenter);
    }
  }

  const object = makeObjectFromPaths("fill", rings, colorId, name ?? "Text");
  // Lettering asks for satin: the engine lays a satin column down each stroke's
  // medial axis (shiny, follows curves) wherever it covers the glyph cleanly,
  // and automatically falls back to a solid tatami fill on shapes whose skeleton
  // is poor — so text is never broken, just as crisp as the letter allows.
  object.params = { ...object.params, fillStyle: "satin" };
  // Authored glyphs (flagship font): hand-decomposed satin column centerlines, in
  // the same object space as `paths`. The engine prefers these over auto-skeleton.
  if (strokes.length) object.satinCenterlines = strokes;
  return {
    object,
    widthMm: totalWidth * scale,
    glyphs: placedGlyphs.map(({ ringStart, ringCount }) => ({ ringStart, ringCount })),
  };
}

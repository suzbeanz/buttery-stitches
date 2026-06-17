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
import type { EmbObject, Path, Point } from "../../types/project";
import { makeObjectFromPaths } from "../objects";
import { pathsBounds } from "../geometry";
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
  /** color id for the generated fill object. */
  colorId: string;
  /** optional object name. */
  name?: string;
  /** curve flattening tolerance in mm (default 0.4). */
  flattenToleranceMm?: number;
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
        const steps = Math.max(2, Math.ceil(controlPolyLength(cur, c, end) / tol));
        for (let i = 1; i <= steps; i++) push(quadAt(cur, c, end, i / steps));
        break;
      }
      case "C": {
        const c1 = { x: cmd.x1!, y: cmd.y1! };
        const c2 = { x: cmd.x2!, y: cmd.y2! };
        const end = { x: cmd.x!, y: cmd.y! };
        const steps = Math.max(
          2,
          Math.ceil(controlPolyLength(cur, c1, c2, end) / tol),
        );
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

export interface TextLayoutResult {
  /** the single fill object containing all rings, centered on the origin. */
  object: EmbObject;
  /** total advance width of the typed text in mm (after scaling). */
  widthMm: number;
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

/** Lay one line of glyphs flat (font units, pen from x=0). Returns its rings and
 *  total advance width. */
function lineRings(
  font: Font,
  text: string,
  emSize: number,
  spacingUnits: number,
  flattenTol: number,
): { rings: Path[]; width: number } {
  const rings: Path[] = [];
  let penX = 0;
  for (const glyph of glyphsFor(font, text)) {
    const path = glyph.getPath(penX, 0, emSize) as { commands: OtCommand[] };
    rings.push(...commandsToRings(path.commands, flattenTol));
    penX += (glyph.advanceWidth ?? 0) + spacingUnits;
  }
  return { rings, width: penX };
}

/** Bend centered rings along a circular arc: +deg ∩, −deg ∪, 0 = straight. */
function archRings(rings: Path[], archDeg: number): Path[] {
  if (!archDeg) return rings;
  const b = pathsBounds(rings);
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

export function layoutText(opts: TextLayoutOptions): TextLayoutResult {
  const {
    text,
    font,
    heightMm,
    letterSpacingMm = 0,
    lineSpacing = 1.35,
    archDeg = 0,
    colorId,
    name,
    flattenToleranceMm = 0.4,
  } = opts;

  const unitsPerEm = font.unitsPerEm || 1000;
  const emSize = unitsPerEm;
  const provScale = heightMm / unitsPerEm;
  const spacingUnits = provScale > 0 ? letterSpacingMm / provScale : 0;
  const flattenTol = flattenToleranceMm / provScale;

  // One row per line; each centered on x=0 and stacked downward.
  const lines = text.split("\n");
  const laid = lines.map((ln) => lineRings(font, ln, emSize, spacingUnits, flattenTol));
  const lineHeightUnits = unitsPerEm * lineSpacing;

  const rawRings: Path[] = [];
  laid.forEach(({ rings, width }, i) => {
    const dx = -width / 2; // center each line horizontally
    const dy = i * lineHeightUnits;
    for (const ring of rings) rawRings.push(ring.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  });

  const totalWidth = Math.max(...laid.map((l) => l.width), 0);
  if (rawRings.length === 0) {
    return {
      object: makeObjectFromPaths("fill", [], colorId, name ?? "Text"),
      widthMm: totalWidth * provScale,
    };
  }

  // Height reference = a single line's height (so multiline keeps letter size),
  // taken from the first line that has geometry.
  const refLine = laid.find((l) => l.rings.length > 0);
  const refBounds = refLine ? pathsBounds(refLine.rings) : null;
  const refHeight = refBounds ? refBounds.maxY - refBounds.minY : 0;
  const bounds = pathsBounds(rawRings)!;
  const scale = refHeight > 0 ? heightMm / refHeight : provScale;

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const scaled: Path[] = rawRings.map((ring) =>
    ring.map((p) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale })),
  );

  // Bend along an arc, then re-center so the object sits on the origin.
  let rings = archRings(scaled, archDeg);
  if (archDeg) {
    const ab = pathsBounds(rings);
    if (ab) {
      const acx = (ab.minX + ab.maxX) / 2;
      const acy = (ab.minY + ab.maxY) / 2;
      rings = rings.map((r) => r.map((p) => ({ x: p.x - acx, y: p.y - acy })));
    }
  }

  const object = makeObjectFromPaths("fill", rings, colorId, name ?? "Text");
  // Lettering asks for satin: the engine lays a satin column down each stroke's
  // medial axis (shiny, follows curves) wherever it covers the glyph cleanly,
  // and automatically falls back to a solid tatami fill on shapes whose skeleton
  // is poor — so text is never broken, just as crisp as the letter allows.
  object.params = { ...object.params, fillStyle: "satin" };
  return { object, widthMm: totalWidth * scale };
}

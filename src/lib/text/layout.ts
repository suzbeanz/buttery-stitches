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
export function layoutText(opts: TextLayoutOptions): TextLayoutResult {
  const {
    text,
    font,
    heightMm,
    letterSpacingMm = 0,
    colorId,
    name,
    flattenToleranceMm = 0.4,
  } = opts;

  const unitsPerEm = font.unitsPerEm || 1000;
  // First lay out in EM units (font units), then scale to mm. We pick the em
  // size so the curve-flattening tolerance lands near `flattenToleranceMm`
  // after scaling; the actual height scale is recomputed from the real bbox.
  const emSize = unitsPerEm; // 1 em == unitsPerEm font units == "1 unit" here

  const rawRings: Path[] = [];
  let penX = 0;
  // letterSpacing is given in mm; convert to font units using a provisional
  // scale of heightMm per em — refined below. We instead add spacing in font
  // units proportional to em so it scales with the final size: treat
  // letterSpacingMm as mm-at-final-size and back it out after scaling. To keep
  // the layout pure and single-pass we accumulate advances in font units and
  // add the spacing in font units using the *ascender-based* provisional scale.
  const glyphs = font.stringToGlyphs(text);

  // Provisional scale from ascender so spacing in mm is meaningful pre-bbox.
  // Final scale (from bbox) is applied to everything uniformly afterwards, so
  // spacing stays proportional and "increasing spacing increases width".
  const provScale = heightMm / unitsPerEm;
  const spacingUnits = provScale > 0 ? letterSpacingMm / provScale : 0;

  for (const glyph of glyphs) {
    const path = glyph.getPath(penX, 0, emSize) as { commands: OtCommand[] };
    // opentype's y axis points up; embroidery/canvas y points down. getPath
    // already flips y for screen coordinates, so rings come out upright.
    const rings = commandsToRings(path.commands, flattenToleranceMm / provScale);
    rawRings.push(...rings);
    penX += (glyph.advanceWidth ?? 0) + spacingUnits;
  }

  if (rawRings.length === 0) {
    return {
      object: makeObjectFromPaths("fill", [], colorId, name ?? "Text"),
      widthMm: penX * provScale,
    };
  }

  // Scale uniformly so the real bbox height equals heightMm, then center on 0.
  const bounds = pathsBounds(rawRings);
  if (!bounds) {
    return {
      object: makeObjectFromPaths("fill", [], colorId, name ?? "Text"),
      widthMm: penX * provScale,
    };
  }
  const rawHeight = bounds.maxY - bounds.minY;
  const scale = rawHeight > 0 ? heightMm / rawHeight : provScale;

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  const rings: Path[] = rawRings.map((ring) =>
    ring.map((p) => ({
      x: (p.x - cx) * scale,
      y: (p.y - cy) * scale,
    })),
  );

  const object = makeObjectFromPaths("fill", rings, colorId, name ?? "Text");
  // Lettering stitches as a clean tatami fill by default — reliable and solid for
  // every font. (Auto-satin that follows each stroke is still being perfected;
  // forcing it produced broken stitches on real letters.)
  return { object, widthMm: penX * scale };
}

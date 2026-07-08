/**
 * GUIDED SATIN — precise lettering that KEEPS the original letterforms.
 *
 * The text-retype assist re-sets text in our font: crisp, but it swaps the
 * artwork's typeface for ours. When the user wants the ORIGINAL letterforms
 * kept (a brand crest's custom type), we instead do what a professional
 * digitizer does by hand: keep the traced letter's exact outline, and lay clean
 * satin columns down its strokes. The hard part a raster skeleton fails at on
 * tiny text is the stroke TOPOLOGY (how many strokes, where they run). We borrow
 * that topology from the typed character's shape in a reference font, then snap
 * it onto the TRACED outline — so the font supplies structure, the artwork
 * supplies the exact form.
 *
 * This module is the pure core: given a traced letter's rings, the character it
 * represents, and a reference font, it returns seed stroke centerlines placed in
 * the letter's box. The engine's columnsFromCenterlines/snapToMedial (via an
 * object's satinCenterlines) refines them onto the real outline at sew time.
 */
import type { Font } from "opentype.js";
import type { EmbObject, Path } from "../../types/project";
import { pathsBounds } from "../geometry";
import { skeletonBranches } from "../engine/medial";
import { layoutText } from "../text/layout";

/** Seed stroke centerlines for one character, derived from the reference font's
 *  glyph skeleton, normalised to the glyph ink bbox (x,y in 0..1). Cached per
 *  (font, char) since the skeleton is deterministic and mildly expensive. */
const seedCache = new Map<string, [number, number][][]>();

export function characterSeeds(char: string, font: Font, fontId?: string): [number, number][][] {
  const key = `${fontId ?? "?"}:${char}`;
  const hit = seedCache.get(key);
  if (hit) return hit;
  let seeds: [number, number][][] = [];
  try {
    // Lay the single glyph out at a comfortable size, get its clean font-outline
    // rings, skeletonise them, and normalise the branch centerlines to 0..1.
    const { object } = layoutText({ text: char, font, fontId, heightMm: 20, colorId: "seed" });
    const rings = object.paths;
    const b = pathsBounds(rings);
    if (b && rings.length) {
      const w = b.maxX - b.minX || 1;
      const h = b.maxY - b.minY || 1;
      const branches = skeletonBranches(rings, { cellMm: 0.3 });
      seeds = branches
        .filter((br) => br.length >= 2)
        .map((br) => br.map((p) => [(p.x - b.minX) / w, (p.y - b.minY) / h] as [number, number]));
    }
  } catch {
    seeds = [];
  }
  seedCache.set(key, seeds);
  return seeds;
}

/** Map normalised seed strokes (0..1 glyph space) into a traced letter's ORIENTED
 *  box, so they run down the letter at its position, size and angle. */
function placeSeeds(
  seeds: [number, number][][],
  box: { cx: number; cy: number; halfLen: number; halfHeight: number; angleRad: number },
): Path[] {
  const ca = Math.cos(box.angleRad), sa = Math.sin(box.angleRad);
  // Local axes: u = along the run (glyph x), v = across (glyph y). The glyph's
  // width maps to 2·halfLen along u, height to 2·halfHeight along v.
  return seeds.map((stroke) =>
    stroke.map(([nx, ny]) => {
      const u = (nx - 0.5) * 2 * box.halfLen;
      const v = (ny - 0.5) * 2 * box.halfHeight;
      return { x: box.cx + u * ca - v * sa, y: box.cy + u * sa + v * ca };
    }),
  );
}

/** A traced letter to guide: its exact rings and the box it occupies. */
export interface GuidedLetter {
  char: string;
  rings: Path[];
  cx: number;
  cy: number;
  halfLen: number;
  halfHeight: number;
  angleRad: number;
  colorId: string;
}

/**
 * Build ONE satin fill object per guided letter: the TRACED rings (exact
 * letterform) plus seed satinCenterlines from the character's font topology.
 * The engine snaps the seeds onto the traced outline and lays clean columns.
 * Returns [] for a letter whose font skeleton yielded nothing (caller keeps the
 * plain trace there).
 */
export function guidedLetterObjects(letters: GuidedLetter[], font: Font, fontId: string, makeObject: (rings: Path[], colorId: string, name: string) => EmbObject): EmbObject[] {
  const out: EmbObject[] = [];
  for (const L of letters) {
    if (L.rings.length === 0) continue;
    const seeds = characterSeeds(L.char, font, fontId);
    const centerlines = seeds.length
      ? placeSeeds(seeds, L)
      : [];
    const obj = makeObject(L.rings, L.colorId, L.char);
    obj.type = "fill";
    obj.params = { ...obj.params, fillStyle: "satin", lineArt: true, underlay: obj.params.underlay };
    if (centerlines.length) obj.satinCenterlines = centerlines;
    out.push(obj);
  }
  return out;
}

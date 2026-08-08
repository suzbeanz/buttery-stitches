/**
 * RE-SET AS TEXT: replace traced lettering with authored type fitted to the
 * traced letters' exact footprint. Pixel-traced letterforms come out eroded
 * and ragged, and no stitch engine can make bad geometry look good — the
 * professional fix is to throw the traced outlines away and set the words in
 * a real font, matched to position, size, orientation and weight. Proven by
 * hand on the STL crest (the corpus carries both versions); this module is
 * that operation as a first-class primitive.
 */
import type { Font } from "opentype.js";
import type { EmbObject, EmbObjectParams, Path } from "../../types/project";
import { layoutText } from "./layout";
import { pathsBounds, offsetPolyline } from "../geometry";

export interface RetypeBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RetypeOptions {
  text: string;
  font: Font;
  /** Union bbox of the traced objects being replaced (mm). */
  box: RetypeBox;
  /** Vertical strip (letters rotated 90° cw, reading top→bottom). */
  vertical: boolean;
  letterSpacingMm?: number;
  /** Outward ring offset (mm): raises stroke width without changing the
   *  letterform, so small text crosses the satin threshold instead of mixing
   *  thin beans with stray ladders. */
  emboldenMm?: number;
  colorId: string;
  /** Params carried over from the first replaced object (density, underlay). */
  baseParams?: EmbObjectParams;
}

/** Suggest orientation from the box: a strip clearly taller than wide holds
 *  vertical text. */
export function suggestVertical(box: RetypeBox): boolean {
  return box.y1 - box.y0 > (box.x1 - box.x0) * 1.5;
}

/** Suggest embolden: small caps need the nudge past the satin threshold. */
export function suggestEmboldenMm(box: RetypeBox, vertical: boolean): number {
  const capMm = vertical ? box.x1 - box.x0 : box.y1 - box.y0;
  return capMm < 6 ? 0.12 : 0;
}

/**
 * Set `text` into `box`: cap height fills across the box, the run is
 * stretched along the reading direction to fill its length (how extended
 * crest faces are matched from a normal-width font), centered both ways.
 */
export function retypeToBox(opts: RetypeOptions): EmbObject {
  const { text, font, box, vertical, colorId } = opts;
  const capMm = Math.max(1, vertical ? box.x1 - box.x0 : box.y1 - box.y0);
  const { object } = layoutText({
    text,
    font,
    heightMm: capMm,
    letterSpacingMm: opts.letterSpacingMm ?? 0,
    colorId,
    name: text,
  });
  let paths: Path[] = object.paths;
  if (opts.emboldenMm && opts.emboldenMm > 0) {
    // Negative distance = outward for font winding (outers grow, counters
    // shrink together) — validated on the crest's small lettering.
    paths = paths.map((r) => offsetPolyline(r, -opts.emboldenMm!, true));
  }
  const b0 = pathsBounds(paths);
  if (!b0) return { ...object, paths: [], colorId };
  // Stretch along the reading direction to fill the box length.
  const targetLen = vertical ? box.y1 - box.y0 : box.x1 - box.x0;
  const len0 = Math.max(0.001, b0.maxX - b0.minX);
  const sx = targetLen / len0;
  paths = paths.map((r) => r.map((p) => ({ x: (p.x - b0.minX) * sx, y: p.y - b0.minY })));
  if (vertical) {
    // Rotate 90° clockwise: reading top→bottom, letter tops facing right.
    paths = paths.map((r) => r.map((p) => ({ x: -p.y, y: p.x })));
  }
  const b1 = pathsBounds(paths)!;
  const dx = (box.x0 + box.x1) / 2 - (b1.minX + b1.maxX) / 2;
  const dy = (box.y0 + box.y1) / 2 - (b1.minY + b1.maxY) / 2;
  paths = paths.map((r) => r.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  return {
    ...object,
    paths,
    colorId,
    params: {
      density: opts.baseParams?.density ?? 0.32,
      underlay: opts.baseParams?.underlay ?? true,
      fillStyle: "satin",
    },
  };
}

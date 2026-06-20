/**
 * Stage 2 of the lettering pipeline: turn OCR word boxes into clean satin FONT
 * lettering, replacing the rough auto-traced glyphs. Auto-tracing a rasterized
 * word can only follow its jagged pixel boundary (frayed columns, messy junctions);
 * a real letterform from our font system sews crisp instead. This module is the
 * PURE core — given recognized words (string + pixel box + confidence) and the
 * traced result, it lays each word out with `layoutText`, positions it over the
 * traced text, colors it from the traced ink, and reports which traced objects to
 * drop. The OCR engine itself (tesseract.js) is a thin async wrapper elsewhere, so
 * all the placement/replacement logic stays headless-testable.
 */
import type { Font } from "opentype.js";
import type { EmbObject, Path, ThreadColor } from "../../types/project";
import { layoutText } from "../text/layout";
import { pathsBounds, translatePaths } from "../geometry";

/** One recognized word from OCR. `bbox` is in SOURCE-IMAGE pixels; `confidence`
 *  is 0–100 (tesseract's scale). */
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface TextRecognizeOptions {
  words: OcrWord[];
  /** mm per source pixel (same scale the trace used). */
  mmPerPx: number;
  /** mm offset applied to every traced object (hoop centering) — applied here too
   *  so the lettering lands in the same coordinate space. */
  offsetXMm?: number;
  offsetYMm?: number;
  /** the traced objects + palette, so we can color the text from the traced ink
   *  and know which rough objects the lettering replaces. */
  objects: EmbObject[];
  colors: ThreadColor[];
  /** the font to set every word in, plus its id for the authored decomposition. */
  font: Font;
  fontId?: string;
  /** ignore words OCR isn't sure about (default 60). */
  minConfidence?: number;
  /** ignore text shorter than this on the hoop — too small to letter (default 3.5mm). */
  minHeightMm?: number;
}

export interface TextRecognizeResult {
  /** clean font-lettering objects to add (already positioned in hoop mm). */
  textObjects: EmbObject[];
  /** ids of traced objects the lettering replaces (rough glyphs to drop). */
  removeIds: string[];
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const DEFAULT_MIN_CONFIDENCE = 60;
const DEFAULT_MIN_HEIGHT_MM = 3.5;
/** A traced object is treated as the rough rendering of a word (→ replace) when at
 *  least this fraction of its bounding box sits within the recognized text area. */
const COVER_FRAC = 0.5;

/** A word is plausible lettering only if it has a visible glyph — a letter or
 *  digit. Pure punctuation/specks that OCR sometimes emits are ignored. */
function hasLetter(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}

/** Bounding box of a set of rings, or null if empty. */
function bboxOf(paths: Path[]): Box | null {
  const b = pathsBounds(paths);
  return b ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } : null;
}

/** Area of intersection of two boxes (0 if disjoint). */
function intersectArea(a: Box, b: Box): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
}

function boxArea(b: Box): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

/**
 * Convert OCR words into clean font lettering positioned over the traced text,
 * plus the ids of the traced objects that lettering replaces. Words that aren't
 * confident, big, or letter-like enough — or that don't sit over any traced ink
 * (so there's nothing to replace) — are skipped, leaving the trace untouched.
 */
export function recognizeTextObjects(opts: TextRecognizeOptions): TextRecognizeResult {
  const {
    words,
    mmPerPx,
    offsetXMm = 0,
    offsetYMm = 0,
    objects,
    font,
    fontId,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    minHeightMm = DEFAULT_MIN_HEIGHT_MM,
  } = opts;

  // Pixel box → hoop-mm box (same mapping the trace used).
  const toMmBox = (w: OcrWord): Box => ({
    minX: w.bbox.x0 * mmPerPx + offsetXMm,
    minY: w.bbox.y0 * mmPerPx + offsetYMm,
    maxX: w.bbox.x1 * mmPerPx + offsetXMm,
    maxY: w.bbox.y1 * mmPerPx + offsetYMm,
  });

  const kept = words.filter(
    (w) =>
      w.confidence >= minConfidence &&
      hasLetter(w.text.trim()) &&
      (w.bbox.y1 - w.bbox.y0) * mmPerPx >= minHeightMm,
  );
  if (kept.length === 0) return { textObjects: [], removeIds: [] };

  const wordBoxes = kept.map(toMmBox);

  // A traced FILL object is the rough rendering of this text when most of its box
  // lies inside the recognized word area. Collect those to drop, and tally their
  // ink color so the lettering matches the original.
  const fills = objects.filter((o) => o.type === "fill");
  const removeIds: string[] = [];
  const colorArea = new Map<string, number>();
  for (const o of fills) {
    const ob = bboxOf(o.paths);
    if (!ob) continue;
    const area = boxArea(ob);
    if (area <= 0) continue;
    let covered = 0;
    for (const wb of wordBoxes) covered += intersectArea(ob, wb);
    if (covered / area >= COVER_FRAC) {
      removeIds.push(o.id);
      colorArea.set(o.colorId, (colorArea.get(o.colorId) ?? 0) + area);
    }
  }
  // Nothing traced under the words → leave the design alone (don't drop floating
  // lettering over a knockout fill or a non-text region OCR misfired on).
  if (removeIds.length === 0) return { textObjects: [], removeIds: [] };

  // Dominant ink color among the replaced objects.
  let colorId = objects.find((o) => removeIds.includes(o.id))?.colorId ?? "";
  let best = -1;
  for (const [cid, a] of colorArea) {
    if (a > best) {
      best = a;
      colorId = cid;
    }
  }

  const textObjects: EmbObject[] = [];
  for (let i = 0; i < kept.length; i++) {
    const wb = wordBoxes[i];
    const heightMm = wb.maxY - wb.minY;
    const { object } = layoutText({
      text: kept[i].text.trim(),
      font,
      fontId,
      heightMm,
      colorId,
      name: kept[i].text.trim(),
    });
    if (object.paths.length === 0) continue; // unrenderable string (e.g. only spaces)

    // Center the laid-out glyphs (origin-centered) on the word box's center.
    const lb = bboxOf(object.paths);
    if (!lb) continue;
    const cx = (wb.minX + wb.maxX) / 2;
    const cy = (wb.minY + wb.maxY) / 2;
    const dx = cx - (lb.minX + lb.maxX) / 2;
    const dy = cy - (lb.minY + lb.maxY) / 2;
    const placed: EmbObject = {
      ...object,
      paths: translatePaths(object.paths, dx, dy),
      satinCenterlines: object.satinCenterlines
        ? translatePaths(object.satinCenterlines, dx, dy)
        : undefined,
    };
    textObjects.push(placed);
  }

  return { textObjects, removeIds };
}

/** Convenience: apply a {@link TextRecognizeResult} to a traced object list —
 *  drop the replaced rough glyphs and append the clean lettering (sewn last so it
 *  lands on top). */
export function applyTextRecognition(
  objects: EmbObject[],
  result: TextRecognizeResult,
): EmbObject[] {
  if (result.textObjects.length === 0) return objects;
  const drop = new Set(result.removeIds);
  return [...objects.filter((o) => !drop.has(o.id)), ...result.textObjects];
}

/**
 * Re-lay a text object from its stored TextSpec with a patch applied —
 * the machinery behind on-canvas text verbs (size steppers, arch nudges)
 * that edit text without opening the dialog. Keeps the object's identity,
 * color, params and CENTER: growing a word shouldn't shove it around.
 */
import type { EmbObject, TextSpec } from "../../types/project";
import { loadFont } from "./fonts";
import { layoutText } from "./layout";
import { pathsBounds } from "../geometry";

export async function relayoutTextObject(
  o: EmbObject,
  patch: Partial<TextSpec>,
): Promise<Pick<EmbObject, "paths" | "satinCenterlines" | "text"> | null> {
  if (!o.text) return null;
  const spec: TextSpec = { ...o.text, ...patch };
  const font = await loadFont(spec.fontId);
  const { object } = layoutText({
    text: spec.content,
    font,
    fontId: spec.fontId,
    heightMm: spec.heightMm,
    letterSpacingMm: spec.letterSpacingMm,
    lineSpacing: spec.lineSpacing,
    archDeg: spec.archDeg,
    circleRadiusMm: spec.circleRadiusMm,
    circleSide: spec.circleSide,
    pathMm: spec.pathMm,
    glyphTweaks: spec.glyphTweaks,
    colorId: o.colorId,
    name: o.name,
  });
  const oldB = pathsBounds(o.paths);
  const newB = pathsBounds(object.paths);
  if (!oldB || !newB) return null;
  const dx = (oldB.minX + oldB.maxX) / 2 - (newB.minX + newB.maxX) / 2;
  const dy = (oldB.minY + oldB.maxY) / 2 - (newB.minY + newB.maxY) / 2;
  const shift = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  return {
    paths: object.paths.map((r) => r.map(shift)),
    satinCenterlines: object.satinCenterlines?.map((r) => r.map(shift)),
    text: spec,
  };
}

/** The size-step ladder for the on-canvas A−/A+ verbs: standard garment sizes
 *  rather than a raw multiplier, so stepping lands on meaningful heights. */
export const TEXT_SIZE_LADDER_MM = [4, 5, 6, 8, 10, 12, 16, 20, 25, 32, 38, 50, 63, 75];

export function nextSizeMm(current: number, dir: 1 | -1): number {
  const L = TEXT_SIZE_LADDER_MM;
  if (dir === 1) {
    for (const v of L) if (v > current + 0.01) return v;
    return L[L.length - 1];
  }
  for (let i = L.length - 1; i >= 0; i--) if (L[i] < current - 0.01) return L[i];
  return L[0];
}

/**
 * Starter templates: complete, provably-clean designs built with the app's
 * own machinery, one click from a blank hoop. Each is generated (not stored)
 * so it always reflects the current engine, and each is gated by the corpus
 * sweep in tests — shipped starters must pass the same quality bar as
 * everything else.
 */
import type { Font } from "opentype.js";
import type { Project, EmbObject } from "../types/project";
import { createEmptyProject } from "./project";
import { makeShapeObject } from "./shapes";
import { layoutText } from "./text/layout";
import { pathsBounds } from "./geometry";
import { DEFAULT_FONT_ID } from "./text/fonts";

export interface TemplateSpec {
  id: string;
  name: string;
  /** One-line description shown on the card. */
  blurb: string;
  /** Placeholder words the user will re-type. */
  words: string;
}

export const TEMPLATES: TemplateSpec[] = [
  { id: "name-patch", name: "Name patch", blurb: "Bordered bar with your name in clean satin", words: "RILEY" },
  { id: "monogram", name: "Monogram badge", blurb: "Circle band around a big single letter", words: "S" },
  { id: "team-arc", name: "Team arc", blurb: "Arched team name over a straight line", words: "TIGERS" },
];

function place(o: EmbObject, cx: number, cy: number): EmbObject {
  const b = pathsBounds(o.paths);
  if (!b) return o;
  const dx = cx - (b.minX + b.maxX) / 2;
  const dy = cy - (b.minY + b.maxY) / 2;
  return { ...o, paths: o.paths.map((r) => r.map((p) => ({ x: p.x + dx, y: p.y + dy }))) };
}

/** Build a template into a fresh project (hoop from createEmptyProject). */
export function buildTemplate(id: string, font: Font, words?: string): Project {
  const p = createEmptyProject();
  // Two-color starters: a body color plus a contrasting lettering color.
  const navy = p.colors[0].id;
  const cream = { id: "tpl-cream", rgb: [244, 238, 216] as [number, number, number], name: "Cream" };
  p.colors.push(cream);
  const spec = TEMPLATES.find((t) => t.id === id);
  const text = (words ?? spec?.words ?? "TEXT").toUpperCase();
  const cx = p.hoop.wMm / 2;
  const cy = p.hoop.hMm / 2;
  // Every template text object carries its full TextSpec, so double-tapping
  // it on canvas opens the SAME editor dialog-added words get — templates are
  // placeholders you re-type, not baked geometry.
  const textSpec = (content: string, heightMm: number, archDeg = 0) => ({
    content,
    fontId: DEFAULT_FONT_ID,
    heightMm,
    letterSpacingMm: 0,
    archDeg,
  });
  if (id === "name-patch") {
    const bar = makeShapeObject("roundedRect", { width: 70, height: 24, center: { x: cx, y: cy } }, navy);
    bar.params = { ...bar.params, fillStyle: "satin" };
    bar.name = "Border";
    const t = layoutText({ text, font, heightMm: 12, colorId: cream.id, name: text, fontId: DEFAULT_FONT_ID });
    const label = place(t.object, cx, cy);
    label.name = text;
    label.text = textSpec(text, 12);
    p.objects.push(bar, label);
  } else if (id === "monogram") {
    const band = makeShapeObject("ellipse", { width: 56, height: 56, center: { x: cx, y: cy } }, navy);
    band.params = { ...band.params, fillStyle: "satin" };
    band.name = "Band";
    const t = layoutText({ text: text.slice(0, 1), font, heightMm: 26, colorId: cream.id, name: "Letter", fontId: DEFAULT_FONT_ID });
    const letter = place(t.object, cx, cy);
    letter.name = text.slice(0, 1);
    letter.text = textSpec(text.slice(0, 1), 26);
    p.objects.push(band, letter);
  } else if (id === "team-arc") {
    const arcTop = layoutText({ text, font, heightMm: 12, archDeg: 90, colorId: navy, name: text, fontId: DEFAULT_FONT_ID });
    const top = place(arcTop.object, cx, cy - 10);
    top.name = text;
    top.text = textSpec(text, 12, 90);
    const est = layoutText({ text: "EST. 2026", font, heightMm: 5, colorId: navy, name: "EST", fontId: DEFAULT_FONT_ID });
    const bottom = place(est.object, cx, cy + 16);
    bottom.name = "EST. 2026";
    bottom.text = textSpec("EST. 2026", 5);
    p.objects.push(top, bottom);
  }
  return p;
}

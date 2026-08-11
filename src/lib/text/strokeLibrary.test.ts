import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFont } from "./fonts";
import { layoutText } from "./layout";
import { __seedForTests, libraryGlyphStrokes, normalizeStrokes, listAuthoredGlyphs } from "./strokeLibrary";

const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "fonts");
const buf = readFileSync(join(fontsDir, "Montserrat-SemiBold.ttf"));
const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);

describe("font stroke library", () => {
  it("normalizes strokes to the glyph bbox", () => {
    const norm = normalizeStrokes(
      [[{ x: 10, y: 20 }, { x: 20, y: 30 }]],
      { minX: 10, minY: 20, maxX: 20, maxY: 30 },
    );
    expect(norm).toEqual([[[0, 0], [1, 1]]]);
  });

  it("library strokes override auto-derived ones in layout", () => {
    // Seed a distinctive single diagonal stroke for 'I' in a fake font id.
    __seedForTests("montserrat", "I", [[[0.1, 0.1], [0.9, 0.9]]]);
    expect(libraryGlyphStrokes("montserrat", "I")).toBeTruthy();
    expect(listAuthoredGlyphs("montserrat")).toContain("I");
    const { object } = layoutText({ text: "I", font, heightMm: 20, colorId: "c", fontId: "montserrat" });
    // Exactly the one seeded stroke, mapped to the glyph box: a diagonal —
    // auto-derivation for an I would be a straight vertical.
    expect(object.satinCenterlines).toHaveLength(1);
    const st = object.satinCenterlines![0];
    const dx = Math.abs(st[st.length - 1].x - st[0].x);
    expect(dx).toBeGreaterThan(1); // diagonal, not vertical
  });

  it("unknown font/char falls through to auto strokes", () => {
    const { object } = layoutText({ text: "L", font, heightMm: 20, colorId: "c", fontId: "montserrat" });
    expect((object.satinCenterlines ?? []).length).toBeGreaterThan(0);
  });
});

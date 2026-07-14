import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseImportedFont, isCustomFontId } from "./customFonts";

// A real face from the bundled set stands in for "a font the user imported".
const oswald = readFileSync(join(__dirname, "fonts", "Oswald-Medium.ttf"));
const buf = oswald.buffer.slice(oswald.byteOffset, oswald.byteOffset + oswald.byteLength);

describe("parseImportedFont", () => {
  it("parses a real TTF, names it from the font's own name table, and ids it as user-…", () => {
    const { font, meta } = parseImportedFont(buf as ArrayBuffer, "whatever.ttf");
    expect(font.charToGlyph("A").index).toBeGreaterThan(0);
    expect(meta.name.toLowerCase()).toContain("oswald");
    expect(meta.id.startsWith("user-")).toBe(true);
    expect(isCustomFontId(meta.id)).toBe(true);
    // Oswald is a medium-weight face — no thin-stroke warning expected.
    expect(meta.note).toBe("");
  });

  it("rejects a non-font file with a friendly message", () => {
    const junk = new TextEncoder().encode("definitely not a font").buffer;
    expect(() => parseImportedFont(junk as ArrayBuffer, "junk.ttf")).toThrow(/couldn't be read as a font/i);
  });

  it("same font imported twice yields the same id (overwrite, not duplicate)", () => {
    const a = parseImportedFont(buf as ArrayBuffer, "a.ttf").meta.id;
    const b = parseImportedFont(buf as ArrayBuffer, "b.ttf").meta.id;
    expect(a).toBe(b);
  });
});

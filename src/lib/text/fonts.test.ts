import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FONTS, DEFAULT_FONT_ID, parseFont } from "./fonts";

// The runtime registry uses Vite `?url` imports that resolve to bundled asset
// URLs. In node we can't fetch those, so we map each font id to the .ttf file
// that lives next to fonts.ts and parse it straight from disk — the same trick
// layout.test.ts uses. This keeps the test pure (no DOM, no network).
const here = dirname(fileURLToPath(import.meta.url));

const FILE_BY_ID: Record<string, string> = {
  poppins: "Poppins-SemiBold.ttf",
  montserrat: "Montserrat-SemiBold.ttf",
  playfair: "PlayfairDisplay-Bold.ttf",
  "roboto-slab": "RobotoSlab-Bold.ttf",
  oswald: "Oswald-Medium.ttf",
  "bebas-neue": "BebasNeue-Regular.ttf",
  pacifico: "Pacifico-Regular.ttf",
  lobster: "Lobster-Regular.ttf",
  "dancing-script": "DancingScript-Bold.ttf",
  caveat: "Caveat-Bold.ttf",
};

describe("font registry", () => {
  it("lists the full bundled set with stable, unique ids", () => {
    const ids = FONTS.map((f) => f.id);
    expect(ids.sort()).toEqual(Object.keys(FILE_BY_ID).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the default font id", () => {
    expect(FONTS.some((f) => f.id === DEFAULT_FONT_ID)).toBe(true);
  });

  it("every entry has a name, url, and OFL-1.1 license", () => {
    for (const f of FONTS) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.url.length).toBeGreaterThan(0);
      expect(f.license).toBe("OFL-1.1");
    }
  });

  it("ships a .ttf asset for every registered font, and each one parses", () => {
    for (const f of FONTS) {
      const file = FILE_BY_ID[f.id];
      expect(file, `no test mapping for font id ${f.id}`).toBeDefined();
      const path = join(here, "fonts", file);
      expect(existsSync(path), `missing asset for ${f.id}: ${file}`).toBe(true);

      const buf = readFileSync(path);
      const ab = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      );
      const font = parseFont(ab as ArrayBuffer);
      // A real face has glyphs and an em size; a smoke check that parse worked.
      expect(font.glyphs.length).toBeGreaterThan(0);
      expect(font.unitsPerEm).toBeGreaterThan(0);
    }
  });
});

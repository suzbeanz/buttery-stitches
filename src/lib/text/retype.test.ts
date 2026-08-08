import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFont } from "./fonts";
import { retypeToBox, suggestVertical, suggestEmboldenMm } from "./retype";
import { pathsBounds } from "../geometry";
import { meanStrokeWidthMm } from "../engine/classify";

const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "fonts");
const buf = readFileSync(join(fontsDir, "Montserrat-SemiBold.ttf"));
const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);

describe("retypeToBox", () => {
  it("fits horizontal text to the box within tolerance", () => {
    const box = { x0: 10, y0: 20, x1: 40, y1: 26 };
    const o = retypeToBox({ text: "HELLO", font, box, vertical: false, colorId: "c" });
    const b = pathsBounds(o.paths)!;
    expect(Math.abs(b.minX - 10)).toBeLessThan(0.8);
    expect(Math.abs(b.maxX - 40)).toBeLessThan(0.8);
    // Cap height fills the box height (descender-free string).
    expect(b.maxY - b.minY).toBeGreaterThan(4.5);
    expect(b.maxY - b.minY).toBeLessThan(8);
  });

  it("rotates vertical text into a tall strip", () => {
    const box = { x0: 70, y0: 20, x1: 76, y1: 60 };
    const o = retypeToBox({ text: "CITY", font, box, vertical: true, colorId: "c" });
    const b = pathsBounds(o.paths)!;
    expect(b.maxY - b.minY).toBeGreaterThan(b.maxX - b.minX);
    expect(Math.abs(b.minY - 20)).toBeLessThan(0.8);
    expect(Math.abs(b.maxY - 60)).toBeLessThan(0.8);
  });

  it("embolden raises stroke width without changing the box fit", () => {
    const box = { x0: 10, y0: 20, x1: 40, y1: 24.5 };
    const thin = retypeToBox({ text: "LOUIS", font, box, vertical: false, colorId: "c" });
    const bold = retypeToBox({ text: "LOUIS", font, box, vertical: false, colorId: "c", emboldenMm: 0.12 });
    expect(meanStrokeWidthMm(bold.paths)).toBeGreaterThan(meanStrokeWidthMm(thin.paths) + 0.1);
    const b = pathsBounds(bold.paths)!;
    expect(Math.abs(b.minX - 10)).toBeLessThan(1);
  });

  it("suggests orientation and embolden from the box", () => {
    expect(suggestVertical({ x0: 0, y0: 0, x1: 4, y1: 30 })).toBe(true);
    expect(suggestVertical({ x0: 0, y0: 0, x1: 30, y1: 6 })).toBe(false);
    expect(suggestEmboldenMm({ x0: 0, y0: 0, x1: 4, y1: 30 }, true)).toBeGreaterThan(0);
    expect(suggestEmboldenMm({ x0: 0, y0: 0, x1: 30, y1: 12 }, false)).toBe(0);
  });
});

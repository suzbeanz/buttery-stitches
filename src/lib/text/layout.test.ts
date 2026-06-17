import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Font } from "opentype.js";
import { parseFont } from "./fonts";
import { layoutText } from "./layout";
import { pathsBounds } from "../geometry";

// Read a bundled .ttf straight from disk so the layout math is exercised in
// node with a real font (no DOM, no network).
const here = dirname(fileURLToPath(import.meta.url));

function loadTtf(file: string): Font {
  const buf = readFileSync(join(here, "fonts", file));
  // Pass the exact bytes as an ArrayBuffer slice.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return parseFont(ab as ArrayBuffer);
}

describe("layoutText", () => {
  let font: Font;
  beforeAll(() => {
    font = loadTtf("Poppins-SemiBold.ttf");
  });

  it("a single letter produces at least one ring as a fill object", () => {
    const { object } = layoutText({
      text: "H",
      font,
      heightMm: 10,
      colorId: "c1",
    });
    expect(object.type).toBe("fill");
    expect(object.paths.length).toBeGreaterThanOrEqual(1);
  });

  it("a letter with a counter (o) produces a hole — at least two rings", () => {
    const { object } = layoutText({
      text: "o",
      font,
      heightMm: 10,
      colorId: "c1",
    });
    expect(object.paths.length).toBeGreaterThanOrEqual(2);
  });

  it("scales so the bbox height matches heightMm within tolerance", () => {
    const { object } = layoutText({
      text: "Hg",
      font,
      heightMm: 12,
      colorId: "c1",
    });
    const b = pathsBounds(object.paths)!;
    expect(b.maxY - b.minY).toBeCloseTo(12, 1);
  });

  it("centers the result on the origin", () => {
    const { object } = layoutText({
      text: "Buttery",
      font,
      heightMm: 8,
      colorId: "c1",
    });
    const b = pathsBounds(object.paths)!;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    expect(Math.abs(cx)).toBeLessThan(0.001);
    expect(Math.abs(cy)).toBeLessThan(0.001);
  });

  it("letter spacing increases the total width", () => {
    const base = layoutText({
      text: "ABC",
      font,
      heightMm: 10,
      colorId: "c1",
      letterSpacingMm: 0,
    });
    const spaced = layoutText({
      text: "ABC",
      font,
      heightMm: 10,
      colorId: "c1",
      letterSpacingMm: 3,
    });
    expect(spaced.widthMm).toBeGreaterThan(base.widthMm);
  });

  it("spaces advance the pen without adding geometry", () => {
    const withGap = layoutText({
      text: "A A",
      font,
      heightMm: 10,
      colorId: "c1",
    });
    const noGap = layoutText({
      text: "AA",
      font,
      heightMm: 10,
      colorId: "c1",
    });
    // Same number of rings (the space contributes none) but more width.
    expect(withGap.object.paths.length).toBe(noGap.object.paths.length);
    expect(withGap.widthMm).toBeGreaterThan(noGap.widthMm);
  });

  it("produces a single fill object for a whole string", () => {
    const { object } = layoutText({
      text: "Hello",
      font,
      heightMm: 10,
      colorId: "c1",
      name: "Hello",
    });
    expect(object.type).toBe("fill");
    expect(object.name).toBe("Hello");
    // Many rings (one or more per letter, plus counters) in ONE object.
    expect(object.paths.length).toBeGreaterThan(3);
  });

  it("a whitespace-only string yields a fill object with no rings", () => {
    const { object } = layoutText({
      text: "   ",
      font,
      heightMm: 10,
      colorId: "c1",
    });
    expect(object.type).toBe("fill");
    expect(object.paths.length).toBe(0);
  });

  it("multiline text is taller than a single line but keeps letter height", () => {
    const one = layoutText({ text: "AB", font, heightMm: 10, colorId: "c1" });
    const two = layoutText({ text: "AB\nCD", font, heightMm: 10, colorId: "c1" });
    const h1 = pathsBounds(one.object.paths)!;
    const h2 = pathsBounds(two.object.paths)!;
    const tall1 = h1.maxY - h1.minY;
    const tall2 = h2.maxY - h2.minY;
    expect(tall2).toBeGreaterThan(tall1 * 1.8); // ~2 lines + spacing
    expect(tall2).toBeLessThan(tall1 * 3); // not wildly larger (letters same size)
  });

  it("arch bends a single line into a curve (ends drop below the middle for ∩)", () => {
    const flat = layoutText({ text: "ARCH", font, heightMm: 10, colorId: "c1" });
    const up = layoutText({ text: "ARCH", font, heightMm: 10, archDeg: 90, colorId: "c1" });
    // The arched version is not a flat strip: its bbox is taller than the flat one.
    const fb = pathsBounds(flat.object.paths)!;
    const ub = pathsBounds(up.object.paths)!;
    expect(ub.maxY - ub.minY).toBeGreaterThan((fb.maxY - fb.minY) * 1.2);
    // straight (0°) is unchanged from omitting archDeg.
    const z = layoutText({ text: "ARCH", font, heightMm: 10, archDeg: 0, colorId: "c1" });
    expect(pathsBounds(z.object.paths)!.maxY - pathsBounds(z.object.paths)!.minY).toBeCloseTo(
      fb.maxY - fb.minY,
      1,
    );
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { characterSeeds, guidedLetterObjects, type GuidedLetter } from "./guidedText";
import { parseFont } from "../text/fonts";
import { makeObjectFromPaths } from "../objects";
import { generateObjectRuns } from "../engine";
import { pointInRing } from "../geometry";
import type { Font } from "opentype.js";
import type { Path } from "../../types/project";

const here = dirname(fileURLToPath(import.meta.url));
function loadTtf(file: string): Font {
  const buf = readFileSync(join(here, "..", "text", "fonts", file));
  return parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}
const font = loadTtf("Oswald-Medium.ttf");

/** A blocky letter-shaped outline (a fat 'H' — two stems + a bar) as traced rings. */
function letterH(cx: number, cy: number, w: number, h: number): Path[] {
  const l = cx - w / 2, r = cx + w / 2, t = cy - h / 2, b = cy + h / 2;
  const sw = w * 0.28; // stem width
  const bt = cy - h * 0.12, bb = cy + h * 0.12; // bar band
  // One outer ring tracing the H silhouette (left stem up, across the top…).
  return [[
    { x: l, y: t }, { x: l + sw, y: t }, { x: l + sw, y: bt }, { x: r - sw, y: bt },
    { x: r - sw, y: t }, { x: r, y: t }, { x: r, y: b }, { x: r - sw, y: b },
    { x: r - sw, y: bb }, { x: l + sw, y: bb }, { x: l + sw, y: b }, { x: l, y: b },
  ]];
}

describe("characterSeeds", () => {
  it("derives normalised stroke seeds from a font glyph skeleton", () => {
    const seeds = characterSeeds("H", font, "oswald");
    expect(seeds.length).toBeGreaterThan(0);
    // Every seed point is normalised into the glyph bbox 0..1 (small slack for
    // the skeleton running to the ink edge).
    for (const s of seeds)
      for (const [x, y] of s) {
        expect(x).toBeGreaterThanOrEqual(-0.15);
        expect(x).toBeLessThanOrEqual(1.15);
        expect(y).toBeGreaterThanOrEqual(-0.15);
        expect(y).toBeLessThanOrEqual(1.15);
      }
  });

  it("caches per (font, char) — same array returned", () => {
    const a = characterSeeds("A", font, "oswald");
    const b = characterSeeds("A", font, "oswald");
    expect(a).toBe(b);
  });

  it("returns [] for an inkless character (a space) without throwing", () => {
    expect(characterSeeds(" ", font, "oswald")).toEqual([]);
  });
});

describe("guidedLetterObjects", () => {
  const mk = (rings: Path[], colorId: string, name: string) => makeObjectFromPaths("fill", rings, colorId, name);

  it("keeps the TRACED rings and attaches font-topology centerlines inside them", () => {
    const rings = letterH(50, 50, 20, 26);
    const letter: GuidedLetter = {
      char: "H", rings, cx: 50, cy: 50, halfLen: 10, halfHeight: 13, angleRad: 0, colorId: "c1",
    };
    const [obj] = guidedLetterObjects([letter], font, "oswald", mk);
    // Original letterform kept verbatim.
    expect(obj.paths).toBe(rings);
    expect(obj.params.lineArt).toBe(true);
    expect(obj.params.fillStyle).toBe("satin");
    // Seed centerlines were attached and lie INSIDE the traced outline.
    expect(obj.satinCenterlines!.length).toBeGreaterThan(0);
    let inside = 0, total = 0;
    for (const cl of obj.satinCenterlines!)
      for (const p of cl) {
        total++;
        if (pointInRing(p, rings[0])) inside++;
      }
    // Most seed points sit on the letter's ink (snapToMedial fixes the rest).
    expect(inside / total).toBeGreaterThan(0.6);
  });

  it("produces satin coverage of the traced letter via the engine", () => {
    const rings = letterH(50, 50, 22, 28);
    const letter: GuidedLetter = {
      char: "H", rings, cx: 50, cy: 50, halfLen: 11, halfHeight: 14, angleRad: 0, colorId: "c1",
    };
    const [obj] = guidedLetterObjects([letter], font, "oswald", mk);
    const runs = generateObjectRuns({ ...obj, visible: true });
    const pts = runs.flatMap((r) => r.pts);
    expect(pts.length).toBeGreaterThan(30);
    // Penetrations land within the traced outline (satin follows the real form).
    const on = pts.filter((p) => pointInRing(p, rings[0])).length;
    expect(on / pts.length).toBeGreaterThan(0.6);
  });

  it("places seeds at the letter's angle (rotated box)", () => {
    const rings = letterH(50, 50, 20, 26);
    const flat: GuidedLetter = { char: "H", rings, cx: 50, cy: 50, halfLen: 10, halfHeight: 13, angleRad: 0, colorId: "c1" };
    const turned: GuidedLetter = { ...flat, angleRad: Math.PI / 2 };
    const [a] = guidedLetterObjects([flat], font, "oswald", mk);
    const [b] = guidedLetterObjects([turned], font, "oswald", mk);
    // The rotated placement spreads its centerlines along a different axis.
    const spanX = (o: typeof a) => {
      const xs = o.satinCenterlines!.flat().map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(Math.abs(spanX(a) - spanX(b))).toBeGreaterThan(1);
  });

  it("still emits an object (plain trace) when the font yields no skeleton", () => {
    const rings = letterH(50, 50, 20, 26);
    const letter: GuidedLetter = { char: " ", rings, cx: 50, cy: 50, halfLen: 10, halfHeight: 13, angleRad: 0, colorId: "c1" };
    const [obj] = guidedLetterObjects([letter], font, "oswald", mk);
    expect(obj).toBeDefined();
    expect(obj.paths).toBe(rings); // letterform still sews
    expect(obj.satinCenterlines).toBeUndefined();
  });
});

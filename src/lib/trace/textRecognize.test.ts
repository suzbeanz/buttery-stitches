import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Font } from "opentype.js";
import { parseFont } from "../text/fonts";
import { recognizeTextObjects, applyTextRecognition, type OcrWord } from "./textRecognize";
import { makeObjectFromPaths } from "../objects";
import { pathsBounds } from "../geometry";
import type { EmbObject, ThreadColor } from "../../types/project";

const here = dirname(fileURLToPath(import.meta.url));
function loadTtf(file: string): Font {
  const buf = readFileSync(join(here, "..", "text", "fonts", file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return parseFont(ab as ArrayBuffer);
}

/** A rectangular traced "fill" object covering a pixel box (mm = px here). */
function tracedBox(id: string, colorId: string, x0: number, y0: number, x1: number, y1: number): EmbObject {
  const o = makeObjectFromPaths(
    "fill",
    [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]],
    colorId,
  );
  return { ...o, id };
}

const colors: ThreadColor[] = [
  { id: "ink", rgb: [20, 40, 30], name: "Ink" },
  { id: "other", rgb: [200, 30, 30], name: "Other" },
];

describe("recognizeTextObjects", () => {
  let font: Font;
  beforeAll(() => {
    font = loadTtf("Oswald-Medium.ttf");
  });

  const word = (text: string, conf: number, x0: number, y0: number, x1: number, y1: number): OcrWord => ({
    text,
    confidence: conf,
    bbox: { x0, y0, x1, y1 },
  });

  it("replaces a traced word with positioned font lettering of the traced ink color", () => {
    // A traced "fill" for the word sits at x10..90, y10..30 (mm, since mmPerPx=1).
    const traced = [tracedBox("t1", "ink", 10, 10, 90, 30)];
    const res = recognizeTextObjects({
      words: [word("COFFEE", 92, 10, 10, 90, 30)],
      mmPerPx: 1,
      objects: traced,
      colors,
      font,
    });
    expect(res.removeIds).toEqual(["t1"]);
    expect(res.textObjects).toHaveLength(1);
    const obj = res.textObjects[0];
    expect(obj.colorId).toBe("ink");
    expect(obj.params?.fillStyle).toBe("satin"); // font lettering sews as satin
    // Positioned over the word box: its center is near the box center.
    const b = pathsBounds(obj.paths)!;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(50, 0);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(20, 0);
    // Sized to the box height (~20mm).
    expect(b.maxY - b.minY).toBeGreaterThan(12);
    expect(b.maxY - b.minY).toBeLessThanOrEqual(22);
  });

  it("skips low-confidence and tiny words", () => {
    const traced = [tracedBox("t1", "ink", 10, 10, 90, 30)];
    const lowConf = recognizeTextObjects({
      words: [word("COFFEE", 30, 10, 10, 90, 30)],
      mmPerPx: 1,
      objects: traced,
      colors,
      font,
    });
    expect(lowConf.textObjects).toHaveLength(0);
    expect(lowConf.removeIds).toHaveLength(0);

    const tiny = recognizeTextObjects({
      words: [word("COFFEE", 95, 10, 10, 90, 12)], // 2mm tall
      mmPerPx: 1,
      objects: traced,
      colors,
      font,
    });
    expect(tiny.textObjects).toHaveLength(0);
  });

  it("does nothing when no traced ink sits under the word (knockout / OCR misfire)", () => {
    // The only traced object is far away — nothing to replace, so we add no
    // floating lettering.
    const traced = [tracedBox("t1", "ink", 200, 200, 260, 220)];
    const res = recognizeTextObjects({
      words: [word("GHOST", 95, 10, 10, 90, 30)],
      mmPerPx: 1,
      objects: traced,
      colors,
      font,
    });
    expect(res.textObjects).toHaveLength(0);
    expect(res.removeIds).toHaveLength(0);
  });

  it("honors mmPerPx and offsets when placing lettering", () => {
    // 2 mm per pixel; box px 5..45 x 5..15 → mm 10..90 x 10..30, plus a +100,+50 offset.
    const traced = [tracedBox("t1", "ink", 110, 60, 190, 80)];
    const res = recognizeTextObjects({
      words: [word("LOGO", 90, 5, 5, 45, 15)],
      mmPerPx: 2,
      offsetXMm: 100,
      offsetYMm: 50,
      objects: traced,
      colors,
      font,
    });
    expect(res.textObjects).toHaveLength(1);
    const b = pathsBounds(res.textObjects[0].paths)!;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(150, 0);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(70, 0);
  });

  it("applyTextRecognition drops replaced objects and appends lettering last", () => {
    const traced = [
      tracedBox("keep", "other", 0, 0, 5, 5),
      tracedBox("t1", "ink", 10, 10, 90, 30),
    ];
    const res = recognizeTextObjects({
      words: [word("HI", 95, 10, 10, 90, 30)],
      mmPerPx: 1,
      objects: traced,
      colors,
      font,
    });
    const out = applyTextRecognition(traced, res);
    expect(out.map((o) => o.id)).toContain("keep");
    expect(out.map((o) => o.id)).not.toContain("t1");
    expect(out[out.length - 1]).toBe(res.textObjects[0]); // lettering on top
  });
});

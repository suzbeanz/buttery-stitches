import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectTextClusters, placeManualText, placeGuidedText, applyManualText } from "./manualText";
import { parseFont } from "../text/fonts";
import { makeObjectFromPaths } from "../objects";
import { pathsBounds } from "../geometry";
import type { EmbObject, Path } from "../../types/project";
import type { Font } from "opentype.js";

const here = dirname(fileURLToPath(import.meta.url));
function loadTtf(file: string): Font {
  const buf = readFileSync(join(here, "..", "text", "fonts", file));
  return parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

/** A square "glyph" block of side `s` mm centered at (cx,cy), as one fill object. */
function glyph(cx: number, cy: number, s: number, colorId: string): EmbObject {
  const h = s / 2;
  const ring: Path = [
    { x: cx - h, y: cy - h }, { x: cx + h, y: cy - h },
    { x: cx + h, y: cy + h }, { x: cx - h, y: cy + h },
  ];
  return makeObjectFromPaths("fill", [ring], colorId);
}

/** N glyph blocks in a row (a "word") — one object PER glyph. */
function word(x0: number, y: number, n: number, s: number, gap: number, colorId: string): EmbObject[] {
  return Array.from({ length: n }, (_, i) => glyph(x0 + i * (s + gap), y, s, colorId));
}

describe("detectTextClusters", () => {
  it("finds a horizontal row of similar glyphs as one cluster", () => {
    const objs = word(10, 20, 5, 4, 1.5, "c1"); // 5 letters, 4mm, at y=20
    const clusters = detectTextClusters(objs);
    expect(clusters.length).toBe(1);
    expect(Math.abs(clusters[0].angleDeg) % 180).toBeLessThan(5); // horizontal
    expect(clusters[0].heightMm).toBeGreaterThan(3);
    expect(clusters[0].heightMm).toBeLessThan(6);
    expect(clusters[0].removeIds.length).toBe(5);
  });

  it("reads a vertical (rotated) run's angle", () => {
    // 5 glyphs stacked in a column — the crest case.
    const objs = Array.from({ length: 5 }, (_, i) => glyph(30, 10 + i * 5.5, 4, "c1"));
    const clusters = detectTextClusters(objs);
    expect(clusters.length).toBe(1);
    expect(Math.abs(Math.abs(clusters[0].angleDeg) - 90)).toBeLessThan(5); // vertical
  });

  it("splits a big word and a small word of the same colour into two clusters", () => {
    // CITY (14mm) above ST LOUIS (4mm), both same colour, adjacent columns —
    // the exact merge that produced 20mm lettering before the size gate.
    const big = Array.from({ length: 4 }, (_, i) => glyph(50, 20 + i * 16, 14, "c1"));
    const small = Array.from({ length: 6 }, (_, i) => glyph(62, 20 + i * 5, 4, "c1"));
    const clusters = detectTextClusters([...big, ...small]);
    expect(clusters.length).toBe(2);
    const heights = clusters.map((c) => c.heightMm).sort((a, b) => a - b);
    expect(heights[0]).toBeLessThan(6); // the small word stayed small
    expect(heights[1]).toBeGreaterThan(12);
  });

  it("ignores a lone shape and a big logo mark (not text)", () => {
    const mark = makeObjectFromPaths("fill", [[
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 },
    ]], "c1"); // 40mm — way over glyph scale
    const lone = glyph(70, 70, 4, "c1"); // single glyph — a word needs ≥2
    expect(detectTextClusters([mark, lone]).length).toBe(0);
  });
});

describe("placeManualText", () => {
  const font = loadTtf("Oswald-Medium.ttf");

  it("replaces a named cluster with authored lettering at its position/size", () => {
    const objs = word(10, 20, 4, 5, 1.5, "c1");
    const clusters = detectTextClusters(objs);
    const res = placeManualText({
      assignments: { [clusters[0].id]: "TEST" },
      clusters, objects: objs, font, fontId: "oswald",
    });
    expect(res.placed).toBe(1);
    expect(res.textObjects.length).toBe(1);
    expect(res.textObjects[0].paths.length).toBeGreaterThan(0);
    // The lettering lands over the cluster (centre within a few mm).
    const b = pathsBounds(res.textObjects[0].paths)!;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    expect(Math.abs(cx - clusters[0].cx)).toBeLessThan(3);
    expect(Math.abs(cy - clusters[0].cy)).toBeLessThan(3);
    // Its ink colour is inherited from the traced glyphs.
    expect(res.textObjects[0].colorId).toBe("c1");
  });

  it("leaves an unnamed cluster as the plain trace", () => {
    const objs = word(10, 20, 4, 5, 1.5, "c1");
    const clusters = detectTextClusters(objs);
    const res = placeManualText({ assignments: {}, clusters, objects: objs, font });
    expect(res.placed).toBe(0);
    expect(applyManualText(objs, res)).toBe(objs); // untouched
  });

  it("applyManualText drops the replaced glyphs and appends the lettering", () => {
    const objs = word(10, 20, 4, 5, 1.5, "c1");
    const clusters = detectTextClusters(objs);
    const res = placeManualText({
      assignments: { [clusters[0].id]: "HI" }, clusters, objects: objs, font, fontId: "oswald",
    });
    const out = applyManualText(objs, res);
    // All 4 traced glyph objects removed, 1 lettering object added.
    expect(out.length).toBe(1);
    for (const id of res.removeIds) expect(out.some((o) => o.id === id)).toBe(false);
  });
});

describe("placeGuidedText (keep original letterforms)", () => {
  const font = loadTtf("Oswald-Medium.ttf");

  it("guides each traced letter with its character's font topology, keeping the traced rings", () => {
    // Three letter blocks in a row → detected as one cluster; typed "ABC".
    const objs = word(10, 20, 3, 5, 1.5, "c1");
    const clusters = detectTextClusters(objs);
    expect(clusters.length).toBe(1);
    const res = placeGuidedText({
      assignments: { [clusters[0].id]: "ABC" }, clusters, objects: objs, font, fontId: "oswald",
    });
    expect(res.placed).toBe(1);
    expect(res.textObjects.length).toBe(3); // one guided object per letter
    // Each guided object reuses a TRACED region (original letterform), as satin.
    for (const o of res.textObjects) {
      expect(o.params.fillStyle).toBe("satin");
      expect(o.params.lineArt).toBe(true);
    }
  });

  it("does NOT guess when letter count != character count — leaves the plain trace", () => {
    const objs = word(10, 20, 3, 5, 1.5, "c1"); // 3 letters
    const clusters = detectTextClusters(objs);
    const res = placeGuidedText({
      assignments: { [clusters[0].id]: "HELLO" }, clusters, objects: objs, font, fontId: "oswald",
    });
    expect(res.placed).toBe(0); // 3 regions vs 5 chars → no guess
    expect(applyManualText(objs, res)).toBe(objs);
  });
});

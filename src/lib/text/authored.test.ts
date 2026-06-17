import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Font } from "opentype.js";
import { parseFont } from "./fonts";
import { layoutText } from "./layout";
import { authoredAlphabet } from "./authored";
import { generateDesign } from "../engine";
import { createEmptyProject } from "../project";
import { satinCoverage, medialColumns, columnsFromCenterlines } from "../engine/medial";
import { splitFillRegions } from "../engine/fill";
import type { Path, Point } from "../../types/project";

/** Point halfway along a polyline by arc length (mirrors the engine's matcher). */
function seedMidpoint(cl: Path): Point {
  let total = 0;
  for (let i = 1; i < cl.length; i++) total += Math.hypot(cl[i].x - cl[i - 1].x, cl[i].y - cl[i - 1].y);
  let half = total / 2;
  for (let i = 1; i < cl.length; i++) {
    const s = Math.hypot(cl[i].x - cl[i - 1].x, cl[i].y - cl[i - 1].y);
    if (half <= s) {
      const t = s ? half / s : 0;
      return { x: cl[i - 1].x + (cl[i].x - cl[i - 1].x) * t, y: cl[i - 1].y + (cl[i].y - cl[i - 1].y) * t };
    }
    half -= s;
  }
  return cl[0];
}

/** Even-odd point-in-region (rings = outer + holes), for the coverage assertions. */
function pointInRings(p: Point, rings: Path[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

const here = dirname(fileURLToPath(import.meta.url));
function loadTtf(file: string): Font {
  const buf = readFileSync(join(here, "fonts", file));
  return parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

describe("authored alphabet (flagship Oswald)", () => {
  const oswald = loadTtf("Oswald-Medium.ttf");

  it("registers an alphabet only for the flagship font", () => {
    expect(authoredAlphabet("oswald")).not.toBeNull();
    expect(authoredAlphabet("poppins")).toBeNull();
    expect(authoredAlphabet(undefined)).toBeNull();
  });

  it("attaches satin centerlines to authored glyphs and not to others", () => {
    const a = layoutText({ text: "A", font: oswald, heightMm: 16, colorId: "c1", fontId: "oswald" });
    expect((a.object.satinCenterlines ?? []).length).toBeGreaterThan(0);
    // 'O' is a clean loop — not authored, handled by the auto skeleton.
    const o = layoutText({ text: "O", font: oswald, heightMm: 16, colorId: "c1", fontId: "oswald" });
    expect(o.object.satinCenterlines ?? []).toHaveLength(0);
  });

  it("does NOT author when the font isn't the flagship", () => {
    const a = layoutText({ text: "A", font: oswald, heightMm: 16, colorId: "c1", fontId: "poppins" });
    expect(a.object.satinCenterlines ?? []).toHaveLength(0);
  });

  it("the authored centerlines build a satin that covers the glyph", () => {
    // Each authored seed, snapped to the real outline, must yield columns that
    // cover the letter — the gate the engine uses before preferring them.
    for (const ch of ["A", "W", "K", "V", "N", "X", "Y", "Z", "M"]) {
      const { object } = layoutText({ text: ch, font: oswald, heightMm: 18, colorId: "c1", fontId: "oswald" });
      const region = splitFillRegions(object.paths)[0];
      const seeds = (object.satinCenterlines ?? []).filter((cl) =>
        pointInRings(seedMidpoint(cl), region),
      );
      const cols = columnsFromCenterlines(region, seeds, { density: 0.4, pullScale: 1, cellMm: 0.2 });
      expect(cols.length, `'${ch}' columns`).toBeGreaterThan(0);
      // Column-only coverage; the engine's residual fill closes the rest (W/M
      // valleys are authored short of the junction, so they sit a bit lower).
      expect(satinCoverage(region, cols.map((c) => c.throws)), `'${ch}' coverage`).toBeGreaterThan(0.65);
    }
  });

  it("miters multi-way junctions so columns abut instead of stacking", () => {
    // The multi-way solver runs the dominant stroke THROUGH a junction and abuts
    // the rest, so the strokes shouldn't pile up: the summed per-column footprint
    // should be close to the union (overlap factor near 1), not 1.5–2× (which is
    // what stacking three columns over a junction core looks like).
    const cell = 0.3;
    for (const ch of ["K", "X", "4"]) {
      const { object } = layoutText({ text: ch, font: oswald, heightMm: 18, colorId: "c1", fontId: "oswald" });
      const region = splitFillRegions(object.paths)[0];
      const seeds = (object.satinCenterlines ?? []).filter((cl) => pointInRings(seedMidpoint(cl), region));
      const cols = columnsFromCenterlines(region, seeds, { density: 0.4, pullScale: 1, cellMm: cell });
      const union = satinCoverage(region, cols.map((c) => c.throws), cell);
      const summed = cols.reduce((s, c) => s + satinCoverage(region, [c.throws], cell), 0);
      // summed/union ≈ how many times the average covered cell is stitched.
      expect(summed / Math.max(union, 1e-6), `'${ch}' overlap factor`).toBeLessThan(1.45);
    }
  });

  it("produces a machine-safe stitch-out for an authored word", () => {
    const { object } = layoutText({ text: "MAXWELL", font: oswald, heightMm: 16, colorId: "c1", fontId: "oswald" });
    const design = generateDesign({ ...createEmptyProject(), objects: [object] }, { lockStitches: true });
    expect(design.length).toBeGreaterThan(100);
    let longest = 0;
    for (let i = 1; i < design.length; i++) {
      const a = design[i - 1], b = design[i];
      if (!b.jump && !b.trim && a.colorId === b.colorId) {
        longest = Math.max(longest, Math.hypot(b.x - a.x, b.y - a.y));
      }
    }
    expect(longest).toBeLessThanOrEqual(9.1); // no slash/overshoot
  });

  it("falls back to the auto skeleton, not garbage, when no seeds match", () => {
    // Sanity: a plain authored glyph and its auto version both produce columns.
    const { object } = layoutText({ text: "A", font: oswald, heightMm: 18, colorId: "c1", fontId: "oswald" });
    const region = splitFillRegions(object.paths)[0];
    expect(medialColumns(region, { density: 0.4, pullScale: 1, cellMm: 0.2 }).length).toBeGreaterThan(0);
  });
});

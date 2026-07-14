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

  it("wraps text around a circle centered on the origin (top arc sits above center)", () => {
    const R = 40;
    const top = layoutText({ text: "BADGE", font, heightMm: 8, circleRadiusMm: R, circleSide: "top", colorId: "c1" });
    const b = pathsBounds(top.object.paths)!;
    // Letters sit on a circle of radius ~R about the origin: every point is within
    // a letter-height of R from the centre, and the top arc is above the centre.
    for (const ring of top.object.paths) {
      for (const p of ring) {
        const d = Math.hypot(p.x, p.y);
        expect(d).toBeGreaterThan(R - 10);
        expect(d).toBeLessThan(R + 10);
      }
    }
    expect(b.maxY).toBeLessThan(0); // entirely above the circle centre (y-down)
  });

  it("lays text along an arbitrary path, following its tangent", () => {
    // A 45°-rising straight path: the laid text should rise with it (its bbox is
    // both wide and tall), unlike flat text (wide, short).
    const path = [
      { x: 0, y: 0 },
      { x: 60, y: -60 },
    ];
    const onPath = layoutText({ text: "RISE", font, heightMm: 8, pathMm: path, colorId: "c1" });
    const b = pathsBounds(onPath.object.paths)!;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    // On a 45° path the run is diagonal, so width and height are comparable.
    expect(h).toBeGreaterThan(w * 0.5);
    // Flat "RISE" at the same height is a short wide strip.
    const flat = layoutText({ text: "RISE", font, heightMm: 8, colorId: "c1" });
    const fb = pathsBounds(flat.object.paths)!;
    expect(fb.maxY - fb.minY).toBeLessThan((fb.maxX - fb.minX) * 0.6);
  });

  it("bottom-arc text sits below the centre and reads upright", () => {
    const R = 40;
    const bot = layoutText({ text: "EST", font, heightMm: 8, circleRadiusMm: R, circleSide: "bottom", colorId: "c1" });
    const b = pathsBounds(bot.object.paths)!;
    expect(b.minY).toBeGreaterThan(0); // entirely below the circle centre
    // Upright lower legend: each letter's TOP is nearer the centre than its
    // baseline (tops point inward). The min radius (letter tops) is < the typed
    // baseline radius R, and the max radius (descender side) is ≥ R.
    let minD = Infinity, maxD = 0;
    for (const ring of bot.object.paths) for (const p of ring) {
      const d = Math.hypot(p.x, p.y);
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
    }
    expect(minD).toBeLessThan(R);
    expect(maxD).toBeGreaterThan(R - 1);
  });

  // MACHINE-SAFETY: these numeric fields are user-editable and stored verbatim,
  // so a corrupt file or a half-typed value reaches layoutText. Each once either
  // OOMed (unbounded curve subdivision) or leaked NaN into every coordinate.
  const allFinite = (obj: { paths: { x: number; y: number }[][] }) =>
    obj.paths.every((r) => r.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));

  it("a zero flatten tolerance is floored, not subdivided forever", () => {
    const { object } = layoutText({ text: "Hello", font, heightMm: 10, colorId: "c1", flattenToleranceMm: 0 });
    expect(object.paths.length).toBeGreaterThan(0);
    expect(allFinite(object)).toBe(true);
  });

  it("a NaN height renders finite geometry (does not poison every point)", () => {
    const { object } = layoutText({ text: "Hg", font, heightMm: NaN, colorId: "c1" });
    expect(allFinite(object)).toBe(true);
    expect(object.paths.length).toBeGreaterThan(0);
  });

  it("a NaN line spacing renders finite multiline geometry", () => {
    const { object } = layoutText({ text: "a\nb", font, heightMm: 10, lineSpacing: NaN, colorId: "c1" });
    expect(allFinite(object)).toBe(true);
  });

  it("a NaN letter spacing does not crash or leak NaN", () => {
    const { object } = layoutText({ text: "abc", font, heightMm: 10, letterSpacingMm: NaN, colorId: "c1" });
    expect(allFinite(object)).toBe(true);
  });

  it("a path with a NaN vertex is cleaned, not crashed on", () => {
    const { object } = layoutText({
      text: "run",
      font,
      heightMm: 8,
      colorId: "c1",
      pathMm: [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }],
    });
    expect(allFinite(object)).toBe(true);
  });

  // GEOMETRY QUALITY (not crashes): overset arc text, runaway arch, dead path.
  it("a run too long for the circle packs into the arc instead of overlapping", () => {
    // 20 wide letters on a small radius would sweep ~895° (2.5 turns) and pile
    // multiple glyphs into the same polar sector. They must now compress to fit.
    const { object } = layoutText({ text: "W".repeat(20), font, heightMm: 8, circleRadiusMm: 15, colorId: "c1" });
    // No two glyph-ring centroids share the same narrow sector at the same radius.
    const cents = object.paths.map((r) => {
      let x = 0, y = 0; for (const p of r) { x += p.x; y += p.y; } return { x: x / r.length, y: y / r.length };
    });
    let sameSector = 0;
    for (let i = 0; i < cents.length; i++) for (let j = i + 1; j < cents.length; j++) {
      let da = Math.abs(Math.atan2(cents[i].y, cents[i].x) - Math.atan2(cents[j].y, cents[j].x));
      if (da > Math.PI) da = 2 * Math.PI - da;
      if (da < 0.05 && Math.abs(Math.hypot(cents[i].x, cents[i].y) - Math.hypot(cents[j].x, cents[j].y)) < 3) sameSector++;
    }
    expect(sameSector).toBe(0);
  });

  it("a normal-length circle run is unchanged by the overset guard", () => {
    // Regression: a run that already fits must be byte-identical (k = 1).
    const a = layoutText({ text: "BADGE", font, heightMm: 8, circleRadiusMm: 40, colorId: "c1" });
    const b = pathsBounds(a.object.paths)!;
    // A small sweep (~<180°) stays a normal top arc above the centre.
    expect(b.maxY).toBeLessThan(0);
  });

  it("an arch beyond a full turn is clamped (does not wrap onto itself)", () => {
    // archDeg 720 would wrap the strip twice; it clamps to ≤350°, so its bbox
    // matches the clamped value rather than collapsing into a self-overlap.
    const wild = layoutText({ text: "OVERLAP", font, heightMm: 8, archDeg: 720, colorId: "c1" });
    const clamped = layoutText({ text: "OVERLAP", font, heightMm: 8, archDeg: 350, colorId: "c1" });
    const wb = pathsBounds(wild.object.paths)!;
    const cb = pathsBounds(clamped.object.paths)!;
    expect(wb.maxX - wb.minX).toBeCloseTo(cb.maxX - cb.minX, 3);
    expect(wb.maxY - wb.minY).toBeCloseTo(cb.maxY - cb.minY, 3);
  });

  // PER-GLYPH TWEAKS (glyphTweaks): keyed by VISIBLE glyph index (whitespace
  // excluded), applied in the glyph's LOCAL frame after normal layout.
  describe("glyphTweaks", () => {
    /** rings of one visible glyph, by the layout's own ring ranges. */
    const glyphRings = (res: ReturnType<typeof layoutText>, i: number) => {
      const g = res.glyphs![i];
      return res.object.paths.slice(g.ringStart, g.ringStart + g.ringCount);
    };
    const bboxOf = (rings: { x: number; y: number }[][]) => pathsBounds(rings)!;

    it("absent, empty, and identity tweaks all produce identical output (deep-equal)", () => {
      const opts = { text: "Hi\nthere", font, heightMm: 10, archDeg: 30, colorId: "c1" };
      const a = layoutText(opts);
      const b = layoutText({ ...opts, glyphTweaks: {} });
      const c = layoutText({ ...opts, glyphTweaks: { 0: { dx: 0, dy: 0, rotDeg: 0, scale: 1 } } });
      expect(b.object.paths).toEqual(a.object.paths);
      expect(c.object.paths).toEqual(a.object.paths);
      expect(b.widthMm).toBe(a.widthMm);
      expect(b.glyphs).toEqual(a.glyphs);
    });

    it("dx moves exactly one glyph's bbox by exactly dx along a straight baseline", () => {
      const base = layoutText({ text: "HELLO", font, heightMm: 10, colorId: "c1" });
      const nudged = layoutText({
        text: "HELLO", font, heightMm: 10, colorId: "c1",
        glyphTweaks: { 1: { dx: 2 } },
      });
      const b0 = bboxOf(glyphRings(base, 1));
      const b1 = bboxOf(glyphRings(nudged, 1));
      expect(b1.minX - b0.minX).toBeCloseTo(2, 9);
      expect(b1.maxX - b0.maxX).toBeCloseTo(2, 9);
      expect(b1.minY).toBeCloseTo(b0.minY, 9);
      expect(b1.maxY).toBeCloseTo(b0.maxY, 9);
      // every OTHER glyph is byte-identical
      for (const i of [0, 2, 3, 4]) {
        expect(glyphRings(nudged, i)).toEqual(glyphRings(base, i));
      }
    });

    it("visible-glyph indexing skips whitespace", () => {
      // In "A B", tweak index 1 must move the B (the space renders nothing).
      const base = layoutText({ text: "A B", font, heightMm: 10, colorId: "c1" });
      const nudged = layoutText({
        text: "A B", font, heightMm: 10, colorId: "c1",
        glyphTweaks: { 1: { dx: 3 } },
      });
      expect(base.glyphs!.length).toBe(2);
      expect(glyphRings(nudged, 0)).toEqual(glyphRings(base, 0));
      const b0 = bboxOf(glyphRings(base, 1));
      const b1 = bboxOf(glyphRings(nudged, 1));
      expect(b1.minX - b0.minX).toBeCloseTo(3, 9);
    });

    it("dy on an ARCHED baseline moves the glyph along the local normal, not global y", () => {
      const opts = { text: "ARCH", font, heightMm: 10, archDeg: 90, colorId: "c1" };
      const base = layoutText(opts);
      const bent = layoutText({ ...opts, glyphTweaks: { 0: { dy: 3 } } });
      // Points correspond 1:1; each moves exactly 3mm (a rigid slide along the
      // glyph's local radial normal)…
      const r0 = glyphRings(base, 0);
      const r1 = glyphRings(bent, 0);
      let sumDx = 0;
      let n = 0;
      for (let r = 0; r < r0.length; r++) {
        for (let p = 0; p < r0[r].length; p++) {
          const dx = r1[r][p].x - r0[r][p].x;
          const dy = r1[r][p].y - r0[r][p].y;
          expect(Math.hypot(dx, dy)).toBeCloseTo(3, 6);
          sumDx += dx;
          n++;
        }
      }
      // …and the first glyph of a 90° arch has a clearly tilted normal, so the
      // displacement has a substantial GLOBAL-x component (global y would have 0).
      expect(Math.abs(sumDx / n)).toBeGreaterThan(0.5);
      // untouched glyphs are byte-identical
      for (const i of [1, 2, 3]) expect(glyphRings(bent, i)).toEqual(glyphRings(base, i));
    });

    it("rotDeg rotates rigidly about the glyph's own anchor", () => {
      const base = layoutText({ text: "AB", font, heightMm: 10, colorId: "c1" });
      const rot = layoutText({
        text: "AB", font, heightMm: 10, colorId: "c1",
        glyphTweaks: { 1: { rotDeg: 180 } },
      });
      // A 180° rotation about anchor a maps p → 2a − p, so (p + p′)/2 is the SAME
      // fixed point for every point of the glyph: a single common anchor.
      const r0 = glyphRings(base, 1);
      const r1 = glyphRings(rot, 1);
      const mids: { x: number; y: number }[] = [];
      for (let r = 0; r < r0.length; r++)
        for (let p = 0; p < r0[r].length; p++)
          mids.push({ x: (r0[r][p].x + r1[r][p].x) / 2, y: (r0[r][p].y + r1[r][p].y) / 2 });
      const a = mids[0];
      for (const m of mids) {
        expect(m.x).toBeCloseTo(a.x, 6);
        expect(m.y).toBeCloseTo(a.y, 6);
      }
      // bbox-center distance to the anchor is preserved by the rotation
      const c0 = bboxOf(r0);
      const c1 = bboxOf(r1);
      const d0 = Math.hypot((c0.minX + c0.maxX) / 2 - a.x, (c0.minY + c0.maxY) / 2 - a.y);
      const d1 = Math.hypot((c1.minX + c1.maxX) / 2 - a.x, (c1.minY + c1.maxY) / 2 - a.y);
      expect(d1).toBeCloseTo(d0, 6);
      expect(glyphRings(rot, 0)).toEqual(glyphRings(base, 0));
    });

    it("scale scales the glyph's bbox proportionally, leaving the rest untouched", () => {
      const base = layoutText({ text: "OK", font, heightMm: 10, colorId: "c1" });
      const big = layoutText({
        text: "OK", font, heightMm: 10, colorId: "c1",
        glyphTweaks: { 1: { scale: 1.5 } },
      });
      const b0 = bboxOf(glyphRings(base, 1));
      const b1 = bboxOf(glyphRings(big, 1));
      expect((b1.maxX - b1.minX) / (b0.maxX - b0.minX)).toBeCloseTo(1.5, 6);
      expect((b1.maxY - b1.minY) / (b0.maxY - b0.minY)).toBeCloseTo(1.5, 6);
      expect(glyphRings(big, 0)).toEqual(glyphRings(base, 0));
    });

    it("tweaks apply on circle and path baselines too (rigid 1-glyph move)", () => {
      const circOpts = { text: "BADGE", font, heightMm: 8, circleRadiusMm: 40, colorId: "c1" };
      const c0 = layoutText(circOpts);
      const c1 = layoutText({ ...circOpts, glyphTweaks: { 2: { dy: 2 } } });
      const g0 = glyphRings(c0, 2);
      const g1 = glyphRings(c1, 2);
      for (let r = 0; r < g0.length; r++)
        for (let p = 0; p < g0[r].length; p++) {
          const d = Math.hypot(g1[r][p].x - g0[r][p].x, g1[r][p].y - g0[r][p].y);
          expect(d).toBeCloseTo(2, 6);
        }
      expect(glyphRings(c1, 0)).toEqual(glyphRings(c0, 0));

      const pathOpts = {
        text: "RISE", font, heightMm: 8, colorId: "c1",
        pathMm: [{ x: 0, y: 0 }, { x: 60, y: -60 }],
      };
      const p0 = layoutText(pathOpts);
      const p1 = layoutText({ ...pathOpts, glyphTweaks: { 1: { dx: 1.5 } } });
      const h0 = glyphRings(p0, 1);
      const h1 = glyphRings(p1, 1);
      // dx slides along the 45° tangent: equal global x and y components.
      const ddx = h1[0][0].x - h0[0][0].x;
      const ddy = h1[0][0].y - h0[0][0].y;
      expect(Math.hypot(ddx, ddy)).toBeCloseTo(1.5, 6);
      expect(Math.abs(ddx)).toBeCloseTo(Math.abs(ddy), 6);
      expect(glyphRings(p1, 0)).toEqual(glyphRings(p0, 0));
    });

    it("junk tweak values (NaN, zero scale) degrade to identity, never NaN geometry", () => {
      const base = layoutText({ text: "AB", font, heightMm: 10, colorId: "c1" });
      const junk = layoutText({
        text: "AB", font, heightMm: 10, colorId: "c1",
        glyphTweaks: { 0: { dx: NaN, dy: NaN, rotDeg: NaN, scale: 0 } },
      });
      expect(junk.object.paths).toEqual(base.object.paths);
      expect(allFinite(junk.object)).toBe(true);
    });
  });

  it("a zero-length (all-coincident) path falls back to straight layout, not 0 stitches", () => {
    const { object } = layoutText({
      text: "HELLO", font, heightMm: 10, colorId: "c1",
      pathMm: [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }],
    });
    const b = pathsBounds(object.paths)!;
    expect(b.maxY - b.minY).toBeCloseTo(10, 0); // real letters at the asked height
    expect(b.maxX - b.minX).toBeGreaterThan(10); // a real string width, not collapsed
  });
});

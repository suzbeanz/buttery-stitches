import { describe, it, expect } from "vitest";
import { SVG_CORPUS } from "./svgcorpus";
import { svgShapesToObjects } from "../trace/svgImport";
import { fixStitches } from "../fix";
import { createEmptyProject, parseProject } from "../project";
import { generateDesign } from "../engine";
import { pointInRing } from "../geometry";
import { polygonArea } from "../trace/classify";
import type { EmbObject } from "../../types/project";

/**
 * The vector-import certainty wall. Runs the SVG corpus through the PRODUCT
 * chain — svgShapesToObjects → fixStitches → generateDesign — and asserts the
 * two corruption modes that shipped on a real crest can never return:
 *   1. same-colour overlaps must not punch bare parity holes;
 *   2. stroked linework must sew, not vanish.
 * Plus baseline sanity (coverage, the design is sewable) on every fixture.
 */

function buildDesign(entry: (typeof SVG_CORPUS)[number]) {
  const res = svgShapesToObjects(entry.shapes, {
    contentW: entry.contentW,
    contentH: entry.contentH,
    hoopWmm: 100,
    hoopHmm: 100,
    maxColors: 6,
  });
  const project = fixStitches(
    parseProject({
      ...createEmptyProject(),
      widthMm: 100,
      heightMm: 100,
      colors: res.colors,
      objects: res.objects.map((o) => ({ ...o, visible: true })),
    }),
  );
  const design = generateDesign(project);
  return { res, project, design };
}

/** Fraction of a base fill's interior covered by ANY thread. A real parity hole
 *  is BARE FABRIC — a gap no colour covers — so union coverage catches it, while
 *  legitimate knockdown (a later shape covering part of the base with its own
 *  colour) still reads as covered. Points inside the base's own holes are
 *  excluded (those are meant to be bare). */
function interiorCovered(obj: EmbObject, design: ReturnType<typeof generateDesign>): number {
  const outer = obj.paths.reduce((a, b) => (Math.abs(polygonArea(b)) > Math.abs(polygonArea(a)) ? b : a));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const stitches = design.filter((s) => !s.jump && !s.trim);
  const step = 2;
  let inside = 0, covered = 0;
  for (let y = minY + step; y < maxY; y += step) {
    for (let x = minX + step; x < maxX; x += step) {
      const p = { x, y };
      if (!pointInRing(p, outer)) continue;
      if (obj.paths.length > 1 && obj.paths.some((r) => r !== outer && pointInRing(p, r))) continue;
      inside++;
      for (const s of stitches) {
        if (Math.hypot(s.x - x, s.y - y) <= 1.5) {
          covered++;
          break;
        }
      }
    }
  }
  return inside === 0 ? 1 : covered / inside;
}

describe("SVG import corpus gates (vector certainty wall)", () => {
  for (const entry of SVG_CORPUS) {
    describe(entry.name, () => {
      it("imports, is sewable, and covers its fills (no parity holes)", () => {
        const { res, design } = buildDesign(entry);
        expect(res.objects.length).toBeGreaterThan(0);
        const sewn = design.filter((s) => !s.jump && !s.trim).length;
        expect(sewn).toBeGreaterThan(100);
        // The base fill (the largest object) must be genuinely covered — a
        // parity hole would leave a big bare patch in its interior.
        const base = res.objects.reduce((a, b) => {
          const area = (o: EmbObject) => o.paths.reduce((s, r) => s + Math.abs(polygonArea(r)), 0);
          return area(b) > area(a) ? b : a;
        });
        if (base.type === "fill") {
          expect(interiorCovered(base, design)).toBeGreaterThan(0.9);
        }
      });
    });
  }

  it("keeps same-colour overlapping shapes as separate objects (crest-halves-stripes)", () => {
    const entry = SVG_CORPUS.find((e) => e.name === "crest-halves-stripes")!;
    const res = svgShapesToObjects(entry.shapes, {
      contentW: entry.contentW, contentH: entry.contentH, hoopWmm: 100, hoopHmm: 100, maxColors: 6,
    });
    // The three navy shapes (shield + 2 stripes) stay three objects — merging
    // them would let the stripes carve parity holes through the shield.
    const navy = res.colors.find((c) => c.rgb[2] > 50 && c.rgb[0] < 40)!;
    expect(res.objects.filter((o) => o.colorId === navy.id).length).toBe(3);
  });

  it("imports a stroked arch as a satin element, not nothing (crest-stroked-arch)", () => {
    const entry = SVG_CORPUS.find((e) => e.name === "crest-stroked-arch")!;
    const res = svgShapesToObjects(entry.shapes, {
      contentW: entry.contentW, contentH: entry.contentH, hoopWmm: 100, hoopHmm: 100, maxColors: 4,
    });
    // Shield fill + at least one satin object for the stroke.
    expect(res.objects.some((o) => o.type === "satin")).toBe(true);
  });
});

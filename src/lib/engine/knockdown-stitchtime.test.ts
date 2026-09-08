import { describe, it, expect } from "vitest";
import type { EmbObject, Path, Project } from "../../types/project";
import { createEmptyProject } from "../project";
import { makeObjectFromPaths } from "../objects";
import { generateDesign } from "./index";
import { knockdownPass } from "../fix";
import { buildDensityMap, hotCells } from "./densitymap";

/**
 * A real sew-out JAMMED because of this: SVG import (and any layered drawing)
 * emits shapes in paint order — a red field with a white cross painted over it
 * sews the red at FULL density under the cross, then white (and a blue stripe)
 * on top: two to three stacked full-density layers. The decoded machine file
 * carried ~1,878 red penetrations inside the cross footprint. knockdownPass
 * (the carve-later-fills-out-of-earlier mechanism) existed but ran only from
 * the studio's Clean-up button; export never ran it. It now runs inside
 * generateDesign itself, so every export gets the carve — this test drives the
 * PRODUCT chain (objects → generateDesign) with no fixStitches call.
 */

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

function flagProject(): Project {
  const p = createEmptyProject();
  p.colors = [
    { id: "red", rgb: [200, 16, 46] },
    { id: "white", rgb: [255, 255, 255] },
    { id: "blue", rgb: [0, 32, 91] },
  ];
  // Paint order like the SVG: full red field, then the white cross bars over
  // it, then a narrower blue stripe over the cross — every later fill broad
  // enough to knock down what's beneath.
  p.objects = [
    makeObjectFromPaths("fill", [rect(0, 0, 60, 40)], "red"),
    makeObjectFromPaths("fill", [rect(18, 0, 12, 40)], "white"), // vertical bar
    makeObjectFromPaths("fill", [rect(0, 15, 60, 10)], "white"), // horizontal bar
    makeObjectFromPaths("fill", [rect(21, 0, 6, 40)], "blue"),
    makeObjectFromPaths("fill", [rect(0, 17.5, 60, 5)], "blue"),
  ];
  return p;
}

/** Trap seam the knockdown deliberately leaves under a covering fill. */
const TRAP_MM = 0.35;

/** Is p inside any cross bar, more than `inset` from every bar edge? */
function insideCrossBeyondTrap(p: { x: number; y: number }, inset: number): boolean {
  const bars = [rect(18, 0, 12, 40), rect(0, 15, 60, 10)];
  return bars.some((b) => {
    const x0 = Math.min(...b.map((q) => q.x)) + inset;
    const x1 = Math.max(...b.map((q) => q.x)) - inset;
    const y0 = Math.min(...b.map((q) => q.y)) + inset;
    const y1 = Math.max(...b.map((q) => q.y)) - inset;
    return p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1;
  });
}

describe("knockdown at stitch time (the jammed-flag class)", () => {
  it("red never sews at full density under the white cross on plain export", () => {
    const p = flagProject();
    const design = generateDesign(p);
    const redId = p.objects[0].id;
    const redUnderCross = design.filter(
      (s) =>
        !s.jump && !s.trim && s.objectId === redId && !s.travel &&
        // 2mm in from every bar edge: outside the deliberate trap seam,
        // underlap growth, pull-comp and row-end allowances that legitimately
        // place red within ~1.5mm of the boundary.
        insideCrossBeyondTrap(s, TRAP_MM + 1.65),
    );
    const redTotal = design.filter((s) => !s.jump && !s.trim && s.objectId === redId).length;
    // Before the stitch-time knockdown this was ~28% of the red block (the
    // sewn machine file measured 1,878 of 7,114). A handful of underlay or
    // seam penetrations may graze the inset test; full-density coverage cannot.
    expect(redTotal).toBeGreaterThan(500); // the field genuinely sewed
    expect(redUnderCross.length).toBeLessThan(redTotal * 0.02);
  });

  it("no density danger cells where the layers stack, and white sews after red", () => {
    const p = flagProject();
    const design = generateDesign(p);
    const map = buildDensityMap(design)!;
    const danger = hotCells(map).filter((h) => h.severity >= 1);
    expect(danger).toEqual([]);
    // Sew order: red block entirely before the first white penetration.
    const ids = design.filter((s) => !s.jump && !s.trim).map((s) => s.objectId);
    const lastRed = ids.lastIndexOf(p.objects[0].id);
    const firstWhite = ids.indexOf(p.objects[1].id);
    expect(firstWhite).toBeGreaterThan(lastRed);
  });

  it("a distant later fill never enters the carve (bbox prefilter)", () => {
    const p = createEmptyProject();
    p.colors = [
      { id: "red", rgb: [200, 16, 46] },
      { id: "white", rgb: [255, 255, 255] },
    ];
    // Two motifs far apart: the later white square cannot reach the red one,
    // so the red object must come through the pass by REFERENCE (untouched) —
    // the prefilter drops the distant shape before any raster work.
    p.objects = [
      makeObjectFromPaths("fill", [rect(0, 0, 20, 20)], "red"),
      makeObjectFromPaths("fill", [rect(120, 120, 20, 20)], "white"),
    ];
    const out = knockdownPass(p.objects);
    expect(out[0]).toBe(p.objects[0]);
    expect(out[1]).toBe(p.objects[1]);
  });

  it("an isolated fill is untouched by the pass (no-op guarantee)", () => {
    const p = createEmptyProject();
    p.colors = [{ id: "red", rgb: [200, 16, 46] }];
    p.objects = [makeObjectFromPaths("fill", [rect(0, 0, 30, 20)], "red")];
    const design = generateDesign(p);
    // Every penetration stays inside the drawn rect (plus pull-comp margin).
    const out = design.filter(
      (s) => !s.jump && !s.trim && (s.x < -1 || s.x > 31 || s.y < -1 || s.y > 21),
    );
    expect(out).toEqual([]);
  });
});

/**
 * The jam's SECOND form, from the very next real sew-out attempt: the same flag
 * imported from SVG, whose stroked cross arrived as WIDE SATIN COLUMNS (16.7mm
 * white, 8.4mm navy rails). Satin is exempt from knockdown — a narrow border or
 * letter NEEDS the fill beneath it — so the red field sewed at full density
 * under the white band, and the white band at full width under the navy band:
 * measured 1,694 red penetrations under the white bars and 1,035 white under
 * the navy, three stacked coverage layers at the cross centre. The engine now
 * sews an over-wide satin column as the FILL of its band region, which brings
 * it back inside the knockdown/underlap machinery.
 */
function satinFlagProject(): Project {
  const p = createEmptyProject();
  p.colors = [
    { id: "red", rgb: [186, 12, 47] },
    { id: "white", rgb: [255, 255, 255] },
    { id: "navy", rgb: [0, 32, 91] },
  ];
  const hRails = (y0: number, y1: number): Path[] => [
    [{ x: 4, y: y0 }, { x: 96, y: y0 }],
    [{ x: 4, y: y1 }, { x: 96, y: y1 }],
  ];
  const vRails = (x0: number, x1: number): Path[] => [
    [{ x: x0, y: 16.5 }, { x: x0, y: 83.5 }],
    [{ x: x1, y: 16.5 }, { x: x1, y: 83.5 }],
  ];
  const satin = (paths: Path[], colorId: string): EmbObject => ({
    ...makeObjectFromPaths("satin", paths, colorId),
    params: { density: 0.4, pullComp: 0.2, underlay: true },
  });
  p.objects = [
    { ...makeObjectFromPaths("fill", [rect(4, 16.5, 92, 67)], "red"), params: { density: 0.32, underlay: true } },
    satin(hRails(41.6, 58.4), "white"), // 16.8mm-wide horizontal band
    satin(vRails(29.1, 45.8), "white"), // 16.7mm-wide vertical band
    satin(hRails(45.8, 54.2), "navy"), // 8.4mm navy over the white
    satin(vRails(33.3, 41.6), "navy"),
  ];
  return p;
}

/** Inside any of the given axis-aligned bands, more than `inset` from its edges. */
function insideBands(
  p: { x: number; y: number },
  bands: { x0: number; x1: number; y0: number; y1: number }[],
  inset: number,
): boolean {
  return bands.some(
    (b) => p.x > b.x0 + inset && p.x < b.x1 - inset && p.y > b.y0 + inset && p.y < b.y1 - inset,
  );
}

describe("wide satin bands knock down what they cover (the jammed-flag class, satin form)", () => {
  const whiteBands = [
    { x0: 4, x1: 96, y0: 41.6, y1: 58.4 },
    { x0: 29.1, x1: 45.8, y0: 16.5, y1: 83.5 },
  ];
  const navyBands = [
    { x0: 4, x1: 96, y0: 45.8, y1: 54.2 },
    { x0: 33.3, x1: 41.6, y0: 16.5, y1: 83.5 },
  ];
  const pens = (design: ReturnType<typeof generateDesign>, ids: string[]) =>
    design.filter((s) => !s.jump && !s.trim && !s.travel && ids.includes(s.objectId ?? ""));

  it("the field never sews at full density under a wide satin band", () => {
    const p = satinFlagProject();
    const design = generateDesign(p);
    const red = pens(design, [p.objects[0].id]);
    // Same allowance as the fill-flag test: trap seam + underlap growth +
    // pull-comp legitimately place red within ~2mm of a band edge.
    const buried = red.filter((s) => insideBands(s, whiteBands, TRAP_MM + 1.65));
    expect(red.length).toBeGreaterThan(1000); // the field genuinely sewed
    // Unfixed this was ~25% of the red block (1,694 of 6,729 on the sewn file).
    expect(buried.length).toBeLessThan(red.length * 0.02);
  });

  it("a wide satin band never sews at full width under a wide satin band above it", () => {
    const p = satinFlagProject();
    const design = generateDesign(p);
    const white = pens(design, [p.objects[1].id, p.objects[2].id]);
    const buried = white.filter((s) => insideBands(s, navyBands, TRAP_MM + 1.65));
    expect(white.length).toBeGreaterThan(500);
    // Unfixed this was ~27% of the white (1,035 of 3,886 on the sewn file).
    expect(buried.length).toBeLessThan(white.length * 0.02);
  });

  it("a NARROW satin detail keeps its base fill (the exemption it exists for)", () => {
    const p = createEmptyProject();
    p.colors = [
      { id: "red", rgb: [200, 16, 46] },
      { id: "white", rgb: [255, 255, 255] },
    ];
    // A 3mm satin stripe across a red field: the classic border-on-fill case.
    // Carving the field out from under it would leave bare fabric flanking the
    // column wherever registration shifts — the fill must stay solid beneath.
    p.objects = [
      makeObjectFromPaths("fill", [rect(0, 0, 60, 40)], "red"),
      {
        ...makeObjectFromPaths(
          "satin",
          [
            [{ x: 0, y: 18.5 }, { x: 60, y: 18.5 }],
            [{ x: 0, y: 21.5 }, { x: 60, y: 21.5 }],
          ],
          "white",
        ),
        params: { density: 0.4, pullComp: 0.2 },
      },
    ];
    const design = generateDesign(p);
    const red = pens(design, [p.objects[0].id]);
    const underStripe = red.filter((s) => s.x > 5 && s.x < 55 && s.y > 18.7 && s.y < 21.3);
    // The field sews straight through under the narrow column — a 50×2.6mm
    // window of 0.32mm-row fill holds hundreds of penetrations.
    expect(underStripe.length).toBeGreaterThan(100);
  });
});

import { describe, it, expect } from "vitest";
import type { Project } from "../../types/project";
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

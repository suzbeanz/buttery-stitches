import { describe, it, expect } from "vitest";
import { fixStitches, fixObjectStitches } from "./fix";
import { makeObject, makeObjectFromPaths } from "./objects";
import { createEmptyProject } from "./project";
import type { Path } from "../types/project";

const strokeFill: Path = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 30 },
  { x: 0, y: 30 },
];
const broadFill: Path = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 40 },
  { x: 0, y: 40 },
];

describe("fixObjectStitches", () => {
  it("makes a narrow fill satin and a broad fill tatami", () => {
    expect(fixObjectStitches(makeObjectFromPaths("fill", [strokeFill], "c1")).params.fillStyle).toBe("satin");
    expect(fixObjectStitches(makeObjectFromPaths("fill", [broadFill], "c1")).params.fillStyle).toBe("tatami");
  });

  it("fills a thin (non-round) frame band as contour but a blob-with-a-hole as tatami", () => {
    const sq = (h: number): Path => [
      { x: 50 - h, y: 50 - h },
      { x: 50 + h, y: 50 - h },
      { x: 50 + h, y: 50 + h },
      { x: 50 - h, y: 50 + h },
    ];
    // Wide-walled square frame: 100mm outer, 80mm hole → 10mm wall. Too wide to be
    // a satin column (so the classifier calls it tatami), but still thin relative
    // to its 113mm diameter (<30%) → CONTOUR rows follow the band. A square isn't a
    // recognized circle/ellipse, so this exercises the band test, not shape-recognition.
    const frame = fixObjectStitches(makeObjectFromPaths("fill", [sq(50), sq(40)], "c1"));
    expect(frame.params.fillStyle).toBe("contour");
    // Big square with only a small hole punched in it (a bun with the sausage
    // showing through): the wall is wide → flat tatami, not concentric rings.
    const blob = fixObjectStitches(makeObjectFromPaths("fill", [sq(50), sq(8)], "c1"));
    expect(blob.params.fillStyle).toBe("tatami");
  });

  it("keeps text as satin", () => {
    const o = makeObjectFromPaths("fill", [broadFill], "c1");
    o.text = { content: "Hi", fontId: "x", heightMm: 15, letterSpacingMm: 0 };
    expect(fixObjectStitches(o).params.fillStyle).toBe("satin");
  });

  it("preserves a deliberate decorative fill style (gradient / blend / motif)", () => {
    for (const fillStyle of ["gradient", "blend", "motif"] as const) {
      const o = makeObjectFromPaths("fill", [broadFill], "c1");
      o.params = { ...o.params, fillStyle, blendColorId: "c2" };
      expect(fixObjectStitches(o).params.fillStyle, fillStyle).toBe(fillStyle);
    }
  });

  it("clamps a too-high fill density and turns on underlay", () => {
    const o = makeObjectFromPaths("fill", [broadFill], "c1");
    o.params = { density: 0.1 };
    const fixed = fixObjectStitches(o);
    expect(fixed.params.density).toBeGreaterThanOrEqual(0.35);
    expect(fixed.params.underlay).toBe(true);
  });

  it("clamps running stitch length into a safe range", () => {
    const o = makeObject("running", [{ x: 0, y: 0 }, { x: 50, y: 0 }], "c1");
    o.params = { stitchLength: 20 };
    expect(fixObjectStitches(o).params.stitchLength).toBeLessThanOrEqual(4);
  });
});

describe("fixStitches", () => {
  it("groups objects by color to cut thread changes", () => {
    const p = createEmptyProject();
    const a = makeObject("running", [{ x: 0, y: 0 }, { x: 5, y: 0 }], "red");
    const b = makeObject("running", [{ x: 0, y: 0 }, { x: 5, y: 0 }], "blue");
    const c = makeObject("running", [{ x: 0, y: 0 }, { x: 5, y: 0 }], "red");
    p.objects = [a, b, c];
    const colors = fixStitches(p).objects.map((o) => o.colorId);
    expect(colors).toEqual(["red", "red", "blue"]);
  });

  it("layers fills first, details on top within a color (background → foreground)", () => {
    const p = createEmptyProject();
    const outline = makeObject("running", [{ x: 0, y: 0 }, { x: 5, y: 0 }], "c1");
    const fill = makeObjectFromPaths("fill", [broadFill], "c1");
    p.objects = [outline, fill]; // drawn outline-first
    const types = fixStitches({ ...p, objects: [outline, fill] }).objects.map((o) => o.type);
    expect(types).toEqual(["fill", "running"]); // fill sews before the outline
  });
});

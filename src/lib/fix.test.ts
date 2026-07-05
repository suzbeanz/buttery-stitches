import { describe, it, expect } from "vitest";
import { fixStitches, fixObjectStitches, fixStitchesWithReport } from "./fix";
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
  it("makes a narrow fill satin and leaves a broad fill to the engine auto", () => {
    expect(fixObjectStitches(makeObjectFromPaths("fill", [strokeFill], "c1")).params.fillStyle).toBe("satin");
    expect(fixObjectStitches(makeObjectFromPaths("fill", [broadFill], "c1")).params.fillStyle).toBeUndefined();
  });

  it("fills a thin (non-round) frame band as contour but leaves a blob-with-a-hole unset", () => {
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
    expect(blob.params.fillStyle).toBeUndefined();
  });

  it("leaves a MULTI-region object (a word of letters) unset, not ringy contour", () => {
    // Two separate frame bands in one object — stand-ins for two letters with
    // counters. Each alone would contour, but echoed per region a word comes out
    // ringy/boxy, so a multi-shape object fills solid tatami instead.
    const sq = (cx: number, h: number): Path => [
      { x: cx - h, y: 50 - h },
      { x: cx + h, y: 50 - h },
      { x: cx + h, y: 50 + h },
      { x: cx - h, y: 50 + h },
    ];
    const word = fixObjectStitches(
      makeObjectFromPaths("fill", [sq(30, 16), sq(30, 11), sq(80, 16), sq(80, 11)], "c1"),
    );
    expect(word.params.fillStyle).toBeUndefined();
    // A single band of the same proportions still contours (a lone badge ring).
    const one = fixObjectStitches(makeObjectFromPaths("fill", [sq(50, 16), sq(50, 11)], "c1"));
    expect(one.params.fillStyle).toBe("contour");
  });

  it("leaves a jagged organic band unset, not contour (no topographic scribble)", () => {
    // A traced photo/fur region: a wildly jagged outline (very low circularity)
    // that wraps a hole. The thin-wall test alone would call it a band → contour,
    // turning fur into topographic-map loops. The circularity gate keeps it tatami.
    const star = (rOuter: number, rInner: number, n = 18): Path =>
      Array.from({ length: 2 * n }, (_, i) => {
        const a = (Math.PI * i) / n;
        const r = i % 2 === 0 ? rOuter : rInner;
        return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) };
      });
    const organic = fixObjectStitches(makeObjectFromPaths("fill", [star(40, 16), star(10, 4)], "c1"));
    expect(organic.params.fillStyle).toBeUndefined();
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
    // Clamped up to the dense floor (0.30 mm) — never finer (needle/thread safety).
    expect(fixed.params.density).toBeGreaterThanOrEqual(0.3);
    expect(fixed.params.density).toBeLessThanOrEqual(0.5);
    expect(fixed.params.underlay).toBe(true);
  });

  it("defaults a broad fill dense (0.32) but a line-art outline lighter (0.40)", () => {
    const broad = fixObjectStitches(makeObjectFromPaths("fill", [broadFill], "c1"));
    expect(broad.params.density).toBe(0.32);
    const outline = makeObjectFromPaths("fill", [strokeFill], "c1");
    outline.params = { fillStyle: "satin", lineArt: true, underlay: false };
    expect(fixObjectStitches(outline).params.density).toBe(0.4);
  });

  it("suppresses underlay on a small element but keeps it on a broad one", () => {
    const tiny: Path = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(fixObjectStitches(makeObjectFromPaths("fill", [tiny], "c1")).params.underlay).toBe(false);
    expect(fixObjectStitches(makeObjectFromPaths("fill", [broadFill], "c1")).params.underlay).toBe(true);
    // An explicit user choice is still respected, small or not.
    const forced = makeObjectFromPaths("fill", [tiny], "c1");
    forced.params = { underlay: true };
    expect(fixObjectStitches(forced).params.underlay).toBe(true);
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

  it("traps abutting different-color fills (underneath grows under the top one)", () => {
    const maxX = (rings: Path[]) => Math.max(...rings.flat().map((p) => p.x));
    const left: Path = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 40 }, { x: 0, y: 40 }];
    const right: Path = [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 20, y: 40 }];
    const p = createEmptyProject();
    // "red" is seen first → sews underneath; it abuts "blue" along x=20.
    p.objects = [
      makeObjectFromPaths("fill", [left], "red"),
      makeObjectFromPaths("fill", [right], "blue"),
    ];
    const out = fixStitches(p).objects;
    const red = out.find((o) => o.colorId === "red")!;
    const blue = out.find((o) => o.colorId === "blue")!;
    // The underneath fill now reaches a trap sliver past the seam into the top fill.
    expect(maxX(red.paths)).toBeGreaterThan(20);
    expect(maxX(red.paths)).toBeLessThan(21);
    // The on-top fill is untouched (nothing sits above it).
    expect(maxX(blue.paths)).toBeCloseTo(40, 5);
  });

  it("reports what the clean-up changed", () => {
    const p = createEmptyProject();
    // Two same-color fills drawn out of color-group order with a too-tight density
    // and no fill style — clean-up should set styles, fix density, and report it.
    const a = makeObjectFromPaths("fill", [broadFill], "red");
    a.params = { density: 0.05 };
    const b = makeObjectFromPaths("fill", [broadFill], "blue");
    // A NARROW fill gets its style assigned (→ satin); broad fills stay unset
    // for the engine's auto fill, so they no longer count as a style change.
    const c = makeObjectFromPaths(
      "fill",
      [[{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 30 }, { x: 0, y: 30 }]],
      "red",
    );
    p.objects = [a, b, c];
    const { report } = fixStitchesWithReport(p);
    expect(report.reordered).toBe(true); // the two reds get grouped together
    expect(report.fillStylesSet).toBeGreaterThan(0);
    expect(report.densityFixed).toBeGreaterThan(0);
  });

  it("reports nothing to change for an already-clean design", () => {
    const p = createEmptyProject();
    const clean = fixStitches({ ...p, objects: [makeObjectFromPaths("fill", [broadFill], "c1")] });
    const { report } = fixStitchesWithReport(clean);
    expect(report).toEqual({
      fillStylesSet: 0,
      densityFixed: 0,
      underlayEnabled: 0,
      reordered: false,
      seamsTrapped: 0,
    });
  });

  it("drops a genuine sub-mm speck fill but keeps a real small mark", () => {
    const p = createEmptyProject();
    const speck: Path = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 0.3 },
      { x: 0, y: 0.3 },
    ]; // 0.3 mm tall, ~0.9 mm² → noise
    const realMark: Path = [
      { x: 0, y: 10 },
      { x: 4, y: 10 },
      { x: 4, y: 10.8 },
      { x: 0, y: 10.8 },
    ]; // 0.8 mm tall → a thin but genuine detail, survives
    p.objects = [
      makeObjectFromPaths("fill", [broadFill], "c1"),
      makeObjectFromPaths("fill", [speck], "c1"),
      makeObjectFromPaths("fill", [realMark], "c1"),
    ];
    const out = fixStitches(p).objects;
    expect(out.length).toBe(2); // the speck is gone, the broad fill + real mark remain
  });

  it("leaves an isolated fill untrapped", () => {
    const p = createEmptyProject();
    p.objects = [makeObjectFromPaths("fill", [broadFill], "c1")];
    const out = fixStitches(p).objects;
    // Geometry unchanged: a lone fill has no neighbour to trap against.
    expect(out[0].paths[0]).toBe(broadFill);
    expect(Math.max(...out[0].paths.flat().map((p) => p.x))).toBeCloseTo(40, 5);
  });
});

import type { EmbObject, Path, Point, Project, ThreadColor } from "../../types/project";
import { newId } from "../id";
import { makeObject, makeObjectFromPaths, makeSatinFromRails } from "../objects";
import { shapeRings } from "../shapes";

/**
 * The calibration & capability swatch — one design that both stress-tests every
 * core feature AND carries KNOWN-dimension reference shapes so a single sew-out
 * yields the pull/push-compensation numbers the physics roadmap needs.
 *
 * Sized to FILL a 4×4" (100×100 mm) hoop while still clearing the frame: the
 * design is CENTERED at the hoop middle and packs into a ~78×77 mm envelope, so
 * it reads as a full hoop with an even ~11 mm border on every side. (An earlier
 * build filled 86×88 mm but sat off-center with a ~4 mm bottom margin and a
 * PE550D refused it; a 66 mm build fit but looked lost in the hoop. Big, centered,
 * with a real margin is the sweet spot.)
 *
 * Measure after stitching:
 *  - the satin width ladder (drawn 1/2/3/5/7 mm) → pull-in by column width
 *  - the circle (drawn 24 mm Ø) → directional pull (round vs egg)
 *  - the square (drawn 24 mm) → registration + push/pull both ways
 *  - the 40 mm ruler line → scale + lengthwise push
 *
 * Capability coverage: tatami + contour + directional (field) fills, satin across
 * widths, a hole/counter (ring), sharp corners (star), running + the new tie-in /
 * min-spacing safety on every object, across 6 thread colors (color-change/trim).
 */

const translate = (rings: Path[], dx: number, dy: number): Path[] =>
  rings.map((r) => r.map((p): Point => ({ x: p.x + dx, y: p.y + dy })));

/** A C-shaped band (annular sector) — a curved single-spine region that exercises
 *  the directional/turning fill and inner-curve handling. Opens to the right. */
function cBand(cx: number, cy: number, outerR: number, innerR: number): Path {
  const a0 = (-130 * Math.PI) / 180;
  const a1 = (130 * Math.PI) / 180;
  const n = 28;
  const outer: Point[] = [];
  const inner: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    outer.push({ x: cx + outerR * Math.cos(a), y: cy + outerR * Math.sin(a) });
    inner.push({ x: cx + innerR * Math.cos(a), y: cy + innerR * Math.sin(a) });
  }
  inner.reverse();
  return [...outer, ...inner, outer[0]];
}

/** A vertical satin column of the given width (mm), as a rail pair. */
function satinLadderColumn(cx: number, top: number, bottom: number, widthMm: number, colorId: string): EmbObject {
  const half = widthMm / 2;
  const railA: Path = [{ x: cx - half, y: top }, { x: cx - half, y: bottom }];
  const railB: Path = [{ x: cx + half, y: top }, { x: cx + half, y: bottom }];
  const obj = makeSatinFromRails(railA, railB, colorId);
  obj.name = `Satin ${widthMm}mm`;
  return obj;
}

function withParams(obj: EmbObject, params: EmbObject["params"], name: string): EmbObject {
  obj.params = { ...obj.params, ...params };
  obj.name = name;
  return obj;
}

export function buildTestSwatch(): Project {
  const mk = (rgb: [number, number, number], name: string): ThreadColor => ({ id: newId("color"), rgb, name });
  const ink = mk([20, 20, 20], "Ink");
  const red = mk([196, 40, 40], "Red");
  const blue = mk([40, 80, 180], "Blue");
  const green = mk([40, 150, 70], "Green");
  const purple = mk([130, 70, 160], "Purple");
  const gold = mk([210, 150, 40], "Gold");

  const objects: EmbObject[] = [];

  // --- Top: satin width ladder (1/2/3/5/7 mm), 20 mm tall -----------------
  const ladder: { x: number; w: number }[] = [
    { x: 16, w: 1 }, { x: 32, w: 2 }, { x: 50, w: 3 }, { x: 68, w: 5 }, { x: 84, w: 7 },
  ];
  for (const { x, w } of ladder) objects.push(satinLadderColumn(x, 11, 31, w, ink.id));

  // --- 40 mm reference ruler line (running) -------------------------------
  objects.push(withParams(makeObject("running", [{ x: 30, y: 35 }, { x: 70, y: 35 }], ink.id), {}, "Ruler 40mm"));

  // --- Middle band: measurable fills (Ø24, centers at y=51) ----------------
  // Circle Ø24 (tatami) — round vs egg.
  objects.push(withParams(makeObjectFromPaths("fill", translate(shapeRings("ellipse", { width: 24, height: 24 }), 23, 51), red.id), { fillStyle: "tatami" }, "Circle 24mm"));
  // Square 24 (tatami) — registration.
  objects.push(withParams(makeObjectFromPaths("fill", translate(shapeRings("rectangle", { width: 24, height: 24 }), 50, 51), blue.id), { fillStyle: "tatami" }, "Square 24mm"));
  // Ring Ø24 with a Ø10 counter (hole) — bare-fabric counter.
  const ringOuter = translate(shapeRings("ellipse", { width: 24, height: 24 }), 77, 51)[0];
  const ringHole = translate(shapeRings("ellipse", { width: 10, height: 10 }), 77, 51)[0];
  objects.push(withParams(makeObjectFromPaths("fill", [ringOuter, ringHole], green.id), { fillStyle: "tatami" }, "Ring (counter)"));

  // --- Bottom band: curves, corners, contour, directional (centers at y=77) -
  // Star (5-pt) fill — sharp convex/concave corners.
  objects.push(withParams(makeObjectFromPaths("fill", translate(shapeRings("star", { outerR: 11, innerR: 4.5, points: 5 }), 23, 77), purple.id), { fillStyle: "tatami" }, "Star"));
  // Contour-filled disc Ø22 — echo fill.
  objects.push(withParams(makeObjectFromPaths("fill", translate(shapeRings("ellipse", { width: 22, height: 22 }), 50, 77), gold.id), { fillStyle: "contour" }, "Contour disc"));
  // C-band — directional/turning fill on a curved band (inner-curve test).
  objects.push(withParams(makeObjectFromPaths("fill", [cBand(77, 77, 11, 4.5)], red.id), { fillStyle: "field" }, "Crescent (field)"));

  return {
    version: 1,
    widthMm: 100,
    heightMm: 100,
    hoop: { wMm: 100, hMm: 100, name: '4×4" (100×100)' },
    fabric: "woven",
    threadWeight: 40,
    colors: [ink, red, blue, green, purple, gold],
    objects,
  };
}

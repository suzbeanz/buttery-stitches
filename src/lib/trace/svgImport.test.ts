import { describe, it, expect } from "vitest";
import { svgShapesToObjects, type SvgShape } from "./svgImport";
import { polygonArea } from "./classify";
import { pathsBounds } from "../geometry";

/** A square ring of side `s` at (x,y) in user units. */
function square(x: number, y: number, s: number): SvgShape["rings"][number] {
  return [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
}

describe("svgShapesToObjects", () => {
  it("places shapes in the hoop at exact scaled geometry, one object per colour", () => {
    const shapes: SvgShape[] = [
      { rings: [square(0, 0, 100)], fill: [200, 30, 30] }, // red, fills content
      { rings: [square(20, 20, 20)], fill: [30, 30, 200] }, // blue inset
    ];
    const res = svgShapesToObjects(shapes, { contentW: 100, contentH: 100, hoopWmm: 100, hoopHmm: 100 });
    expect(res.colors.length).toBe(2);
    expect(res.objects.length).toBe(2);
    // Largest area sews first.
    expect(res.colors[0].rgb).toEqual([200, 30, 30]);
    // The red square scaled to fit 92% of the 100mm hoop → ~92mm, centred.
    const red = res.objects.find((o) => o.colorId === res.colors[0].id)!;
    const b = pathsBounds(red.paths)!;
    expect(b.maxX - b.minX).toBeCloseTo(92, 0);
    expect(b.minX).toBeCloseTo(4, 0); // (100 - 92)/2 margin
  });

  it("names colours by hue and keeps distinct fills apart", () => {
    const shapes: SvgShape[] = [
      { rings: [square(0, 0, 50)], fill: [20, 120, 40] },
      { rings: [square(50, 0, 50)], fill: [240, 220, 40] },
    ];
    const res = svgShapesToObjects(shapes, { contentW: 100, contentH: 50, hoopWmm: 100, hoopHmm: 100 });
    const names = res.colors.map((c) => c.name).sort();
    expect(names).toContain("Green");
    expect(names).toContain("Yellow");
  });

  it("reduces the palette to a thread budget by perceptual merge", () => {
    // Three reds (near-duplicates) + one blue → budget 2 folds the reds.
    const shapes: SvgShape[] = [
      { rings: [square(0, 0, 40)], fill: [200, 30, 30] },
      { rings: [square(40, 0, 40)], fill: [206, 34, 28] },
      { rings: [square(80, 0, 40)], fill: [196, 26, 33] },
      { rings: [square(0, 40, 40)], fill: [30, 40, 210] },
    ];
    const res = svgShapesToObjects(shapes, { contentW: 120, contentH: 80, hoopWmm: 100, hoopHmm: 100, maxColors: 2 });
    expect(res.colors.length).toBe(2);
  });

  it("drops sub-minimum specks but keeps real shapes", () => {
    const shapes: SvgShape[] = [
      { rings: [square(0, 0, 100)], fill: [10, 10, 10] },
      { rings: [square(10, 10, 0.3)], fill: [250, 250, 250] }, // ~0.3 units → tiny in mm
    ];
    const res = svgShapesToObjects(shapes, { contentW: 100, contentH: 100, hoopWmm: 100, hoopHmm: 100, minAreaMm2: 1 });
    expect(res.colors.length).toBe(1); // the speck's colour never registers
  });

  it("keeps a hole (inner ring) as part of its shape's object", () => {
    // Outer 80 with a concentric 40 hole → an annulus, one object, net area donut.
    const outer = square(0, 0, 80);
    const hole = square(20, 20, 40);
    const res = svgShapesToObjects([{ rings: [outer, hole], fill: [10, 10, 10] }], {
      contentW: 80, contentH: 80, hoopWmm: 100, hoopHmm: 100,
    });
    expect(res.objects.length).toBe(1);
    expect(res.objects[0].paths.length).toBe(2); // outer + hole both kept
    const areas = res.objects[0].paths.map((r) => Math.abs(polygonArea(r))).sort((a, b) => b - a);
    expect(areas[0]).toBeGreaterThan(areas[1]); // hole smaller than outer
  });

  it("returns empty for no shapes or degenerate content box", () => {
    expect(svgShapesToObjects([], { contentW: 100, contentH: 100, hoopWmm: 100, hoopHmm: 100 }).objects).toHaveLength(0);
    expect(
      svgShapesToObjects([{ rings: [square(0, 0, 10)], fill: [0, 0, 0] }], {
        contentW: 0, contentH: 100, hoopWmm: 100, hoopHmm: 100,
      }).objects,
    ).toHaveLength(0);
  });
});

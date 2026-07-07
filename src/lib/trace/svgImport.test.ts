import { describe, it, expect } from "vitest";
import { svgShapesToObjects, type SvgShape } from "./svgImport";
import { polygonArea } from "./classify";
import { pathsBounds } from "../geometry";

/** A square ring of side `s` at (x,y) in user units. */
function square(x: number, y: number, s: number): SvgShape["rings"][number] {
  return [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
}

describe("svgShapesToObjects", () => {
  it("places shapes in the hoop at exact scaled geometry, one object per shape in document order", () => {
    const shapes: SvgShape[] = [
      { rings: [square(0, 0, 100)], fill: [200, 30, 30] }, // red, fills content
      { rings: [square(20, 20, 20)], fill: [30, 30, 200] }, // blue painted ON TOP
    ];
    const res = svgShapesToObjects(shapes, { contentW: 100, contentH: 100, hoopWmm: 100, hoopHmm: 100 });
    expect(res.colors.length).toBe(2);
    expect(res.objects.length).toBe(2);
    // Document order = paint order = sew order (z-order semantics).
    expect(res.objects[0].colorId).toBe(res.colors.find((c) => c.rgb[0] === 200)!.id);
    expect(res.objects[1].colorId).toBe(res.colors.find((c) => c.rgb[2] === 200)!.id);
    // The red square scaled to fit 92% of the 100mm hoop → ~92mm, centred.
    const b = pathsBounds(res.objects[0].paths)!;
    expect(b.maxX - b.minX).toBeCloseTo(92, 0);
    expect(b.minX).toBeCloseTo(4, 0); // (100 - 92)/2 margin
  });

  it("keeps same-colour OVERLAPPING shapes as separate objects (no parity holes)", () => {
    // A navy shield with two navy stripes painted over it. Merged into one
    // multi-ring object, the stripes would toggle fill parity and punch bare
    // holes through the shield — the corruption that mangled a real crest.
    const shapes: SvgShape[] = [
      { rings: [square(0, 0, 100)], fill: [10, 30, 60] },
      { rings: [square(10, 40, 60)], fill: [10, 30, 60] },
      { rings: [square(30, 20, 60)], fill: [10, 30, 60] },
    ];
    const res = svgShapesToObjects(shapes, { contentW: 100, contentH: 100, hoopWmm: 100, hoopHmm: 100 });
    expect(res.colors.length).toBe(1);
    expect(res.objects.length).toBe(3); // one per shape — parity can't cross shapes
    for (const o of res.objects) expect(o.paths.length).toBe(1);
  });

  it("imports a stroke-only path as a satin column at the stroke width", () => {
    const shapes: SvgShape[] = [
      {
        rings: [],
        fill: [10, 30, 60],
        stroke: { centerlines: [[{ x: 10, y: 50 }, { x: 90, y: 50 }]], widthUnits: 6, closed: [false] },
      },
    ];
    const res = svgShapesToObjects(shapes, { contentW: 100, contentH: 100, hoopWmm: 100, hoopHmm: 100 });
    expect(res.objects.length).toBe(1);
    expect(res.objects[0].type).toBe("satin");
    expect(res.objects[0].paths.length).toBe(2); // left + right rails
    // Rail separation ≈ stroke width scaled to mm (6 units × 0.92 scale).
    const [l, r] = res.objects[0].paths;
    const sep = Math.abs(l[0].y - r[0].y);
    expect(sep).toBeCloseTo(6 * 0.92, 1);
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

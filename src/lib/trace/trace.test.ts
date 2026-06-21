import { describe, it, expect } from "vitest";
import { douglasPeucker } from "./simplify";
import { classifyShape, polygonArea, polygonPerimeter } from "./classify";
import {
  tracedataToObjects,
  imageDataToObjects,
  estimateColorComplexity,
  type Tracedata,
} from "./index";

describe("douglasPeucker", () => {
  it("drops near-collinear points", () => {
    const out = douglasPeucker(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0.01 },
        { x: 2, y: 0 },
        { x: 3, y: 0.01 },
        { x: 4, y: 0 },
      ],
      0.1,
    );
    expect(out).toHaveLength(2);
  });

  it("keeps a real corner", () => {
    const out = douglasPeucker(
      [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
        { x: 4, y: 0 },
      ],
      0.1,
    );
    expect(out).toHaveLength(3);
  });

  it("handles a huge collinear input without recursing or hanging", () => {
    // 50k collinear points collapse to the two endpoints. The iterative version
    // finishes fast; the old recursive one risked a deep stack and a fresh
    // sub-array allocation at every level.
    const pts = Array.from({ length: 50000 }, (_, i) => ({ x: i, y: 0 }));
    const out = douglasPeucker(pts, 0.5);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[1]).toEqual({ x: 49999, y: 0 });
  });
});

describe("classify metrics", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("computes area and perimeter of a closed polygon", () => {
    expect(polygonArea(square)).toBeCloseTo(100);
    expect(polygonPerimeter(square)).toBeCloseTo(40);
  });

  it("calls a blob a fill and a sliver a running stitch", () => {
    expect(classifyShape(square)!.type).toBe("fill");
    const sliver = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 0.5 },
      { x: 0, y: 0.5 },
    ];
    expect(classifyShape(sliver)!.type).toBe("running");
  });

  it("despeckles tiny shapes", () => {
    const tiny = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0, y: 0.5 },
    ];
    expect(classifyShape(tiny, { minAreaMm2: 1 })).toBeNull();
  });
});

// Build a square TracePath from corner coordinates.
function sq(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  isholepath = false,
  holechildren: number[] = [],
) {
  return {
    segments: [
      { type: "L", x1: x0, y1: y0, x2: x1, y2: y0 },
      { type: "L", x1: x1, y1: y0, x2: x1, y2: y1 },
      { type: "L", x1: x1, y1: y1, x2: x0, y2: y1 },
      { type: "L", x1: x0, y1: y1, x2: x0, y2: y0 },
    ],
    isholepath,
    holechildren,
  };
}

describe("tracedataToObjects", () => {
  it("removes the background color and keeps foreground objects", () => {
    const td = {
      width: 100,
      height: 100,
      palette: [
        { r: 255, g: 255, b: 255, a: 255 }, // background (largest)
        { r: 200, g: 20, b: 30, a: 255 }, // a red blob
      ],
      layers: [[sq(0, 0, 100, 100)], [sq(10, 10, 30, 30)]],
    } as unknown as Tracedata;

    const { colors, objects } = tracedataToObjects(td, { mmPerPx: 1 });
    expect(colors).toHaveLength(1); // background dropped
    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe("fill");
    expect(colors[0].rgb).toEqual([200, 20, 30]);
  });

  it("drops a transparent background layer and keeps every brand color", () => {
    // A transparent-PNG logo: a full-canvas transparent layer (the see-through
    // background) plus two opaque brand blobs that don't touch the border. The
    // transparent layer is dropped; neither brand color is mis-dropped.
    const td = {
      width: 100,
      height: 100,
      palette: [
        { r: 0, g: 0, b: 0, a: 0 }, // transparent background (largest area)
        { r: 53, g: 168, b: 84, a: 255 }, // green segment
        { r: 66, g: 133, b: 244, a: 255 }, // blue segment
      ],
      layers: [[sq(0, 0, 100, 100)], [sq(20, 20, 45, 70)], [sq(55, 20, 80, 70)]],
    } as unknown as Tracedata;

    const { colors, objects } = tracedataToObjects(td, { mmPerPx: 1, removeBackground: false });
    expect(colors).toHaveLength(2); // both brand colors survive, transparent dropped
    expect(colors.map((c) => c.rgb)).toEqual([[53, 168, 84], [66, 133, 244]]);
    // No surviving object spans the full canvas (no phantom background fill).
    for (const o of objects) expect(polygonArea(o.paths[0])).toBeLessThan(5000);
  });

  it("keeps a foreground island the SAME color as the background (white ball on white)", () => {
    const td = {
      width: 100,
      height: 100,
      palette: [
        { r: 255, g: 255, b: 255, a: 255 }, // white: the page background AND a ball
        { r: 80, g: 160, b: 60, a: 255 }, // a green field
      ],
      layers: [
        // border-touching background + an interior white island (the "ball")
        [sq(0, 0, 100, 100), sq(44, 44, 58, 52)],
        [sq(20, 20, 80, 80)],
      ],
    } as unknown as Tracedata;

    const { colors, objects } = tracedataToObjects(td, { mmPerPx: 1 });
    // White survives because of its interior island; only the border-touching
    // background region is dropped (not the whole white colour).
    const white = colors.find((c) => c.rgb[0] === 255);
    expect(white, "white kept for the island").toBeDefined();
    const ball = objects.find((o) => o.colorId === white!.id);
    expect(ball, "the white ball is an object").toBeDefined();
    // It's the small island, not the full-page background.
    expect(polygonArea(ball!.paths[0])).toBeLessThan(500);
  });

  it("attaches holes to a fill object (even-odd)", () => {
    const td = {
      width: 100,
      height: 100,
      palette: [
        { r: 0, g: 0, b: 0, a: 255 }, // background
        { r: 10, g: 80, b: 200, a: 255 },
      ],
      layers: [
        [sq(0, 0, 100, 100)],
        // outer with a hole child at index 1
        [sq(10, 10, 50, 50, false, [1]), sq(20, 20, 30, 30, true)],
      ],
    } as unknown as Tracedata;

    const { objects } = tracedataToObjects(td, { mmPerPx: 1 });
    expect(objects).toHaveLength(1);
    expect(objects[0].paths).toHaveLength(2); // outer + hole
  });

  it("groups disjoint fill blobs of one color into a single object", () => {
    const td = {
      width: 100,
      height: 100,
      palette: [
        { r: 255, g: 255, b: 255, a: 255 }, // background
        { r: 30, g: 120, b: 60, a: 255 },
      ],
      layers: [
        [sq(0, 0, 100, 100)],
        // two separate solid squares of the same color
        [sq(10, 10, 30, 30), sq(60, 60, 90, 90)],
      ],
    } as unknown as Tracedata;

    const { colors, objects } = tracedataToObjects(td, { mmPerPx: 1 });
    expect(colors).toHaveLength(1);
    expect(objects).toHaveLength(1); // one fill object, not two
    expect(objects[0].type).toBe("fill");
    expect(objects[0].paths).toHaveLength(2); // both blobs as even-odd rings
  });

  it("separates thin line-art (strokes) from solid blobs within a color", () => {
    const td = {
      width: 100,
      height: 100,
      palette: [
        { r: 255, g: 255, b: 255, a: 255 }, // background
        { r: 0, g: 0, b: 0, a: 255 },
      ],
      layers: [
        [sq(0, 0, 100, 100)],
        // a solid blob (30×30) plus a thin sliver (40×2 ≈ 2mm wide line-art).
        [sq(10, 10, 40, 40), sq(50, 10, 90, 12)],
      ],
    } as unknown as Tracedata;

    const { objects, colors } = tracedataToObjects(td, { mmPerPx: 1 });
    // One colour → a solid fill + a separate stroke object (declared satin so the
    // engine renders it as a line laid over the fill). Strokes sew last (on top).
    expect(colors).toHaveLength(1);
    expect(objects).toHaveLength(2);
    expect(objects.every((o) => o.colorId === objects[0].colorId)).toBe(true);
    const stroke = objects.find((o) => o.params.fillStyle === "satin");
    const fill = objects.find((o) => o.params.fillStyle !== "satin");
    expect(stroke, "thin sliver becomes a stroke").toBeDefined();
    expect(fill, "solid blob stays a fill").toBeDefined();
    expect(objects[objects.length - 1]).toBe(stroke); // stroke last → on top
  });

  it("orders objects largest-area first (details on top)", () => {
    const td = {
      width: 100,
      height: 100,
      palette: [
        { r: 255, g: 255, b: 255, a: 255 }, // background
        { r: 10, g: 10, b: 10, a: 255 }, // small detail
        { r: 200, g: 50, b: 50, a: 255 }, // big area
      ],
      layers: [
        [sq(0, 0, 100, 100)],
        [sq(10, 10, 20, 20)], // 10×10 = 100
        [sq(30, 30, 90, 90)], // 60×60 = 3600
      ],
    } as unknown as Tracedata;

    const { objects } = tracedataToObjects(td, { mmPerPx: 1 });
    expect(objects).toHaveLength(2);
    expect(polygonArea(objects[0].paths[0])).toBeGreaterThan(
      polygonArea(objects[1].paths[0]),
    );
  });

  it("scales pixels to millimeters and offsets", () => {
    const td = {
      width: 10,
      height: 10,
      palette: [
        { r: 255, g: 255, b: 255, a: 255 },
        { r: 1, g: 2, b: 3, a: 255 },
      ],
      layers: [[sq(0, 0, 10, 10)], [sq(0, 0, 4, 4)]],
    } as unknown as Tracedata;

    const { objects } = tracedataToObjects(td, {
      mmPerPx: 0.5,
      offsetX: 100,
      offsetY: 50,
    });
    // a 4px square at 0.5 mm/px => 2 mm square, offset to (100,50). The outline
    // is smoothed (corners round slightly), so allow a sub-mm tolerance.
    const xs = objects[0].paths[0].map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(100, 0);
    expect(Math.max(...xs)).toBeCloseTo(102, 0);
  });
});

describe("imageDataToObjects (real imagetracerjs)", () => {
  // Build a fake ImageData (imagetracerjs only needs width/height/data).
  function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): ImageData {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const [r, g, b] = paint(x, y);
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    return { width: w, height: h, data } as unknown as ImageData;
  }

  it("traces a two-color image into objects", () => {
    const img = image(16, 16, (x) => (x < 8 ? [220, 20, 30] : [20, 60, 200]));
    const { colors, objects } = imageDataToObjects(img, 2, {
      mmPerPx: 1,
      removeBackground: false,
    });
    expect(colors.length).toBeGreaterThanOrEqual(1);
    expect(objects.length).toBeGreaterThanOrEqual(1);
    for (const o of objects) expect(o.paths[0].length).toBeGreaterThanOrEqual(2);
  });

  // Build an RGBA ImageData (paint returns [r,g,b,a]) — a:0 is a see-through pixel.
  function imageRGBA(
    w: number,
    h: number,
    paint: (x: number, y: number) => [number, number, number, number],
  ): ImageData {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const [r, g, b, a] = paint(x, y);
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = a;
      }
    return { width: w, height: h, data } as unknown as ImageData;
  }

  it("does not trace a transparent background as a phantom fill (logo PNG)", () => {
    // A transparent-background logo: two opaque brand blobs floating in see-through
    // space, neither touching the border. Before the fix, ImageTracer snapped the
    // transparent pixels to the nearest brand color and produced a full-canvas
    // phantom fill (and background removal then ate a real color).
    const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0];
    const img = imageRGBA(40, 40, (x, y) => {
      const inGreen = x >= 8 && x < 18 && y >= 8 && y < 32;
      const inBlue = x >= 22 && x < 32 && y >= 8 && y < 32;
      if (inGreen) return [53, 168, 84, 255];
      if (inBlue) return [66, 133, 244, 255];
      return TRANSPARENT;
    });

    const { colors, objects } = imageDataToObjects(img, 2, { mmPerPx: 1 });

    // Both brand colors survive; nothing is lost to a phantom-background drop.
    expect(colors).toHaveLength(2);
    // No object spans the canvas — the see-through background isn't stitched.
    const canvasArea = 40 * 40;
    for (const o of objects) {
      expect(polygonArea(o.paths[0])).toBeLessThan(canvasArea * 0.5);
    }
  });

  it("keeps a small high-contrast feature (a pet's eye) against a dominant field", () => {
    // A 60×60 cream field with a small dark 8×8 spot. Population-based quantizers
    // discard the spot (it's <2% of pixels); ours feeds its palette to the tracer
    // so the dark color survives as its own object — the difference between a
    // portrait with eyes and a featureless blob.
    const img = image(60, 60, (x, y) => {
      const inSpot = x >= 26 && x < 34 && y >= 26 && y < 34;
      return inSpot ? [30, 20, 15] : [230, 210, 175];
    });
    const { colors } = imageDataToObjects(img, 4, { mmPerPx: 1, removeBackground: false });
    const hasDark = colors.some((c) => c.rgb[0] < 90 && c.rgb[1] < 90 && c.rgb[2] < 90);
    expect(hasDark).toBe(true);
  });

  it("estimates higher complexity for noisy images", () => {
    const flat = image(20, 20, () => [100, 100, 100]);
    const noisy = image(20, 20, (x, y) => [(x * 13) % 256, (y * 29) % 256, (x * y) % 256]);
    expect(estimateColorComplexity(noisy)).toBeGreaterThan(estimateColorComplexity(flat));
  });

  it("drops a thin background-color sliver trapped between shapes", () => {
    // Cream field (the background) with a solid blue square in the middle, split by
    // a thin cream bar through its center — the background showing through a gap.
    // With background removal on, the cream field (border) AND the interior cream
    // sliver are dropped, so no cream thread is laid where there should be fabric.
    const img = image(80, 80, (x, y) => {
      const inSquare = x >= 20 && x < 60 && y >= 20 && y < 60;
      const inSliver = x >= 24 && x < 56 && y >= 38 && y < 41;
      return inSquare && !inSliver ? [30, 70, 200] : [235, 225, 200];
    });
    // mmPerPx 0.5 makes the 3-px-tall bar ~1.5 mm wide — a thin sliver, not a fill.
    const { colors } = imageDataToObjects(img, 2, { mmPerPx: 0.5, removeBackground: true });
    // No surviving color is the cream background tint.
    const hasCream = colors.some((c) => c.rgb[0] > 200 && c.rgb[1] > 190 && c.rgb[2] > 160);
    expect(hasCream).toBe(false);
  });

  it("keeps a blobby background-color island (a white ball on a white page)", () => {
    // Cream field with a dark square frame; inside the frame is a solid cream disc.
    // That interior cream blob is a real foreground feature (not a sliver), so it
    // survives background removal even though it matches the background color.
    const img = image(80, 80, (x, y) => {
      const onFrame = x >= 20 && x < 60 && y >= 20 && y < 60 && (x < 26 || x >= 54 || y < 26 || y >= 54);
      return onFrame ? [30, 25, 20] : [235, 225, 200];
    });
    const { colors } = imageDataToObjects(img, 2, { mmPerPx: 1, removeBackground: true });
    const hasCream = colors.some((c) => c.rgb[0] > 200 && c.rgb[1] > 190 && c.rgb[2] > 160);
    expect(hasCream).toBe(true);
  });
});

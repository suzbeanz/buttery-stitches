import { describe, it, expect } from "vitest";
import { douglasPeucker } from "./simplify";
import { classifyShape, polygonArea, polygonPerimeter } from "./classify";
import {
  tracedataToObjects,
  imageDataToObjects,
  estimateColorComplexity,
  suggestColorCount,
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

  it("welds a crescent hole (hugging the outer) so no sub-thread fringe sews", () => {
    // The recurring crest failure: red traces as (full shield) + (left-half
    // hole) whose boundary runs 0.3–0.8 mm inside the outer along the shared
    // perimeter — even-odd then sews an unsewable red crescent around the left
    // side. The weld pass must rebuild the region as JUST the right half.
    const outerPts: [number, number][] = [[10, 10], [90, 10], [90, 90], [10, 90]];
    const holePts: [number, number][] = [[10.5, 10.3], [50, 10.6], [50, 89.5], [10.8, 89.4]];
    const poly = (pts: [number, number][], isholepath = false, holechildren: number[] = []) => ({
      segments: pts.map(([x, y], i) => {
        const [nx, ny] = pts[(i + 1) % pts.length];
        return { type: "L", x1: x, y1: y, x2: nx, y2: ny };
      }),
      isholepath,
      holechildren,
    });
    const td = {
      width: 100,
      height: 100,
      palette: [
        { r: 255, g: 255, b: 255, a: 255 }, // background
        { r: 220, g: 20, b: 60, a: 255 }, // red field with crescent topology
      ],
      layers: [[sq(0, 0, 100, 100)], [poly(outerPts, false, [1]), poly(holePts, true)]],
    } as unknown as Tracedata;

    const { objects } = tracedataToObjects(td, { mmPerPx: 1 });
    const red = objects.find((o) => o.type === "fill");
    expect(red, "red field kept").toBeDefined();
    // Every surviving ring lives right of the divider — no crescent hugging the
    // left perimeter, no hole ring at all (the divider fused into the outline).
    expect(red!.paths.length).toBe(1);
    for (const ring of red!.paths) {
      expect(Math.min(...ring.map((p) => p.x))).toBeGreaterThan(44);
    }
  });

  it("flags a background-coloured HALO ANNULUS as suspect — segregated, never silently dropped", () => {
    // A page halo and a DELIBERATE white rim (a crest's ring) are geometrically
    // identical, so the tracer must not decide alone: the annulus is kept as its
    // OWN object carrying `suspectedBackground` (the dialog offers keep/skip and
    // defaults to skip). Same-coloured real art — the letter island — must land
    // in a separate, UNFLAGGED object. Layer 0 (white): border-touching page
    // (still dropped: unambiguous), the halo annulus, and a letter island.
    const td = {
      width: 100,
      height: 100,
      palette: [
        { r: 255, g: 255, b: 255, a: 255 }, // white: page + halo + lettering
        { r: 20, g: 40, b: 90, a: 255 }, // navy field
      ],
      layers: [
        [
          sq(0, 0, 100, 100), // page (border-touching)
          sq(4, 4, 96, 96, false, [2]), // halo annulus outer…
          sq(8, 8, 92, 92, true), // …and its hole: 16% ink, spans 92% of canvas
          sq(60, 30, 68, 42), // a white letterform inside the design
        ],
        [sq(10, 10, 50, 90)],
      ],
    } as unknown as Tracedata;

    const { colors, objects } = tracedataToObjects(td, { mmPerPx: 1, backgroundRgb: [255, 255, 255] });
    const white = colors.find((c) => c.rgb[0] === 255);
    expect(white, "white colour kept").toBeDefined();
    const flagged = objects.filter((o) => o.suspectedBackground);
    expect(flagged.length).toBe(1); // the halo, present but flagged
    expect(flagged[0].colorId).toBe(white!.id);
    expect(flagged[0].name).toMatch(/background/i);
    const span = (o: (typeof objects)[number]) => {
      const xs = o.paths.flat().map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span(flagged[0])).toBeGreaterThan(80); // it IS the canvas-wide ring
    // The lettering is a separate, unflagged white object — letter-scale only.
    const letterObjs = objects.filter((o) => o.colorId === white!.id && !o.suspectedBackground);
    expect(letterObjs.length).toBeGreaterThan(0);
    for (const o of letterObjs) expect(span(o)).toBeLessThan(30);
    expect(objects.some((o) => o.colorId !== white!.id), "navy field kept").toBe(true);
  });

  it("keeps a COMPACT background-coloured ring (a donut charm is art, not halo)", () => {
    // Same topology as a halo — annulus, background-coloured, hollow — but small:
    // a white ring charm on a navy field. Only canvas-spanning bands are page.
    const td = {
      width: 100,
      height: 100,
      palette: [
        { r: 255, g: 255, b: 255, a: 255 },
        { r: 20, g: 40, b: 90, a: 255 },
      ],
      layers: [
        [sq(0, 0, 100, 100), sq(40, 40, 62, 62, false, [2]), sq(46, 46, 56, 56, true)],
        [sq(10, 10, 90, 90)],
      ],
    } as unknown as Tracedata;
    const { colors, objects } = tracedataToObjects(td, { mmPerPx: 1, backgroundRgb: [255, 255, 255] });
    const white = colors.find((c) => c.rgb[0] === 255);
    expect(white, "white ring charm survives").toBeDefined();
    expect(objects.some((o) => o.colorId === white!.id)).toBe(true);
    // …and it isn't even flagged: only canvas-spanning bands raise suspicion.
    expect(objects.every((o) => !o.suspectedBackground)).toBe(true);
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

  it("returns a BOUNDED result fast on pathological input (hundreds of regions)", () => {
    // A photo / noisy scan shatters into hundreds of tiny regions. The O(n²)
    // polish passes (idealize/stack/underlap) would take minutes and freeze the
    // tab on this — the PATHOLOGICAL_RING_CAP guard skips them. Build a color
    // with ~400 disjoint specks and assert we still return promptly with every
    // speck preserved as a sewable ring (no silent drop, no hang).
    const specks = [];
    for (let i = 0; i < 400; i++) {
      const x = (i % 20) * 5;
      const y = Math.floor(i / 20) * 5;
      specks.push(sq(x, y, x + 3, y + 3));
    }
    const td = {
      width: 100,
      height: 100,
      palette: [
        { r: 255, g: 255, b: 255, a: 255 }, // background
        { r: 40, g: 90, b: 160, a: 255 }, // the shattered color
      ],
      layers: [[sq(0, 0, 100, 100)], specks],
    } as unknown as Tracedata;

    const t0 = performance.now();
    const { objects } = tracedataToObjects(td, { mmPerPx: 1 });
    const ms = performance.now() - t0;
    // Guard trips well under a second; without it this is minutes. Generous
    // ceiling so a slow CI box doesn't flake, but far below the hang.
    expect(ms).toBeLessThan(4000);
    // The whole color is one object (disjoint specks grouped even-odd); every
    // speck survives — the guard skips POLISH, it doesn't drop geometry.
    const total = objects.reduce((s, o) => s + o.paths.length, 0);
    expect(total).toBeGreaterThan(200);
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

  it("keeps a dark subject on a split border — does not drop it as 'background'", () => {
    // A checkerboard's dark tiles form one lattice that touches the border, so
    // the plurality border colour is ~50/50 and the dark ink is really the
    // SUBJECT. Auto background-removal used to delete it (half the design gone).
    // With the dominance gate, a border no single colour owns keeps both colours.
    const checker = image(200, 200, (x, y) =>
      (Math.floor(x / 40) + Math.floor(y / 40)) % 2 === 0 ? [10, 10, 10] : [245, 245, 245],
    );
    const { colors } = imageDataToObjects(checker, 2, { mmPerPx: 0.5 }); // auto bg
    expect(colors.length).toBe(2);
    expect(colors.some((c) => c.rgb[0] < 128)).toBe(true); // dark ink survived
  });

  it("still auto-removes a genuine solid background (logo on white)", () => {
    // A red disc on a fully-white field: the border is 100% white → a real
    // background, still removed (only the disc's colour remains).
    const logo = image(200, 200, (x, y) =>
      Math.hypot(x - 100, y - 100) < 55 ? [200, 30, 30] : [255, 255, 255],
    );
    const { colors } = imageDataToObjects(logo, 2, { mmPerPx: 0.5 }); // auto bg
    expect(colors.every((c) => !(c.rgb[0] > 200 && c.rgb[1] > 200 && c.rgb[2] > 200))).toBe(true);
    expect(colors.some((c) => c.rgb[0] > 150 && c.rgb[1] < 100)).toBe(true); // red kept
  });

  it("names traced objects by colour so the review reads 'Red fill', not 'Fill 1'", () => {
    const img = image(16, 16, (x) => (x < 8 ? [220, 20, 30] : [20, 60, 200]));
    const { objects } = imageDataToObjects(img, 2, { mmPerPx: 1, removeBackground: false });
    // Every object's name carries its hue + role, never the "Fill N" fallback.
    for (const o of objects) {
      expect(o.name).toBeTruthy();
      expect(/^(Fill|Satin|Running) \d+$/.test(o.name!)).toBe(false);
      expect(/\b(fill|outline)\b/.test(o.name!)).toBe(true);
    }
  });

  it("detail level controls despeckling: 'smooth' drops small stray pieces 'detailed' keeps", () => {
    // A red field with several tiny blue specks scattered in it. At 1mm/px each
    // 2×2 speck is ~4mm² — kept at "detailed" (minArea 0.4), dropped at "smooth"
    // (minArea 3). The big red region survives in both.
    const specks = [[4, 4], [10, 4], [4, 10], [10, 10]];
    const img = image(20, 20, (x, y) =>
      specks.some(([sx, sy]) => x >= sx && x < sx + 2 && y >= sy && y < sy + 2) ? [30, 60, 200] : [220, 30, 30],
    );
    const opts = { mmPerPx: 1, removeBackground: false } as const;
    const detailed = imageDataToObjects(img, 2, { ...opts, detail: "detailed" });
    const smooth = imageDataToObjects(img, 2, { ...opts, detail: "smooth" });
    expect(detailed.objects.length).toBeGreaterThan(smooth.objects.length);
  });

  it("classifies a thin connected outline NETWORK as centerline line-art, not a tatami fill", () => {
    // A black picture-frame-with-crossbars (≈2mm walls) on white: one connected,
    // thin-walled, mostly-hollow region → should sew down its medial centerline
    // (fillStyle "satin" + lineArt), NOT as a heavy tatami fill of its silhouette.
    const W = 60, H = 60, t = 2;
    const onWall = (x: number, y: number) =>
      x < t || x >= W - t || y < t || y >= H - t || Math.abs(x - W / 2) < t || Math.abs(y - H / 2) < t;
    const img = image(W, H, (x, y) => (onWall(x, y) ? [10, 10, 10] : [245, 245, 245]));
    const { colors, objects } = imageDataToObjects(img, 2, { mmPerPx: 1, removeBackground: false });
    const black = colors.find((c) => c.rgb[0] < 60);
    expect(black).toBeTruthy();
    const blackObjs = objects.filter((o) => o.colorId === black!.id);
    expect(blackObjs.length).toBeGreaterThan(0);
    expect(blackObjs.some((o) => o.params.fillStyle === "satin" && o.params.lineArt === true)).toBe(true);
    expect(blackObjs.some((o) => o.params.fillStyle === "tatami")).toBe(false);
  });

  it("keeps a SOLID block as a fill (not line-art)", () => {
    const img = image(30, 30, () => [20, 20, 20]); // fully solid, no holes
    const { objects } = imageDataToObjects(img, 2, { mmPerPx: 1, removeBackground: false });
    expect(objects.length).toBeGreaterThanOrEqual(1);
    for (const o of objects) expect(o.params.lineArt).toBeFalsy();
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

  it("keeps all N colors for a logo on a solid OPAQUE background (no starvation)", () => {
    // 64×64 white field with four distinct brand-color blobs. Quantizing to 4 would
    // spend a slot on white and merge two brands into mud; reserving N+1 for the
    // background keeps all four distinct, then drops the white.
    const blobs: [number, number, number, number, [number, number, number]][] = [
      [8, 8, 24, 24, [53, 168, 84]],
      [40, 8, 56, 24, [66, 133, 244]],
      [8, 40, 24, 56, [250, 187, 5]],
      [40, 40, 56, 56, [233, 68, 53]],
    ];
    const img = imageRGBA(64, 64, (x, y) => {
      for (const [x0, y0, x1, y1, c] of blobs)
        if (x >= x0 && x < x1 && y >= y0 && y < y1) return [c[0], c[1], c[2], 255];
      return [255, 255, 255, 255]; // opaque white background
    });

    const { colors } = imageDataToObjects(img, 4, { mmPerPx: 1, removeBackground: true });
    // All four brand colors survive distinctly; white is dropped, not stitched.
    expect(colors).toHaveLength(4);
    const near = (rgb: number[], t: [number, number, number]) =>
      Math.abs(rgb[0] - t[0]) + Math.abs(rgb[1] - t[1]) + Math.abs(rgb[2] - t[2]) < 30;
    for (const brand of blobs.map((b) => b[4])) {
      expect(colors.some((c) => near(c.rgb, brand)), `has ${brand}`).toBe(true);
    }
    expect(colors.some((c) => near(c.rgb, [255, 255, 255])), "white dropped").toBe(false);
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

  describe("suggestColorCount", () => {
    it("suggests the dominant-color count for a flat few-color logo", () => {
      // Three equal vertical bands → three dominant colors.
      const tri = image(60, 30, (x) =>
        x < 20 ? [220, 30, 30] : x < 40 ? [30, 180, 60] : [40, 60, 220],
      );
      expect(suggestColorCount(tri)).toBe(3);
    });

    it("suggests more colors for a busier image than a flatter one", () => {
      const flat = image(40, 40, (x) => (x < 20 ? [10, 10, 10] : [240, 240, 240]));
      const busy = image(40, 40, (x, y) => [(x * 16) % 256, (y * 16) % 256, ((x + y) * 16) % 256]);
      expect(suggestColorCount(busy)).toBeGreaterThan(suggestColorCount(flat));
    });

    it("clamps to the [min, max] bounds", () => {
      const photo = image(60, 60, (x, y) => [(x * 7) % 256, (y * 11) % 256, (x * y * 3) % 256]);
      expect(suggestColorCount(photo, 2, 6)).toBeLessThanOrEqual(6);
      const flat = image(20, 20, () => [128, 128, 128]);
      expect(suggestColorCount(flat, 3, 12)).toBeGreaterThanOrEqual(3);
    });

    it("ignores faint anti-alias fringe (dominant 92% wins)", () => {
      // A two-tone logo where a single row is a noisy 'fringe' — the suggestion
      // should still land at the two dominant colors, not balloon with the fringe.
      const img = image(40, 40, (x, y) => {
        if (y === 0) return [(x * 23) % 256, (x * 51) % 256, (x * 91) % 256]; // 2.5% fringe row
        return x < 20 ? [20, 20, 20] : [230, 230, 230];
      });
      expect(suggestColorCount(img)).toBe(2);
    });
  });

  it("drops a background-color sliver at anti-alias scale, keeps wider light detail", () => {
    // Cream field (the background) with a solid blue square in the middle, split by
    // a HAIRLINE cream bar (~0.5 mm) — edge-fringe scale, dropped. (A WIDER
    // background-coloured stroke is deliberate light detail — white lettering on a
    // white-page source — and must survive; see the lettering test below.)
    const img = image(80, 80, (x, y) => {
      const inSquare = x >= 20 && x < 60 && y >= 20 && y < 60;
      const inSliver = x >= 24 && x < 56 && y >= 39 && y < 40;
      return inSquare && !inSliver ? [30, 70, 200] : [235, 225, 200];
    });
    // mmPerPx 0.5 makes the 1-px bar ~0.5 mm — fringe, not artwork.
    const { colors } = imageDataToObjects(img, 2, { mmPerPx: 0.5, removeBackground: true });
    const hasCream = colors.some((c) => c.rgb[0] > 200 && c.rgb[1] > 190 && c.rgb[2] > 160);
    expect(hasCream).toBe(false);
  });

  it("keeps background-coloured LETTERING (white text on a white-page source)", () => {
    // Blue panel on a white page, with white letter-like bars (~1 mm strokes)
    // inside the panel — a crest's "ST LOUIS". The letters match the page colour
    // but they are artwork: on any garment that isn't white they must sew.
    const img = image(100, 100, (x, y) => {
      const inPanel = x >= 20 && x < 80 && y >= 20 && y < 80;
      if (!inPanel) return [250, 250, 250];
      // three vertical 2-px-wide white bars, 24px tall (letter strokes)
      const inBar = y >= 30 && y < 54 && ((x >= 34 && x < 36) || (x >= 44 && x < 46) || (x >= 54 && x < 56));
      return inBar ? [250, 250, 250] : [30, 70, 200];
    });
    // mmPerPx 0.5 → strokes ~1 mm wide, 12 mm long — thin, but clearly detail.
    const res = imageDataToObjects(img, 2, { mmPerPx: 0.5, removeBackground: true });
    const white = res.colors.find((c) => c.rgb[0] > 200 && c.rgb[1] > 200 && c.rgb[2] > 200);
    expect(white).toBeDefined();
    const obj = res.objects.filter((o) => o.colorId === white!.id);
    expect(obj.length).toBeGreaterThan(0);
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

describe("imageDataToObjects — clipart on a card (the downloaded-image layouts)", () => {
  /** RGBA painter (the shared helper above is opaque-only). */
  function rgbaImage(
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

  /** The golf-flag layout: red flag + yellow pole + green mound + white ball,
   *  on a white card with transparent margins (a typical downloaded clipart). */
  function golfOnCard(x: number, y: number): [number, number, number, number] {
    if (x < 40 || x >= 120) return [0, 0, 0, 0]; // transparent margins
    const inEllipse = (cx: number, cy: number, rx: number, ry: number) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      return dx * dx + dy * dy <= 1;
    };
    if (inEllipse(95, 58, 6, 6)) return [255, 255, 255, 255]; // ball on the green
    if (x >= 62 && x < 66 && y >= 10 && y < 60) return [250, 200, 40, 255]; // pole
    if (x >= 66 && x < 66 + 28 && y >= 10 && y < 30 && (x - 66) < 28 - Math.abs(y - 20) * 2.8)
      return [225, 40, 45, 255]; // flag
    if (inEllipse(80, 60, 35, 14)) return [45, 160, 65, 255]; // green mound
    return [255, 255, 255, 255]; // the white card
  }

  it("strips the card: red and yellow stay distinct (no orange), no giant card fill, ball survives", () => {
    const img = rgbaImage(160, 80, golfOnCard);
    const { colors, objects } = imageDataToObjects(img, 4, { mmPerPx: 0.5, removeBackground: true });
    // The card must not eat a palette slot: red and yellow survive as SEPARATE
    // colors — nothing lands in the orange gap between them.
    const reds = colors.filter((c) => c.rgb[0] > 180 && c.rgb[1] < 110);
    const yellows = colors.filter((c) => c.rgb[0] > 180 && c.rgb[1] > 150 && c.rgb[2] < 120);
    const oranges = colors.filter((c) => c.rgb[0] > 180 && c.rgb[1] >= 110 && c.rgb[1] <= 150);
    expect(reds.length).toBe(1);
    expect(yellows.length).toBe(1);
    expect(oranges.length).toBe(0);
    // The card itself (80×80 px = 40×40 mm = 1600 mm²) must be gone: whatever
    // whites remain (the ball) are small.
    const whiteIds = new Set(
      colors.filter((c) => c.rgb[0] > 200 && c.rgb[1] > 190 && c.rgb[2] > 160).map((c) => c.id),
    );
    const whiteArea = objects
      .filter((o) => whiteIds.has(o.colorId))
      .reduce((s, o) => s + o.paths.reduce((t, p) => t + Math.abs(polygonArea(p)), 0), 0);
    expect(whiteArea).toBeGreaterThan(2); // the ball is there…
    expect(whiteArea).toBeLessThan(120); // …and it is NOT the card
  });

  it("keeps the background's palette slot when the subject touches the image border", () => {
    // Opaque white background; the green mound runs off the left, right AND bottom
    // edges, so white is only ~half the border — the background must still get its
    // own +1 quantization slot, or red and yellow merge to orange.
    // The golf scene on an opaque white page, with the mound stretched off the
    // left/right/bottom borders.
    const withMound = rgbaImage(160, 80, (x, y) => {
      const dx = (x - 80) / 90, dy = (y - 66) / 22;
      if (dx * dx + dy * dy <= 1) {
        const inner = golfOnCard(x, y);
        if (inner[3] === 255 && !(inner[0] === 255 && inner[1] === 255)) return inner;
        return [45, 160, 65, 255];
      }
      const [r, g, b, a] = golfOnCard(x, y);
      return a === 0 ? [255, 255, 255, 255] : [r, g, b, a];
    });
    const { colors } = imageDataToObjects(withMound, 4, { mmPerPx: 0.5, removeBackground: true });
    const reds = colors.filter((c) => c.rgb[0] > 180 && c.rgb[1] < 110);
    const yellows = colors.filter((c) => c.rgb[0] > 180 && c.rgb[1] > 150 && c.rgb[2] < 120);
    const oranges = colors.filter((c) => c.rgb[0] > 180 && c.rgb[1] >= 110 && c.rgb[1] <= 150);
    expect(reds.length).toBe(1);
    expect(yellows.length).toBe(1);
    expect(oranges.length).toBe(0);
  });
});

describe("suggestColorCount — clipart on a card", () => {
  it("counts the subject's colors, not the card, and keeps small features", () => {
    // Transparent margins around a white card holding four colors: a big green
    // field plus a small red mark, a small gold bar, and a dark spot. The card
    // must not count as a color OR dilute the small features out of the count.
    const w = 160, h = 80;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let c: number[] | null = null;
        if (x >= 40 && x < 120) {
          c = [255, 255, 255]; // the card
          if (x >= 50 && x < 110 && y >= 20 && y < 70) c = [50, 150, 60]; // green field
          if (x >= 55 && x < 70 && y >= 25 && y < 35) c = [220, 40, 40]; // red mark
          if (x >= 90 && x < 105 && y >= 25 && y < 32) c = [230, 170, 50]; // gold bar
          if (x >= 70 && x < 80 && y >= 50 && y < 60) c = [25, 60, 30]; // dark spot
        }
        if (c) { data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; }
      }
    const img = { width: w, height: h, data } as unknown as ImageData;
    expect(suggestColorCount(img)).toBe(4);
  });
});

describe("screenshot edge artifacts", () => {
  function image(w: number, h: number, paint: (x: number, y: number) => number[]): ImageData {
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

  it("drops a thin line RUNNING ALONG the image border, keeps one merely touching it", () => {
    // A screenshot border line down the right edge + a real vertical stroke that
    // touches the top border. The frame line is a capture artifact → dropped;
    // the subject stroke stays.
    const img = image(120, 120, (x, y) => {
      if (x >= 117) return [120, 120, 120]; // frame line along the right edge
      if (x >= 40 && x < 44 && y < 90) return [30, 30, 34]; // real stroke touching top
      return [255, 255, 255];
    });
    const { colors, objects } = imageDataToObjects(img, 3, { mmPerPx: 0.5, removeBackground: true });
    // The dark stroke survives…
    const darkId = colors.find((c) => c.rgb[0] < 90)?.id;
    expect(objects.some((o) => o.colorId === darkId)).toBe(true);
    // …and nothing lives at the right edge anymore (the frame line is gone).
    const maxX = Math.max(...objects.flatMap((o) => o.paths.flat().map((p) => p.x)));
    expect(maxX).toBeLessThan(55);
  });
});

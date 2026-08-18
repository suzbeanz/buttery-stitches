import { describe, it, expect } from "vitest";
import { detectLineArt, livePaintObjects } from "./livepaint";
import { corpusImages } from "../bench/imagecorpus";
import { fixStitches } from "../fix";
import { createEmptyProject } from "../project";
import { polygonArea } from "./classify";
import type { Project } from "../../types/project";

/** Build an ImageData-shaped raster from a per-pixel painter. */
function build(
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
  return { width: w, height: h, data } as ImageData;
}

/**
 * The smurf-like fixture: a 2×2 grid of rooms drawn with dark ink walls, rooms
 * colored blue / white / red / blue, plus one deliberately TINY white room and
 * a 1px anti-aliasing-style gap in one wall (the gap-closing must seal it).
 * 480px so no upscale kicks in; at 0.2 mm/px the tiny room is ~5mm².
 */
const INK: [number, number, number, number] = [20, 20, 24, 255];
const BLUE: [number, number, number, number] = [60, 180, 240, 255];
const WHITE: [number, number, number, number] = [252, 252, 252, 255];
const RED: [number, number, number, number] = [210, 20, 45, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

function smurfLike(opts: { gapPx?: number; background?: "transparent" | "white" } = {}): ImageData {
  const { gapPx = 1, background = "transparent" } = opts;
  return build(480, 480, (x, y) => {
    const bg: [number, number, number, number] =
      background === "transparent" ? CLEAR : [255, 255, 255, 255];
    // Outer wall 40..440, 12px thick; cross walls at the midlines.
    const inBox = x >= 40 && x < 440 && y >= 40 && y < 440;
    if (!inBox) return bg;
    const onOuter = x < 52 || x >= 428 || y < 52 || y >= 428;
    const onVert = x >= 234 && x < 246;
    const onHoriz = y >= 234 && y < 246;
    // The anti-aliasing-style break: a small gap in the horizontal wall.
    const inGap = onHoriz && !onVert && x >= 100 && x < 100 + gapPx;
    // A tiny enclosed white room inside the top-left cell (its own ink ring).
    const tinyRing =
      Math.hypot(x - 120, y - 120) <= 22 && Math.hypot(x - 120, y - 120) > 16;
    const tinyInside = Math.hypot(x - 120, y - 120) <= 16;
    if (tinyRing) return INK;
    if ((onOuter || onVert || (onHoriz && !inGap)) && !tinyInside) return INK;
    if (tinyInside) return WHITE;
    const left = x < 240;
    const top = y < 240;
    if (top && left) return BLUE;
    if (top && !left) return WHITE;
    if (!top && left) return RED;
    return BLUE;
  });
}

const MM_PER_PX = 0.2;
const OPTS = { mmPerPx: MM_PER_PX, offsetX: 0, offsetY: 0, removeBackground: true } as const;

describe("livePaintObjects", () => {
  it("splits an outlined drawing into per-face color fills + one ink network sewn last", () => {
    const res = livePaintObjects(smurfLike(), 5, OPTS);
    // Palette: blue, white, red faces + ink — each a distinct thread.
    expect(res.colors.length).toBe(4);
    const names = res.objects.map((o) => o.name);
    expect(names[names.length - 1]).toBe("Ink lines");
    const ink = res.objects[res.objects.length - 1];
    expect(ink.params.lineArt).toBe(true);
    expect(ink.params.fillStyle).toBe("satin");
    expect(ink.type).toBe("fill");
    // Ink colorId is unique to the ink object and its ThreadColor is LAST —
    // that's what keeps the linework last through fixStitches' color grouping.
    expect(res.objects.filter((o) => o.colorId === ink.colorId)).toHaveLength(1);
    expect(res.colors[res.colors.length - 1].id).toBe(ink.colorId);
    // Fills are sorted biggest color first (soft heuristic — the tuck under
    // the ink shifts final ring areas a few percent off the sort key, and the
    // ordering that actually matters is fills-before-ink).
    const fillAreas = res.objects
      .filter((o) => !o.params.lineArt)
      .map((o) => o.paths.reduce((s, r) => s + Math.abs(polygonArea(r)), 0));
    for (let i = 1; i < fillAreas.length; i++)
      expect(fillAreas[i]).toBeLessThanOrEqual(fillAreas[i - 1] * 1.1 + 1e-6);
    // The red room survives as its own color.
    expect(res.colors.some((c) => c.rgb[0] > 170 && c.rgb[1] < 80 && c.rgb[2] < 90)).toBe(true);
  });

  it("seals a small wall gap so rooms don't leak into one another", () => {
    // With the 1px break sealed, the two cells the gap joins keep their own
    // colors: white and red must both survive as distinct fills.
    const res = livePaintObjects(smurfLike({ gapPx: 1 }), 5, OPTS);
    const hasWhite = res.colors.some((c) => c.rgb[0] > 230 && c.rgb[1] > 230 && c.rgb[2] > 230);
    const hasRed = res.colors.some((c) => c.rgb[0] > 170 && c.rgb[1] < 80);
    expect(hasWhite && hasRed).toBe(true);
  });

  it("keeps a small enclosed face (an eye white) as a sewable fill", () => {
    const res = livePaintObjects(smurfLike(), 5, OPTS);
    // The tiny ~16px-radius white disc (~8mm²) must exist inside some white
    // fill object as a ring near (24, 24)mm.
    const whites = res.objects.filter((o) => {
      const c = res.colors.find((cc) => cc.id === o.colorId);
      return c && c.rgb[0] > 230 && c.rgb[1] > 230 && c.rgb[2] > 230;
    });
    const found = whites.some((o) =>
      o.paths.some((ring) => {
        const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
        const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
        const area = Math.abs(polygonArea(ring));
        // r=16px at 0.2mm/px ≈ 3.2mm → ~32mm², plus the under-ink tuck.
        return Math.hypot(cx - 24, cy - 24) < 4 && area > 3 && area < 70;
      }),
    );
    expect(found).toBe(true);
  });

  it("a small bright face inside a dark face sews AFTER it (the highlight-over idiom)", () => {
    // The professional layering (a white sparkle satin-stitched ON TOP of a
    // black eye) falls out of live paint's area-descending fill order: the
    // tiny ink-ringed white disc inside the blue room must belong to an object
    // sewn after the blue face object, so it lands on top.
    const res = livePaintObjects(smurfLike(), 5, OPTS);
    const blueIdx = res.objects.findIndex((o) => {
      const c = res.colors.find((cc) => cc.id === o.colorId);
      return c && c.rgb[2] > 200 && c.rgb[0] < 120;
    });
    const discIdx = res.objects.findIndex((o) => {
      const c = res.colors.find((cc) => cc.id === o.colorId);
      if (!c || c.rgb[0] < 230 || c.rgb[1] < 230 || c.rgb[2] < 230) return false;
      return o.paths.some((ring) => {
        const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
        const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
        return Math.hypot(cx - 24, cy - 24) < 4 && Math.abs(polygonArea(ring)) < 70;
      });
    });
    expect(blueIdx).toBeGreaterThanOrEqual(0);
    expect(discIdx).toBeGreaterThanOrEqual(0);
    expect(discIdx, "highlight object sews after the dark face").toBeGreaterThan(blueIdx);
  });

  it("behaves the same on a transparent and an opaque-white background", () => {
    const a = livePaintObjects(smurfLike({ background: "transparent" }), 5, OPTS);
    const b = livePaintObjects(smurfLike({ background: "white" }), 5, OPTS);
    expect(a.colors.length).toBe(b.colors.length);
    expect(a.objects.length).toBe(b.objects.length);
  });

  it("detects colored (navy) linework and mints the ink thread in that color", () => {
    const navy = build(480, 480, (x, y) => {
      const onFrame =
        x >= 60 && x < 420 && y >= 60 && y < 420 && (x < 74 || x >= 406 || y < 74 || y >= 406);
      const onBar = y >= 233 && y < 247 && x >= 60 && x < 420;
      if (onFrame || onBar) return [22, 32, 82, 255];
      if (x >= 74 && x < 406 && y >= 74 && y < 406) return [250, 250, 250, 255];
      return CLEAR;
    });
    const res = livePaintObjects(navy, 4, OPTS);
    const ink = res.objects[res.objects.length - 1];
    const inkColor = res.colors.find((c) => c.id === ink.colorId)!;
    expect(inkColor.rgb[2]).toBeGreaterThan(inkColor.rgb[0]); // blue-ish ink
    expect(ink.params.lineArt).toBe(true);
  });

  it("returns a degenerate result when there is no dark linework", () => {
    const flat = build(300, 300, () => [240, 200, 60, 255]);
    const res = livePaintObjects(flat, 4, OPTS);
    expect(res.objects.length).toBe(0);
  });
});

describe("detectLineArt", () => {
  it("accepts the smurf-like fixture", () => {
    const det = detectLineArt(smurfLike());
    expect(det.isLineArt).toBe(true);
    expect(det.suggestedColors).toBeGreaterThanOrEqual(4);
  });

  it("accepts exactly the line-art image of the bench corpus, rejecting every other class", () => {
    for (const c of corpusImages()) {
      const det = detectLineArt(c.image as unknown as ImageData);
      expect(det.isLineArt, `${c.name}: ${JSON.stringify(det.stats)}`).toBe(c.name === "line-art");
    }
  });
});

describe("live-paint ordering through fixStitches", () => {
  it("keeps the ink object last (unique last-seen colorId + lineArt rank)", () => {
    const res = livePaintObjects(smurfLike(), 5, OPTS);
    const project: Project = {
      ...createEmptyProject(),
      widthMm: 96,
      heightMm: 96,
      colors: res.colors,
      objects: res.objects,
    };
    const fixed = fixStitches(project);
    const last = fixed.objects[fixed.objects.length - 1];
    expect(last.params.lineArt).toBe(true);
    expect(last.name).toBe("Ink lines");
  });

  it("dropSliverRings spares a detached hairline stroke of a line-art object", () => {
    const res = livePaintObjects(smurfLike(), 5, OPTS);
    const ink = res.objects[res.objects.length - 1];
    // Add a detached 0.4mm-wide, 10mm-long hairline ring (an eyebrow).
    const hairline = [
      { x: 60, y: 60 },
      { x: 70, y: 60 },
      { x: 70, y: 60.4 },
      { x: 60, y: 60.4 },
    ];
    const withHairline = { ...ink, paths: [...ink.paths, hairline] };
    const project: Project = {
      ...createEmptyProject(),
      widthMm: 96,
      heightMm: 96,
      colors: res.colors,
      objects: [...res.objects.slice(0, -1), withHairline],
    };
    const fixed = fixStitches(project);
    const fixedInk = fixed.objects[fixed.objects.length - 1];
    const survives = fixedInk.paths.some(
      (r) => r.length === 4 && Math.abs(polygonArea(r) - 4) < 0.5,
    );
    expect(survives, "hairline ring survives dropSliverRings").toBe(true);
  });
});

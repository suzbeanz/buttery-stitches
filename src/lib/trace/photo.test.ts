import { describe, it, expect } from "vitest";
import { photoStitchObjects, MAX_PENETRATIONS } from "./photo";
import type { EmbObject, Point, ThreadColor } from "../../types/project";

// Build a fake ImageData (photoStitchObjects only needs width/height/data) —
// same pattern as trace.test.ts, so it runs in plain node.
function image(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const o = (y * w + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data } as unknown as ImageData;
}

const black = () => [0, 0, 0] as [number, number, number];
const white = () => [255, 255, 255] as [number, number, number];

/** All penetrations across all objects. */
const allPoints = (objects: EmbObject[]): Point[] => objects.flatMap((o) => o.paths[0]);

/** |dx| of consecutive same-row (same y) penetrations — the local pitch. */
function rowPitches(objects: EmbObject[], yFilter: (y: number) => boolean = () => true): number[] {
  const out: number[] = [];
  for (const o of objects) {
    const pts = o.paths[0];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].y === pts[i - 1].y && yFilter(pts[i].y)) out.push(Math.abs(pts[i].x - pts[i - 1].x));
    }
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Strip the random ids so two runs can be deep-compared (colorId → band index). */
function normalize(res: { colors: ThreadColor[]; objects: EmbObject[] }) {
  const colorIndex = new Map(res.colors.map((c, i) => [c.id, i] as const));
  return {
    colors: res.colors.map(({ rgb, name }) => ({ rgb, name })),
    objects: res.objects.map(({ name, type, paths, params, visible, colorId }) => ({
      name,
      type,
      paths,
      params,
      visible,
      color: colorIndex.get(colorId),
    })),
  };
}

const OPTS = { widthMm: 40, heightMm: 40, rowSpacingMm: 2, minStitchMm: 1, maxStitchMm: 4 };

describe("photoStitchObjects", () => {
  it("solid black: dense serpentine rows at ~min pitch covering the whole area", () => {
    const { colors, objects } = photoStitchObjects(image(10, 10, black), OPTS);
    expect(colors).toHaveLength(1);
    expect(colors[0].rgb).toEqual([0, 0, 0]);
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) {
      expect(o.type).toBe("running");
      expect(o.params).toEqual({ raw: true });
      expect(o.name).toMatch(/^Photo rows — Black \d+$/);
      expect(o.colorId).toBe(colors[0].id);
    }
    // Every stitch on black ground sews at the MIN pitch.
    const pitches = rowPitches(objects);
    expect(pitches.length).toBeGreaterThan(100);
    for (const p of pitches) expect(p).toBeCloseTo(1, 6);
    // Rows cover the fitted 40×40 area, spaced 2 mm apart.
    const pts = allPoints(objects);
    const ys = [...new Set(pts.map((p) => p.y))].sort((a, b) => a - b);
    expect(ys.length).toBe(21); // 0, 2, …, 40
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(0, 6);
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(38);
    expect(ys[0]).toBeCloseTo(0, 6);
    expect(ys[ys.length - 1]).toBeCloseTo(40, 6);
  });

  it("solid white: nothing to sew — zero objects, zero colors", () => {
    const res = photoStitchObjects(image(10, 10, white), OPTS);
    expect(res.objects).toEqual([]);
    expect(res.colors).toEqual([]);
  });

  it("left-black / right-white: stitches only on the left half, at ~min pitch", () => {
    const img = image(10, 10, (x) => (x < 5 ? black() : white()));
    const { objects } = photoStitchObjects(img, OPTS);
    expect(objects.length).toBeGreaterThan(0);
    const pts = allPoints(objects);
    // The black half spans x=0..20 mm; no penetration lands on the white side.
    for (const p of pts) expect(p.x).toBeLessThanOrEqual(20 + 1e-9);
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(17);
    for (const pitch of rowPitches(objects)) expect(pitch).toBeCloseTo(1, 6);
  });

  it("vertical gradient: mean pitch grows from the dark rows to the light rows", () => {
    // Dark at the top → light (but still stitchable, 220/255 < 0.9) at the bottom.
    const img = image(10, 30, (_x, y) => {
      const v = Math.round((y / 29) * 220);
      return [v, v, v];
    });
    const { objects } = photoStitchObjects(img, {
      widthMm: 40,
      heightMm: 120,
      rowSpacingMm: 2,
      minStitchMm: 1,
      maxStitchMm: 4,
    });
    const top = rowPitches(objects, (y) => y < 40);
    const bottom = rowPitches(objects, (y) => y > 80);
    expect(top.length).toBeGreaterThan(0);
    expect(bottom.length).toBeGreaterThan(0);
    expect(mean(bottom)).toBeGreaterThan(mean(top) * 1.5);
    expect(mean(top)).toBeLessThan(1.6); // dark rows near min
  });

  it("2-color mode: two bands, darkest sews first, rows phase-offset by spacing/2", () => {
    // Left half dark (lum 0.2 → band 0), right half mid-gray (lum 0.6 → band 1).
    const img = image(10, 10, (x) => (x < 5 ? [51, 51, 51] : [153, 153, 153]));
    const { colors, objects } = photoStitchObjects(img, { ...OPTS, colors: 2 });
    expect(colors).toHaveLength(2);
    expect(colors[0].rgb).toEqual([0, 0, 0]); // darkest thread first
    expect(colors[1].rgb).toEqual([128, 128, 128]);
    // Objects are ordered darkest band first (no interleaving of color blocks).
    const bandOf = objects.map((o) => (o.colorId === colors[0].id ? 0 : 1));
    expect(bandOf[0]).toBe(0);
    expect([...bandOf].sort((a, b) => a - b)).toEqual(bandOf);
    const darkPts = allPoints(objects.filter((o) => o.colorId === colors[0].id));
    const grayPts = allPoints(objects.filter((o) => o.colorId === colors[1].id));
    expect(darkPts.length).toBeGreaterThan(0);
    expect(grayPts.length).toBeGreaterThan(0);
    // Each band stitches ONLY its own tonal region…
    for (const p of darkPts) expect(p.x).toBeLessThanOrEqual(20 + 1e-9);
    for (const p of grayPts) expect(p.x).toBeGreaterThanOrEqual(20 - 1e-9);
    // …and the gray pass rows sit halfway between the black pass rows.
    for (const p of darkPts) expect((p.y / 2) % 1).toBeCloseTo(0, 6);
    for (const p of grayPts) expect((p.y / 2) % 1).toBeCloseTo(0.5, 6);
  });

  it("is deterministic: two runs produce identical geometry", () => {
    const img = image(12, 12, (x, y) => {
      const v = Math.round(((x + y) / 22) * 230);
      return [v, v, v];
    });
    const a = photoStitchObjects(img, { ...OPTS, colors: 3 });
    const b = photoStitchObjects(img, { ...OPTS, colors: 3 });
    expect(normalize(a)).toEqual(normalize(b));
  });

  it("caps the work at 150k penetrations with a friendly error", () => {
    const img = image(50, 50, black);
    expect(() =>
      photoStitchObjects(img, {
        widthMm: 200,
        heightMm: 200,
        rowSpacingMm: 0.3,
        minStitchMm: 0.3,
        maxStitchMm: 0.3,
      }),
    ).toThrow(/150,000 stitches.*wider row spacing/s);
    expect(MAX_PENETRATIONS).toBe(150_000);
  });
});

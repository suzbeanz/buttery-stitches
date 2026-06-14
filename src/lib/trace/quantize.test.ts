import { describe, it, expect } from "vitest";
import { quantizeImage, medianCut, type RGB, type RasterImage } from "./quantize";

/** Build a RasterImage from a per-pixel painter. */
function image(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number, number],
): RasterImage {
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
  return { width: w, height: h, data };
}

function distinctColors(img: RasterImage): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * 4;
    if (img.data[o + 3] === 0) continue;
    s.add(`${img.data[o]},${img.data[o + 1]},${img.data[o + 2]}`);
  }
  return s;
}

describe("medianCut", () => {
  it("returns the requested number of palette colors", () => {
    const colors: RGB[] = [];
    for (let i = 0; i < 100; i++) colors.push([i * 2, 255 - i, (i * 5) % 256]);
    expect(medianCut(colors, 4)).toHaveLength(4);
  });

  it("separates two clusters into two palette colors", () => {
    const colors: RGB[] = [];
    for (let i = 0; i < 20; i++) colors.push([240, 10, 10]); // red cluster
    for (let i = 0; i < 20; i++) colors.push([10, 10, 240]); // blue cluster
    const pal = medianCut(colors, 2);
    expect(pal).toHaveLength(2);
    // One palette entry is reddish, the other bluish.
    const reddish = pal.some((c) => c[0] > 150 && c[2] < 100);
    const bluish = pal.some((c) => c[2] > 150 && c[0] < 100);
    expect(reddish && bluish).toBe(true);
  });
});

describe("quantizeImage", () => {
  it("reduces a gradient to at most N colors", () => {
    const img = image(32, 32, (x) => [x * 8, 128, 255 - x * 8, 255]);
    const q = quantizeImage(img, 4);
    expect(distinctColors(q).size).toBeLessThanOrEqual(4);
  });

  it("keeps transparent pixels transparent", () => {
    const img = image(8, 8, (x) => (x < 4 ? [200, 0, 0, 255] : [0, 0, 0, 0]));
    const q = quantizeImage(img, 2);
    // A right-side pixel stays transparent.
    const o = (0 * 8 + 6) * 4;
    expect(q.data[o + 3]).toBe(0);
  });

  it("snaps a two-color image cleanly (no fringe)", () => {
    const img = image(16, 16, (x) => (x < 8 ? [220, 20, 30, 255] : [20, 60, 200, 255]));
    const q = quantizeImage(img, 2);
    expect(distinctColors(q).size).toBe(2);
  });
});

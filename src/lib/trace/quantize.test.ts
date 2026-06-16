import { describe, it, expect } from "vitest";
import {
  quantizeImage,
  medianCut,
  kmeansPalette,
  borderBackgroundColor,
  type RGB,
  type RasterImage,
} from "./quantize";

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

describe("kmeansPalette", () => {
  const near = (p: RGB[], r: number, g: number, b: number) =>
    p.some((c) => Math.abs(c[0] - r) < 40 && Math.abs(c[1] - g) < 40 && Math.abs(c[2] - b) < 40);

  it("keeps distinct hues separate even when one color dominates", () => {
    // 90% cream + a little red + a little blue: median-cut tends to merge red &
    // blue under the cream's weight; k-means should keep all three.
    const samples: RGB[] = [];
    for (let i = 0; i < 90; i++) samples.push([245, 238, 200]);
    for (let i = 0; i < 6; i++) samples.push([200, 48, 44]);
    for (let i = 0; i < 6; i++) samples.push([40, 70, 150]);
    const pal = kmeansPalette(samples, 3);
    expect(pal).toHaveLength(3);
    expect(near(pal, 245, 238, 200)).toBe(true);
    expect(near(pal, 200, 48, 44)).toBe(true);
    expect(near(pal, 40, 70, 150)).toBe(true);
  });

  it("is deterministic", () => {
    const samples: RGB[] = Array.from({ length: 50 }, (_, i) => [i * 5, 255 - i * 5, 100] as RGB);
    expect(kmeansPalette(samples, 4)).toEqual(kmeansPalette(samples, 4));
  });
});

describe("borderBackgroundColor", () => {
  it("returns the dominant border color, not the (bigger) center subject", () => {
    // Cream border, a large dark subject filling the middle.
    const img = image(20, 20, (x, y) =>
      x > 4 && x < 16 && y > 4 && y < 16 ? [30, 30, 30, 255] : [245, 238, 200, 255],
    );
    expect(borderBackgroundColor(img)).toEqual([245, 238, 200]);
  });

  it("returns null for a fully transparent border", () => {
    const img = image(8, 8, () => [0, 0, 0, 0]);
    expect(borderBackgroundColor(img)).toBeNull();
  });
});

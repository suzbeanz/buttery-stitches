import { describe, it, expect } from "vitest";
import {
  quantizeImage,
  medianCut,
  kmeansPalette,
  borderBackgroundColor,
  removeInnerBackdrop,
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

  it("majority-filters single-pixel speckle out of a flat field", () => {
    // A 64×64 red field with one lone blue pixel in the interior. The blue speck
    // is outvoted 8:1 by its neighbours, so the cleaned output is solid red — the
    // kind of quantization fleck that would otherwise become its own trimmed region.
    const img = image(64, 64, (x, y) =>
      x === 20 && y === 20 ? [20, 60, 200, 255] : [220, 20, 30, 255],
    );
    const q = quantizeImage(img, 2);
    const o = (20 * 64 + 20) * 4;
    expect([q.data[o], q.data[o + 1], q.data[o + 2]]).toEqual([220, 20, 30]);
  });

  it("preserves a solid block bigger than the filter kernel", () => {
    // A 6×6 blue block survives the majority filter (its interior keeps a blue
    // majority), so genuine detail is not eroded away.
    const img = image(64, 64, (x, y) =>
      x >= 20 && x < 26 && y >= 20 && y < 26 ? [20, 60, 200, 255] : [220, 20, 30, 255],
    );
    const q = quantizeImage(img, 2);
    const o = (22 * 64 + 22) * 4; // center of the block
    expect([q.data[o], q.data[o + 1], q.data[o + 2]]).toEqual([20, 60, 200]);
  });

  it("consolidates a small similar-color island but keeps a high-contrast feature", () => {
    // A light-tan field with two small blobs: a soft-brown one (a shading fleck,
    // close in color) and a near-black one (a feature, like an eye). After cleanup
    // the soft-brown fleck has melted into the tan around it, while the dark blob
    // stays its own color — exactly how consolidation must behave on a face.
    const tan: RGB = [210, 180, 140];
    const soft: RGB = [150, 120, 90]; // ~100 from tan → merges
    const dark: RGB = [30, 25, 20]; // ~250 from tan → preserved
    const inBlob = (x: number, y: number, cx: number, cy: number) =>
      x >= cx && x < cx + 6 && y >= cy && y < cy + 6;
    const img = image(100, 100, (x, y) => {
      if (inBlob(x, y, 20, 20)) return [...soft, 255];
      if (inBlob(x, y, 70, 70)) return [...dark, 255];
      return [...tan, 255];
    });
    const q = quantizeImage(img, 3);
    const at = (x: number, y: number) => {
      const o = (y * 100 + x) * 4;
      return [q.data[o], q.data[o + 1], q.data[o + 2]];
    };
    const field = at(0, 0); // the consolidated tan
    expect(at(22, 22)).toEqual(field); // soft-brown fleck merged into the field
    expect(at(72, 72)).not.toEqual(field); // dark feature preserved
  });

  it("leaves a clean flat-color design untouched", () => {
    // Two large halves: nothing to consolidate, so both colors survive intact —
    // a logo/flat-art import is not altered by the cleanup.
    const img = image(80, 80, (x) => (x < 40 ? [200, 30, 40, 255] : [30, 70, 200, 255]));
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

describe("removeInnerBackdrop", () => {
  const at = (img: RasterImage, x: number, y: number) => {
    const o = (y * img.width + x) * 4;
    return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2], a: img.data[o + 3] };
  };

  /** Clipart-on-a-card: transparent margins, a white card, a green rect subject
   *  with a white island inside it (the classic white-ball-on-a-green). */
  const cardScene = (x: number, y: number): [number, number, number, number] => {
    if (x < 15 || x >= 45) return [0, 0, 0, 0]; // transparent margins
    if (x >= 28 && x < 32 && y >= 18 && y < 22) return [255, 255, 255, 255]; // island
    if (x >= 20 && x < 40 && y >= 10 && y < 30) return [40, 160, 60, 255]; // subject
    return [255, 255, 255, 255]; // the card
  };

  it("strips the card, keeps the subject AND its same-colour interior island", () => {
    const res = removeInnerBackdrop(image(60, 40, cardScene));
    expect(res).not.toBeNull();
    const { image: out, card } = res!;
    expect(card[0]).toBeGreaterThan(250); // the card was the white
    expect(at(out, 17, 2).a).toBe(0); // card pixel → transparent
    expect(at(out, 25, 20).a).toBe(255); // subject survives
    expect(at(out, 30, 20).a).toBe(255); // interior white island survives
    expect(at(out, 5, 5).a).toBe(0); // margins stay transparent
  });

  it("peels a thin frame line first, then the card behind it", () => {
    const framed = image(60, 40, (x, y) => {
      const c = cardScene(x, y);
      if (c[3] === 0) return c;
      // a 2px grey border line around the card, as downloaded images often have
      if (x < 17 || x >= 43 || y < 2 || y >= 38) return [128, 128, 128, 255];
      return c;
    });
    const res = removeInnerBackdrop(framed);
    expect(res).not.toBeNull();
    const { image: out } = res!;
    expect(at(out, 16, 20).a).toBe(0); // frame stripped
    expect(at(out, 20, 20).a).toBe(255); // subject survives (x=20 is subject)
    expect(at(out, 25, 5).a).toBe(0); // card behind the frame stripped too
  });

  it("never strips a transparent-PNG logo's own outer colour", () => {
    // A green disc on transparency — the subject itself meets the transparent
    // border, and its silhouette is not rectangular.
    const logo = image(60, 60, (x, y) => {
      const dx = x - 30, dy = y - 30;
      return dx * dx + dy * dy <= 400 ? [40, 160, 60, 255] : [0, 0, 0, 0];
    });
    expect(removeInnerBackdrop(logo)).toBeNull();
  });

  it("returns null for an opaque border (the opaque-background path handles it)", () => {
    const img = image(40, 40, (x, y) =>
      x >= 10 && x < 30 && y >= 10 && y < 30 ? [200, 40, 40, 255] : [255, 255, 255, 255],
    );
    expect(removeInnerBackdrop(img)).toBeNull();
  });

  it("stops peeling at the card: a rectangular subject layer behind it survives", () => {
    // White card on transparent margins; ON the card a rectangular green field
    // with a red mark inside. Stripping must take the card and STOP — the green
    // field is the subject (it is rectangular and dominates the new boundary,
    // but the card was the first LARGE strip).
    const img = image(60, 40, (x, y) => {
      if (x < 15 || x >= 45) return [0, 0, 0, 0];
      if (x >= 22 && x < 26 && y >= 16 && y < 20) return [220, 40, 40, 255]; // red mark
      if (x >= 19 && x < 41 && y >= 8 && y < 32) return [40, 160, 60, 255]; // green field
      return [255, 255, 255, 255]; // the card
    });
    const res = removeInnerBackdrop(img);
    expect(res).not.toBeNull();
    const { image: out } = res!;
    expect(at(out, 16, 3).a).toBe(0); // card stripped
    expect(at(out, 20, 10).a).toBe(255); // green field survives
    expect(at(out, 23, 17).a).toBe(255); // red mark survives
  });

  it("leaves a solid one-colour rectangle alone — it IS the subject, not a card", () => {
    const img = image(60, 40, (x) => (x < 15 || x >= 45 ? [0, 0, 0, 0] : [40, 80, 200, 255]));
    expect(removeInnerBackdrop(img)).toBeNull();
  });
});

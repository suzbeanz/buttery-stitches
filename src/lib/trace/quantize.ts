/**
 * Median-cut color quantization. The raster segmentation pre-pass for
 * auto-digitize: it flattens a photo/logo to a clean N-color palette BEFORE
 * tracing, so each color becomes a solid region instead of a haze of
 * anti-aliasing slivers. Pure — operates on raw pixel buffers, no DOM — so it is
 * unit-testable in node.
 */

export type RGB = [number, number, number];

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA bytes, length = width*height*4. */
  data: Uint8ClampedArray;
}

export interface QuantizedImage extends RasterImage {
  palette: RGB[];
}

/** Below this alpha a pixel is treated as transparent and left untouched. */
const ALPHA_CUTOFF = 128;

/** Average color of a box of colors. */
function averageColor(box: RGB[]): RGB {
  let r = 0,
    g = 0,
    b = 0;
  for (const c of box) {
    r += c[0];
    g += c[1];
    b += c[2];
  }
  const k = box.length || 1;
  return [Math.round(r / k), Math.round(g / k), Math.round(b / k)];
}

/**
 * Median-cut: repeatedly split the color box with the widest channel at that
 * channel's median until there are `numColors` boxes, then average each box.
 * Deterministic for a given input.
 */
export function medianCut(colors: RGB[], numColors: number): RGB[] {
  if (colors.length === 0) return [[0, 0, 0]];
  const target = Math.max(1, numColors);
  const boxes: RGB[][] = [colors.map((c) => c)];

  while (boxes.length < target) {
    let bestBox = -1;
    let bestRange = -1;
    let bestChannel = 0;
    boxes.forEach((box, idx) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255;
        let hi = 0;
        for (const c of box) {
          if (c[ch] < lo) lo = c[ch];
          if (c[ch] > hi) hi = c[ch];
        }
        const range = hi - lo;
        if (range > bestRange) {
          bestRange = range;
          bestBox = idx;
          bestChannel = ch;
        }
      }
    });
    if (bestBox < 0) break; // nothing left to split

    const box = boxes[bestBox];
    box.sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = box.length >> 1;
    boxes.splice(bestBox, 1, box.slice(0, mid), box.slice(mid));
  }

  return boxes.map(averageColor);
}

/** Nearest palette color to (r,g,b) by squared Euclidean distance. */
function nearest(palette: RGB[], r: number, g: number, b: number): RGB {
  let best = palette[0];
  let bd = Infinity;
  for (const c of palette) {
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/**
 * Flatten an image to `numColors` solid colors. Opaque pixels are snapped to the
 * nearest palette color; transparent pixels are left transparent. Returns a NEW
 * buffer plus the palette.
 */
export function quantizeImage(img: RasterImage, numColors: number): QuantizedImage {
  const { width, height, data } = img;
  const n = Math.max(2, Math.min(64, Math.floor(numColors)));
  const total = width * height;

  // Sample opaque colors (cap the count so large images stay fast).
  const step = Math.max(1, Math.floor(total / 20000));
  const samples: RGB[] = [];
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (data[o + 3] < ALPHA_CUTOFF) continue;
    samples.push([data[o], data[o + 1], data[o + 2]]);
  }
  const palette = medianCut(samples, n);

  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (data[o + 3] < ALPHA_CUTOFF) {
      out[o + 3] = 0;
      continue;
    }
    const [r, g, b] = nearest(palette, data[o], data[o + 1], data[o + 2]);
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return { width, height, data: out, palette };
}

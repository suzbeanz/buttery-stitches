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

/** Squared RGB distance. */
function dist2(a: RGB, r: number, g: number, b: number): number {
  return (a[0] - r) ** 2 + (a[1] - g) ** 2 + (a[2] - b) ** 2;
}

/**
 * k-means color palette (Lloyd's algorithm) with a deterministic, well-spread
 * seeding: start from the overall mean, then repeatedly add the sample farthest
 * from the chosen centers (k-means++ greedy). This separates distinct hues a
 * dominant background would otherwise starve under plain median-cut — e.g. a red
 * mark and a blue mark on cream stay red and blue instead of merging to mud.
 */
export function kmeansPalette(samples: RGB[], numColors: number, iters = 12): RGB[] {
  const k = Math.max(1, numColors);
  if (samples.length <= k) return samples.map((c) => [...c] as RGB);

  // --- seed: mean, then farthest-point (greedy k-means++) ---
  const centers: RGB[] = [averageColor(samples)];
  while (centers.length < k) {
    let far: RGB = samples[0];
    let farD = -1;
    for (const s of samples) {
      let md = Infinity;
      for (const c of centers) md = Math.min(md, dist2(c, s[0], s[1], s[2]));
      if (md > farD) {
        farD = md;
        far = s;
      }
    }
    if (farD <= 0) break; // no distinct colors left
    centers.push([...far] as RGB);
  }

  // --- Lloyd iterations ---
  for (let it = 0; it < iters; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]); // r,g,b,count
    for (const s of samples) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(centers[c], s[0], s[1], s[2]);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      const acc = sum[bi];
      acc[0] += s[0];
      acc[1] += s[1];
      acc[2] += s[2];
      acc[3]++;
    }
    let moved = 0;
    for (let c = 0; c < centers.length; c++) {
      const acc = sum[c];
      if (acc[3] === 0) continue; // keep an empty cluster's center
      const nc: RGB = [
        Math.round(acc[0] / acc[3]),
        Math.round(acc[1] / acc[3]),
        Math.round(acc[2] / acc[3]),
      ];
      moved += Math.abs(nc[0] - centers[c][0]) + Math.abs(nc[1] - centers[c][1]) + Math.abs(nc[2] - centers[c][2]);
      centers[c] = nc;
    }
    if (moved === 0) break; // converged
  }
  return centers;
}

/**
 * The most common opaque color along the image's outer border — a far more
 * robust "background" guess than "largest area" (a subject can be the biggest
 * region without being the background). Returns null for a fully transparent
 * border. Best run on the quantized raster so border pixels are palette colors.
 */
export function borderBackgroundColor(img: RasterImage): RGB | null {
  const { width, height, data } = img;
  if (width < 2 || height < 2) return null;
  const counts = new Map<number, number>();
  const tally = (x: number, y: number) => {
    const o = (y * width + x) * 4;
    if (data[o + 3] < ALPHA_CUTOFF) return;
    const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < width; x++) {
    tally(x, 0);
    tally(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tally(0, y);
    tally(width - 1, y);
  }
  let bestKey = -1;
  let bestN = 0;
  for (const [key, n] of counts) {
    if (n > bestN) {
      bestN = n;
      bestKey = key;
    }
  }
  if (bestKey < 0) return null;
  return [(bestKey >> 16) & 255, (bestKey >> 8) & 255, bestKey & 255];
}

/**
 * Is the image's background transparent? True when a majority of the outer-border
 * pixels are below the alpha cutoff (the common transparent-PNG logo). Used to
 * give the tracer a transparent palette slot so the see-through background doesn't
 * snap to the nearest brand colour and trace as a phantom full-canvas fill.
 */
export function borderIsTransparent(img: RasterImage): boolean {
  const { width, height, data } = img;
  if (width < 2 || height < 2) return false;
  let transparent = 0;
  let total = 0;
  const tally = (x: number, y: number) => {
    total++;
    if (data[(y * width + x) * 4 + 3] < ALPHA_CUTOFF) transparent++;
  };
  for (let x = 0; x < width; x++) {
    tally(x, 0);
    tally(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tally(0, y);
    tally(width - 1, y);
  }
  return total > 0 && transparent * 2 > total;
}

/** Nearest palette color to (r,g,b) by squared Euclidean distance. */
/** Index of the palette color closest (squared RGB distance) to (r,g,b). */
function nearestIndex(palette: RGB[], r: number, g: number, b: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i];
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
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
  // k-means gives tighter, better-separated clusters than median-cut when a
  // background dominates the pixel count (the common logo-on-white case).
  const palette = kmeansPalette(samples, n);

  // Assign every pixel its nearest palette index (−1 = transparent).
  const labels = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    labels[i] = data[o + 3] < ALPHA_CUTOFF ? -1 : nearestIndex(palette, data[o], data[o + 1], data[o + 2]);
  }

  // Denoise the label map before tracing. Photographic input quantizes to a haze
  // of single-pixel speckle and pinholes along edges; each isolated fleck becomes
  // its own region that the engine must trim to reach (a pro consolidates shapes,
  // so its files carry almost no trims). A 3×3 majority filter erases that speckle
  // and bridges 1-pixel gaps WITHOUT eroding genuine detail — any feature wider
  // than ~2 px survives — so same-color regions stop fragmenting. Skip on small
  // rasters, where a pixel can be a real feature.
  if (width >= 64 && height >= 64) {
    majorityFilter(labels, width, height);
    // Then consolidate fragments into clean shapes. A professional digitizer draws
    // a subject as a few contiguous color areas, so their files carry almost no
    // trims; an auto-trace of a photo shatters each color into dozens of little
    // islands separated by shading, and the engine must trim to hop between them.
    // Dissolve every small same-color island into the color that surrounds it —
    // merging the fragments (coverage stays solid) instead of leaving holes — so
    // the trace lands as a handful of broad regions, the way a pro would build it.
    consolidateRegions(labels, width, height, palette);
  }

  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const li = labels[i];
    if (li < 0) {
      out[o + 3] = 0;
      continue;
    }
    const [r, g, b] = palette[li];
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return { width, height, data: out, palette };
}

/**
 * In-place 3×3 majority (mode) filter over a palette-index label map. Each opaque
 * pixel is replaced by the most common label among itself and its 8 neighbours;
 * ties and all-transparent neighbourhoods keep the original. Reads from a snapshot
 * so the pass is order-independent. Removes salt-and-pepper quantization speckle
 * and seals pinholes — the chief source of same-color region fragmentation —
 * while leaving any shape thicker than one pixel intact. Transparent pixels (−1)
 * are never filled in, so the alpha silhouette is preserved.
 */
function majorityFilter(labels: Int16Array, width: number, height: number): void {
  const src = labels.slice();
  const count = new Map<number, number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (src[i] < 0) continue; // leave transparent pixels transparent
      count.clear();
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const l = src[yy * width + xx];
          if (l < 0) continue;
          count.set(l, (count.get(l) ?? 0) + 1);
        }
      }
      let best = src[i];
      let bestN = count.get(best) ?? 0;
      for (const [l, c] of count) {
        if (c > bestN) {
          bestN = c;
          best = l;
        }
      }
      labels[i] = best;
    }
  }
}

/** Same-color islands smaller than this fraction of the opaque area are dissolved
 *  into the color around them. ~0.4% turns a shattered photo into a handful of
 *  broad regions (pro-style) while keeping anything a viewer would read as a
 *  distinct feature — an eye, a nose, a logo mark on a large design. */
const CONSOLIDATE_AREA_FRACTION = 0.004;
/** Never dissolve an island bigger than this many pixels, however large the image
 *  (so on a huge raster a genuine mid-size shape is always kept). */
const CONSOLIDATE_AREA_CAP_PX = 20000;
/** Only dissolve an island into a surrounding color this close (squared RGB
 *  distance). Shading variants of one area (tan↔light-tan↔soft-brown fur) merge;
 *  a high-contrast feature against its surround (a dark eye or nose on a light
 *  face, a logo mark) stays put no matter how small — so consolidation cleans up
 *  fragmentation without erasing the details a viewer actually reads. */
const CONSOLIDATE_MERGE_DIST2 = 150 * 150;

/**
 * Merge small same-color islands into their surrounding color, in place. Labels
 * the 4-connected components of the label map, then — smallest first — reassigns
 * every component below the area threshold to the label that borders it most
 * (its surrounding color), growing the neighbour over it. Dissolving small first
 * lets a fleck melt into a mid region that may itself later melt into the big one,
 * so a shattered area collapses to a few broad shapes. Transparent pixels are
 * never touched, so the silhouette and any hole punched by the background survive.
 */
function consolidateRegions(labels: Int16Array, width: number, height: number, palette: RGB[]): void {
  const total = width * height;
  let opaque = 0;
  for (let i = 0; i < total; i++) if (labels[i] >= 0) opaque++;
  const minArea = Math.min(
    CONSOLIDATE_AREA_CAP_PX,
    Math.max(8, Math.floor(opaque * CONSOLIDATE_AREA_FRACTION)),
  );

  // Label 4-connected components of equal value (comp id per pixel, −1 = transparent).
  const comp = new Int32Array(total).fill(-1);
  const compPixels: number[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < total; start++) {
    if (labels[start] < 0 || comp[start] !== -1) continue;
    const id = compPixels.length;
    const val = labels[start];
    const pixels: number[] = [];
    comp[start] = id;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const k = stack.pop()!;
      pixels.push(k);
      const kx = k % width;
      const ky = (k / width) | 0;
      if (kx > 0 && comp[k - 1] === -1 && labels[k - 1] === val) { comp[k - 1] = id; stack.push(k - 1); }
      if (kx < width - 1 && comp[k + 1] === -1 && labels[k + 1] === val) { comp[k + 1] = id; stack.push(k + 1); }
      if (ky > 0 && comp[k - width] === -1 && labels[k - width] === val) { comp[k - width] = id; stack.push(k - width); }
      if (ky < height - 1 && comp[k + width] === -1 && labels[k + width] === val) { comp[k + width] = id; stack.push(k + width); }
    }
    compPixels.push(pixels);
  }

  // Smallest components first: a fleck dissolves into a mid region, which can then
  // dissolve into the big one — so a shattered area cascades down to a few shapes.
  const order = compPixels.map((_, i) => i).sort((a, b) => compPixels[a].length - compPixels[b].length);
  const count = new Map<number, number>();
  for (const id of order) {
    const pixels = compPixels[id];
    if (pixels.length >= minArea) break; // all remaining are large enough to keep
    // Tally the labels bordering this island (its current surrounding colors).
    count.clear();
    for (const k of pixels) {
      const kx = k % width;
      const ky = (k / width) | 0;
      const nb = [
        kx > 0 ? k - 1 : -1,
        kx < width - 1 ? k + 1 : -1,
        ky > 0 ? k - width : -1,
        ky < height - 1 ? k + width : -1,
      ];
      for (const ni of nb) {
        if (ni < 0) continue;
        const nl = labels[ni];
        if (nl < 0 || nl === labels[k]) continue; // skip outside + same-island
        count.set(nl, (count.get(nl) ?? 0) + 1);
      }
    }
    if (count.size === 0) continue; // island fills the whole opaque area — leave it
    // Pick the most-bordering neighbour whose COLOR is close to this island's —
    // a high-contrast island (dark eye on light fur) has no near neighbour, so it
    // is kept; a shading fleck melts into the similar color hugging it.
    const mine = palette[labels[pixels[0]]];
    let best = -1;
    let bestN = -1;
    for (const [l, c] of count) {
      const o = palette[l];
      const d2 = (o[0] - mine[0]) ** 2 + (o[1] - mine[1]) ** 2 + (o[2] - mine[2]) ** 2;
      if (d2 <= CONSOLIDATE_MERGE_DIST2 && c > bestN) { bestN = c; best = l; }
    }
    if (best < 0) continue; // no similar-enough surround → keep this feature
    for (const k of pixels) labels[k] = best; // grow the surrounding color over it
  }
}

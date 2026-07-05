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

/** Chroma weight for the clustering metric. Pale hues (a light-blue window
 *  against white) differ almost entirely in CHROMA; plain RGB euclidean
 *  underweights that and merges them, while shades of one hue (a red and its
 *  darkened edge) differ mostly in LUMA and should still merge readily. */
const CHROMA_WEIGHT = 5;

/** Perceptual-ish squared distance: luma + weighted chroma (YCbCr-style).
 *  Linear in RGB, so cluster means computed in RGB are also means under this
 *  metric — Lloyd iterations stay valid. */
function dist2(a: RGB, r: number, g: number, b: number): number {
  const y1 = 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2];
  const y2 = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb1 = a[2] - y1, cb2 = b - y2;
  const cr1 = a[0] - y1, cr2 = r - y2;
  return (y1 - y2) ** 2 + CHROMA_WEIGHT * ((cb1 - cb2) ** 2 + (cr1 - cr2) ** 2);
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

/**
 * Does the image sit on a solid OPAQUE background (a logo on white/one colour)?
 * True when the outer border is mostly opaque AND one colour dominates it. Used to
 * reserve an extra palette slot for that background so it doesn't starve the user's
 * requested colours (white + 4 brand colours quantized to 4 merges two brands into
 * mud; quantizing to 5 keeps all four and drops the white). Run on the ORIGINAL
 * image, before quantization. Anti-aliasing is tolerated by bucketing colours to
 * 5-bit channels so a near-uniform border still reads as dominated.
 */
export function borderIsSolidOpaque(img: RasterImage, dominance = 0.6): boolean {
  const { width, height, data } = img;
  if (width < 2 || height < 2) return false;
  let opaque = 0;
  let total = 0;
  const counts = new Map<number, number>();
  const tally = (x: number, y: number) => {
    total++;
    const o = (y * width + x) * 4;
    if (data[o + 3] < ALPHA_CUTOFF) return;
    opaque++;
    // Bucket to 5 bits/channel so anti-aliased near-duplicates count together.
    const key = ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);
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
  if (opaque * 2 < total) return false; // a mostly-transparent border isn't this case
  let bestN = 0;
  for (const n of counts.values()) if (n > bestN) bestN = n;
  return opaque > 0 && bestN / opaque >= dominance;
}

/** How dominant one colour must be along the transparency boundary to count as a
 *  card (a solid backdrop the subject sits on) rather than the subject itself.
 *  Lenient — a subject that runs off the card's edge shows up on the boundary
 *  too (the golf mound reaching both sides of its card); the rectangularity
 *  test below is what actually rules out stripping a logo's own colour. */
const CARD_DOMINANCE = 0.5;
/** A card layout is RECTANGULAR: the opaque region fills (almost all of) its own
 *  bounding box. A transparent-PNG logo's silhouette does not — and its outer
 *  colour must never be stripped as if it were a backdrop. */
const CARD_RECT_FILL = 0.97;
/** Abort if stripping would leave less than this fraction of the opaque pixels —
 *  a solid one-colour rectangle IS the subject (a flag, a colour swatch), not a
 *  card with a subject on it. */
const CARD_MIN_SUBJECT = 0.02;
/** Colour tolerance (squared RGB distance) for growing the card region — wide
 *  enough to take the card's anti-alias fringe and compression noise with it,
 *  narrow enough not to leak into a genuinely different subject colour. */
const CARD_TOL2 = 60 * 60;

/**
 * Downloaded clipart often sits on a solid CARD — a white rectangle that itself
 * floats on a transparent canvas (transparent margins around it). "Remove
 * background" must strip that card too: the border is transparent, so the
 * opaque-background path never runs, and without this the card is kept as a
 * giant background-coloured fill AND eats a palette slot (merging real colours
 * — a red flag and yellow pole quantized together turn orange).
 *
 * Flood the transparent region in from the image border and tally the opaque
 * colours met at its boundary. If ONE colour dominates that boundary it is a
 * card, not the subject's silhouette: flood again through pixels near that
 * colour and turn them transparent. Interior islands of the same colour (a
 * white ball inside a green) are not connected to the boundary and survive —
 * the same connectivity rule the opaque-background path uses. Returns a new
 * image plus the card's colour (so the caller can treat it as the background —
 * dropping the anti-alias halo the card leaves around the subject), or null when
 * there is no card (a normal transparent-PNG logo, or an opaque border).
 */
export function removeInnerBackdrop(img: RasterImage): { image: RasterImage; card: RGB } | null {
  if (img.width < 2 || img.height < 2) return null;
  // Baseline: never let the peeling loop eat the whole subject.
  let baseline = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] >= ALPHA_CUTOFF) baseline++;
  if (baseline === 0) return null;
  // Peel iteratively: a downloaded card frequently wears a thin FRAME (a border
  // line, screenshot edge shading, JPEG edge darkening). Early rounds strip such
  // frames — each a thin sliver of the opaque area — and the first LARGE strip is
  // the card itself, where the peeling must STOP: whatever sits behind the card
  // is the subject, and a rectangular subject layer (a green field with marks on
  // it) would otherwise read as "another card" and be eaten too.
  let out: { image: RasterImage; card: RGB } | null = null;
  for (let round = 0; round < 5; round++) {
    const next = stripCardOnce(out?.image ?? img, baseline);
    if (!next) break;
    out = { image: next.image, card: next.card };
    // Frame or card? A frame is a thin RING: its area over the region's bbox
    // perimeter is a few pixels of thickness. The first strip thicker than that
    // is the card — stop there.
    const thickness = next.stripped / Math.max(1, 2 * (next.bboxW + next.bboxH));
    if (thickness > Math.max(CARD_FRAME_MAX_THICKNESS_PX, 0.02 * Math.min(next.bboxW, next.bboxH))) {
      break; // that was the card
    }
  }
  return out;
}

/** A stripped ring at most this thick (px, scaled up on large images) is a FRAME
 *  line — peeling continues to the card behind it. The first thicker strip is
 *  the card itself, where peeling stops: whatever lies behind the card is the
 *  subject, and a rectangular subject layer (a green field with marks on it)
 *  must not be eaten as "another card". */
const CARD_FRAME_MAX_THICKNESS_PX = 3;

/** One peel of {@link removeInnerBackdrop}: strip the single dominant colour met
 *  at the transparency boundary, if the layout still reads as a card. */
function stripCardOnce(
  img: RasterImage,
  baselineOpaque: number,
): { image: RasterImage; card: RGB; stripped: number; bboxW: number; bboxH: number } | null {
  const { width, height, data } = img;
  const total = width * height;
  const isTransparent = (i: number) => data[i * 4 + 3] < ALPHA_CUTOFF;

  // Rectangularity gate: the opaque region must fill its own bounding box.
  let minX = width, maxX = -1, minY = height, maxY = -1, opaqueCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isTransparent(y * width + x)) continue;
      opaqueCount++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (opaqueCount === 0) return null;
  const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
  if (opaqueCount < CARD_RECT_FILL * bboxArea) return null; // not a card layout

  // --- flood 1: the border-connected transparent region ---
  const seen = new Uint8Array(total); // 1 = transparent region, 2 = card
  const stack: number[] = [];
  for (let x = 0; x < width; x++) {
    for (const i of [x, (height - 1) * width + x]) {
      if (isTransparent(i) && !seen[i]) { seen[i] = 1; stack.push(i); }
    }
  }
  for (let y = 0; y < height; y++) {
    for (const i of [y * width, y * width + width - 1]) {
      if (isTransparent(i) && !seen[i]) { seen[i] = 1; stack.push(i); }
    }
  }
  if (stack.length === 0) return null; // opaque border — not this case
  // Boundary tally: bucket the opaque colours met at the transparent region's
  // edge (5 bits/channel so anti-aliased near-duplicates count together).
  const bucketN = new Map<number, number>();
  const bucketSum = new Map<number, [number, number, number]>();
  let boundary = 0;
  const visitOpaqueNeighbor = (i: number) => {
    const o = i * 4;
    boundary++;
    const key = ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);
    bucketN.set(key, (bucketN.get(key) ?? 0) + 1);
    const s = bucketSum.get(key) ?? [0, 0, 0];
    s[0] += data[o]; s[1] += data[o + 1]; s[2] += data[o + 2];
    bucketSum.set(key, s);
  };
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width, y = (i / width) | 0;
    const nb = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ];
    for (const ni of nb) {
      if (ni < 0 || seen[ni]) continue;
      if (isTransparent(ni)) { seen[ni] = 1; stack.push(ni); }
      else visitOpaqueNeighbor(ni);
    }
  }
  if (boundary === 0) return null;
  let cardKey = -1;
  let cardN = 0;
  for (const [key, n] of bucketN) {
    if (n > cardN) { cardN = n; cardKey = key; }
  }
  if (cardKey < 0) return null;
  // 5-bit buckets split one flat colour that straddles a bucket edge (grey 163 vs
  // 168) — merge every bucket whose colour sits within the card tolerance of the
  // top one before judging dominance, so the judgement is about COLOURS, not bins.
  const topSum = bucketSum.get(cardKey)!;
  const top: RGB = [topSum[0] / cardN, topSum[1] / cardN, topSum[2] / cardN];
  let mergedN = 0;
  const merged: [number, number, number] = [0, 0, 0];
  for (const [key, n] of bucketN) {
    const s = bucketSum.get(key)!;
    const d2 = (s[0] / n - top[0]) ** 2 + (s[1] / n - top[1]) ** 2 + (s[2] / n - top[2]) ** 2;
    if (d2 > CARD_TOL2) continue;
    mergedN += n;
    merged[0] += s[0]; merged[1] += s[1]; merged[2] += s[2];
  }
  // No dominant boundary colour → the subject itself meets the transparency
  // (an ordinary transparent-PNG logo). Nothing to strip.
  if (mergedN / boundary < CARD_DOMINANCE) return null;
  const card: RGB = [merged[0] / mergedN, merged[1] / mergedN, merged[2] / mergedN];

  // --- flood 2: grow the card colour in from the transparency boundary ---
  const nearCard = (i: number) => {
    const o = i * 4;
    return (data[o] - card[0]) ** 2 + (data[o + 1] - card[1]) ** 2 + (data[o + 2] - card[2]) ** 2 <= CARD_TOL2;
  };
  for (let i = 0; i < total; i++) {
    if (seen[i] !== 1) continue;
    const x = i % width, y = (i / width) | 0;
    const nb = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ];
    for (const ni of nb) {
      if (ni >= 0 && !seen[ni] && !isTransparent(ni) && nearCard(ni)) { seen[ni] = 2; stack.push(ni); }
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width, y = (i / width) | 0;
    const nb = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ];
    for (const ni of nb) {
      if (ni >= 0 && !seen[ni] && !isTransparent(ni) && nearCard(ni)) { seen[ni] = 2; stack.push(ni); }
    }
  }

  const out = new Uint8ClampedArray(data);
  let stripped = 0;
  for (let i = 0; i < total; i++) {
    if (seen[i] === 2) { out[i * 4 + 3] = 0; stripped++; }
  }
  // Nothing stripped, or (almost) EVERYTHING stripped — a solid rectangle is the
  // subject itself, not a card. Leave the image alone in both cases.
  if (stripped === 0 || opaqueCount - stripped < CARD_MIN_SUBJECT * baselineOpaque) return null;
  return { image: { width, height, data: out }, card, stripped, bboxW: maxX - minX + 1, bboxH: maxY - minY + 1 };
}

/** How close (squared RGB) a sliver's colour must sit to the SEGMENT between
 *  its two neighbours' colours to count as their anti-alias blend. */
const BLEND_SEGMENT_MAX_DIST2 = 60 * 60;

/** Squared distance from colour c to the segment a→b in RGB space. */
function distToSegment2(c: RGB, a: RGB, b: RGB): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (acx * abx + acy * aby + acz * abz) / len2)) : 0;
  const dx = acx - abx * t, dy = acy - aby * t, dz = acz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Dissolve thin blend-band components (see the call site) in place. Each band's
 * pixels flow to whichever of its two bordering colours they touch, growing both
 * sides inward until the band is consumed — so the boundary lands mid-band, the
 * same place the source's edge actually is.
 */
function dissolveBlendSlivers(
  labels: Int16Array,
  width: number,
  height: number,
  palette: RGB[],
  maxThickPx: number,
): void {
  const total = width * height;
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

  const tally = new Map<number, number>();
  for (const pixels of compPixels) {
    const myLabel = labels[pixels[0]];
    // Perimeter (pixel edges facing outside the component) + neighbour tally.
    tally.clear();
    let perim = 0;
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
        const nl = ni < 0 ? -2 : labels[ni];
        if (nl === myLabel && ni >= 0 && comp[ni] === comp[k]) continue; // interior edge
        perim++;
        if (nl >= 0 && nl !== myLabel) tally.set(nl, (tally.get(nl) ?? 0) + 1);
      }
    }
    if (perim === 0) continue;
    const thickness = (2 * pixels.length) / perim; // ≈ mean band width in px
    if (thickness > maxThickPx) continue; // a real feature, not a blend band
    const neighbors = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    if (neighbors.length < 2) continue; // one-sided → not a between-colours band
    const [[A, cntA], [B, cntB]] = neighbors;
    const totalN = neighbors.reduce((s, [, c]) => s + c, 0);
    if ((cntA + cntB) / totalN < 0.85) continue; // touches many colours → a junction, keep
    if (Math.min(cntA, cntB) / totalN < 0.15) continue; // essentially one-sided
    if (distToSegment2(palette[myLabel], palette[A], palette[B]) > BLEND_SEGMENT_MAX_DIST2) continue;

    // Consume the band from both sides: pixels adjacent to A become A, adjacent
    // to B become B, repeating until the band is gone (ties resolve by order).
    let frontier = pixels;
    let guard = 0;
    while (frontier.length && guard++ < 64) {
      const next: number[] = [];
      const assign: Array<[number, number]> = [];
      for (const k of frontier) {
        const kx = k % width;
        const ky = (k / width) | 0;
        let to = -1;
        for (const ni of [
          kx > 0 ? k - 1 : -1,
          kx < width - 1 ? k + 1 : -1,
          ky > 0 ? k - width : -1,
          ky < height - 1 ? k + width : -1,
        ]) {
          if (ni < 0) continue;
          if (labels[ni] === A || labels[ni] === B) { to = labels[ni]; break; }
        }
        if (to >= 0) assign.push([k, to]);
        else next.push(k);
      }
      if (assign.length === 0) break; // enclosed remainder; leave it
      for (const [k, to] of assign) labels[k] = to;
      frontier = next;
    }
  }
}

/** Index of the palette color closest to (r,g,b) — same perceptual metric as
 *  the clustering, or pixels would assign to different clusters than the ones
 *  k-means built around them. */
function nearestIndex(palette: RGB[], r: number, g: number, b: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = dist2(palette[i], r, g, b);
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
export function quantizeImage(
  img: RasterImage,
  numColors: number,
  opts: { blendSliverMaxPx?: number } = {},
): QuantizedImage {
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
    // Finally, dissolve ANTI-ALIAS BLEND BANDS. Where two colours meet, the
    // source's edge smoothing produces a thin ribbon of intermediate colour
    // (grey between black linework and white, grey-green between a green mound
    // and a white page). k-means gives that ribbon its own cluster, and it then
    // sews as a real line of nonsense-coloured thread hugging every boundary.
    // A component is a blend band when it is THIN, bordered almost entirely by
    // exactly TWO other colours, and its own colour lies on the segment between
    // theirs — then its pixels flow to whichever side they touch. A genuine
    // intermediate-coloured FEATURE (a grey hubcap disc) is blobby, not thin,
    // and survives.
    dissolveBlendSlivers(labels, width, height, palette, opts.blendSliverMaxPx ?? 4);
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
    // is kept; a shading fleck melts into the similar color hugging it. Uses the
    // same perceptual (chroma-weighted) metric as the clustering: under plain
    // RGB, a small saturated feature (a dark-red beacon dome) sits just inside
    // the radius of the black outline around it and gets swallowed, while the
    // weighted metric keeps hue-distinct features and still merges true shading.
    const mine = palette[labels[pixels[0]]];
    let best = -1;
    let bestN = -1;
    for (const [l, c] of count) {
      const d = dist2(palette[l], mine[0], mine[1], mine[2]);
      if (d <= CONSOLIDATE_MERGE_DIST2 && c > bestN) { bestN = c; best = l; }
    }
    if (best < 0) continue; // no similar-enough surround → keep this feature
    for (const k of pixels) labels[k] = best; // grow the surrounding color over it
  }
}

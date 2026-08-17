import type { EmbObject, Path, Point, ThreadColor } from "../../types/project";
import { newId } from "../id";
import { makeObjectFromPaths } from "../objects";
import { marchingSquares } from "../paintbucket";
import { smoothRingKeepingCorners } from "../smooth";
import { douglasPeucker } from "./simplify";
import { polygonArea } from "./classify";
import { nameForRgb } from "./colorname";
import {
  borderIsTransparent,
  borderIsSolidOpaque,
  borderBackgroundColor,
  removeInnerBackdrop,
  type RasterImage,
} from "./quantize";
import { upscaleFactor, hasAntiAliasing, upscaleBilinear, upscaleNearest } from "./upscale";
import { DETAIL_PRESETS } from "./types";
import type { DigitizeOptions, DigitizeResult } from "./types";

/**
 * LIVE-PAINT digitizing — the Adobe Illustrator Live Paint model, for outlined
 * cartoon/line artwork. The posterize-by-color trace treats the dark ink as
 * just another color layer, so its filled blobs swallow the small features
 * living BETWEEN the lines (a cartoon face's eye whites, a tongue). Here the
 * structure of the artwork is respected instead:
 *
 *   1. the dark linework becomes an INK MASK — one stroke network;
 *   2. every enclosed FACE between the lines becomes a flat color fill,
 *      its color sampled from the image, extended slightly UNDER the ink so
 *      thread pull can never open bare fabric along a line;
 *   3. fills sew first (largest color first), the ink network sews LAST on
 *      top through the engine's line-art renderer.
 *
 * The ink always gets its own ThreadColor (even when a face color is
 * near-black): fixStitches groups objects by first-seen colorId, so a shared
 * id would drag the linework forward under the fills.
 */

/** Ink can't be lighter than this, whatever Otsu claims (a low-contrast photo's
 *  threshold can drift high; real drawn ink is dark). */
const INK_LUM_CAP = 140;
/** Per-pixel chroma cap (max−min channel): keeps saturated darks — a deep red
 *  mouth interior measures lum ~66–92 and would otherwise be eaten by a pure
 *  luminance threshold — OUT of the ink. Navy/brown linework (chroma ≤ ~60)
 *  still passes. */
const INK_CHROMA_MAX = 70;
/** An "ink" mask this light on average isn't drawn linework (dark-but-colored
 *  posterized photo, inverted art) — live paint declines. */
const INK_MEAN_LUM_MAX = 90;
/** Below this ink share of opaque pixels there's no linework to speak of. */
const INK_MIN_FRACTION = 0.02;
/** Palette entries closer than this (RGB dist²) merge — two whites are one thread. */
const PALETTE_MERGE_DIST2 = 32 * 32;
/** A pixel further than this (RGB dist²) from its face's mean color is an
 *  OUTLIER — a connected clump of them big enough to sew is a distinct region
 *  that leaked in through a line-work gap, and splits into its own face. */
const FACE_PURE_DIST2 = 60 * 60;
/** Pixel cap after upscale; beyond it we work on a stride-2 downsample
 *  (mm-denominated thresholds make this scale-free). */
const MAX_PIXELS = 4_000_000;
/** Ink locally fatter than 2× this half-width (mm) is a solid BLOB (a pupil,
 *  a heavy brow), not a pen stroke — it sews as an ordinary fill because a
 *  stroke skeleton renders a blob as a hollow outline. Pen strokes in the
 *  reference cartoons run 0.6–2.0mm, so 1.15mm half-width (2.3mm full) only
 *  fires on genuine solids. */
const INK_BLOB_MIN_HALF_MM = 0.8;
/** A blob smaller than this (mm²) stays part of the stroke network. */
const INK_BLOB_MIN_MM2 = 2.5;

interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const lumOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const chromaOf = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b);

/** Otsu's threshold over a 256-bin histogram (returns the bin maximizing
 *  between-class variance). */
function otsu(hist: Float64Array): number {
  let total = 0;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sumAll += i * hist[i];
  }
  if (total <= 0) return 128;
  let sumB = 0;
  let wB = 0;
  let bestLo = 128;
  let bestHi = 128;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar * (1 + 1e-9)) {
      bestVar = v;
      bestLo = t;
      bestHi = t;
    } else if (v >= bestVar * (1 - 1e-9)) {
      bestHi = t; // same variance — extend the plateau
    }
  }
  // On a clean bimodal histogram the between-class variance is FLAT across the
  // whole gap between the two spikes; taking the first maximum parks the
  // threshold on the dark spike's own bin and pixels a fraction of a level
  // above it (a lum of 30.46 vs bin 30) fall out of the ink. The midpoint of
  // the plateau is the honest cut.
  return Math.round((bestLo + bestHi) / 2);
}

/** 4-neighbor dilation of a 0/1 mask, `iters` rings. */
function dilated(mask: Uint8Array, W: number, H: number, iters: number): Uint8Array {
  let cur = mask;
  for (let n = 0; n < iters; n++) {
    const next = cur.slice();
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (cur[j * W + i]) continue;
        if (
          (i > 0 && cur[j * W + i - 1]) ||
          (i < W - 1 && cur[j * W + i + 1]) ||
          (j > 0 && cur[(j - 1) * W + i]) ||
          (j < H - 1 && cur[(j + 1) * W + i])
        )
          next[j * W + i] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

/** 4-neighbor erosion of a 0/1 mask, `iters` rings. */
function eroded(mask: Uint8Array, W: number, H: number, iters: number): Uint8Array {
  let cur = mask;
  for (let n = 0; n < iters; n++) {
    const next = cur.slice();
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!cur[j * W + i]) continue;
        if (
          i === 0 || j === 0 || i === W - 1 || j === H - 1 ||
          !cur[j * W + i - 1] || !cur[j * W + i + 1] || !cur[(j - 1) * W + i] || !cur[(j + 1) * W + i]
        )
          next[j * W + i] = 0;
      }
    }
    cur = next;
  }
  return cur;
}

/** Label 4-connected components of `mask===want`; returns labels (−1 where the
 *  mask differs) and per-label pixel counts. Iterative stack flood (no recursion). */
function labelComponents(
  mask: Uint8Array,
  W: number,
  H: number,
  want: 0 | 1,
): { labels: Int32Array; counts: number[] } {
  const labels = new Int32Array(W * H).fill(-1);
  const counts: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (mask[start] !== want || labels[start] !== -1) continue;
    const id = counts.length;
    counts.push(0);
    stack.length = 0;
    stack.push(start);
    labels[start] = id;
    while (stack.length) {
      const p = stack.pop()!;
      counts[id]++;
      const i = p % W;
      const j = (p / W) | 0;
      if (i > 0 && mask[p - 1] === want && labels[p - 1] === -1) { labels[p - 1] = id; stack.push(p - 1); }
      if (i < W - 1 && mask[p + 1] === want && labels[p + 1] === -1) { labels[p + 1] = id; stack.push(p + 1); }
      if (j > 0 && mask[p - W] === want && labels[p - W] === -1) { labels[p - W] = id; stack.push(p - W); }
      if (j < H - 1 && mask[p + W] === want && labels[p + W] === -1) { labels[p + W] = id; stack.push(p + W); }
    }
  }
  return { labels, counts };
}

/** The working raster: upscaled like the standard trace, backdrop-stripped, and
 *  stride-downsampled above the pixel cap. Returns the raster plus the mm/px of
 *  ONE working pixel and the effective background color, mirroring
 *  imageDataToObjects' normalization so both paths agree on physical size. */
function normalizeRaster(
  imageData: ImageData,
  opts: DigitizeOptions,
): {
  img: Raster;
  mmPerPx: number;
  backgroundRgb: [number, number, number] | null;
  transparentBg: boolean;
  opaqueBg: boolean;
} {
  let img: Raster = { width: imageData.width, height: imageData.height, data: imageData.data };
  let mmPerPx = opts.mmPerPx;

  const factor = upscaleFactor(img.width, img.height);
  if (factor > 1) {
    img = hasAntiAliasing(img) ? upscaleBilinear(img, factor) : upscaleNearest(img, factor);
    mmPerPx /= factor;
  }

  const transparentBg = borderIsTransparent(img as RasterImage);
  let cardRgb: [number, number, number] | null = null;
  if (transparentBg && opts.removeBackground !== false) {
    const stripped = removeInnerBackdrop(img as RasterImage);
    // Only accept a LIGHT card: a dark rectangular "backdrop" enclosing the
    // subject is indistinguishable from the artwork's own ink border (a
    // framed drawing), and stripping it deletes the linework itself.
    if (stripped && lumOf(...stripped.card) > INK_LUM_CAP) {
      img = stripped.image;
      cardRgb = stripped.card;
    }
  }
  const opaqueBg = !transparentBg && borderIsSolidOpaque(img as RasterImage, 0.7);
  const backgroundRgb = opts.backgroundRgb ?? cardRgb ?? borderBackgroundColor(img as RasterImage);

  while (img.width * img.height > MAX_PIXELS) {
    const W = img.width >> 1;
    const H = img.height >> 1;
    const out = new Uint8ClampedArray(W * H * 4);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const so = (j * 2 * img.width + i * 2) * 4;
        const o = (j * W + i) * 4;
        out[o] = img.data[so];
        out[o + 1] = img.data[so + 1];
        out[o + 2] = img.data[so + 2];
        out[o + 3] = img.data[so + 3];
      }
    }
    img = { width: W, height: H, data: out };
    mmPerPx *= 2;
  }

  return { img, mmPerPx, backgroundRgb, transparentBg, opaqueBg };
}

/** Ink mask: dark, low-chroma, opaque pixels (Otsu-capped luminance). */
function inkMask(img: Raster): { ink: Uint8Array; opaque: Uint8Array; meanLum: number; inkRgb: [number, number, number]; inkCount: number; opaqueCount: number } {
  const { width: W, height: H, data } = img;
  const opaque = new Uint8Array(W * H);
  const hist = new Float64Array(256);
  let opaqueCount = 0;
  for (let p = 0; p < W * H; p++) {
    const o = p * 4;
    if (data[o + 3] < 128) continue;
    opaque[p] = 1;
    opaqueCount++;
    hist[Math.round(lumOf(data[o], data[o + 1], data[o + 2]))]++;
  }
  const T = Math.min(otsu(hist), INK_LUM_CAP);
  const ink = new Uint8Array(W * H);
  let inkCount = 0;
  let lumSum = 0;
  let r = 0, g = 0, b = 0;
  for (let p = 0; p < W * H; p++) {
    if (!opaque[p]) continue;
    const o = p * 4;
    const lum = lumOf(data[o], data[o + 1], data[o + 2]);
    if (lum <= T && chromaOf(data[o], data[o + 1], data[o + 2]) <= INK_CHROMA_MAX) {
      ink[p] = 1;
      inkCount++;
      lumSum += lum;
      r += data[o];
      g += data[o + 1];
      b += data[o + 2];
    }
  }
  const meanLum = inkCount ? lumSum / inkCount : 255;
  const inkRgb: [number, number, number] = inkCount
    ? [Math.round(r / inkCount), Math.round(g / inkCount), Math.round(b / inkCount)]
    : [0, 0, 0];
  return { ink, opaque, meanLum, inkRgb, inkCount, opaqueCount };
}

export interface LineArtDetection {
  isLineArt: boolean;
  /** Raw measurements behind the verdict, for tests and tuning. */
  stats: {
    opaqueFraction: number;
    inkFraction: number;
    largestInkShare: number;
    erosionSurvivor2: number;
    meanInkLum: number;
    enclosedFaces: number;
    faceFlatness: number;
  };
  /** distinct face colors + 1 for ink — a good Colors-stepper default. */
  suggestedColors: number;
}

/**
 * Does this image read as OUTLINED LINE ART (dark linework enclosing flat
 * color faces)? Runs on a ≤300px downsample — fast enough to call once per
 * loaded image. All seven gates must pass; each was tuned so the bench image
 * corpus's line-art fixture passes and its flat-logo / gradient / photo-ish
 * fixtures each fail at least one.
 */
export function detectLineArt(imageData: ImageData): LineArtDetection {
  // Downsample to ≤300px longest side (nearest: detection wants hard stats).
  let img: Raster = { width: imageData.width, height: imageData.height, data: imageData.data };
  const maxDim = Math.max(img.width, img.height);
  if (maxDim > 300) {
    const stride = Math.ceil(maxDim / 300);
    const W = Math.max(1, Math.floor(img.width / stride));
    const H = Math.max(1, Math.floor(img.height / stride));
    const out = new Uint8ClampedArray(W * H * 4);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const so = (j * stride * img.width + i * stride) * 4;
        const o = (j * W + i) * 4;
        out[o] = img.data[so];
        out[o + 1] = img.data[so + 1];
        out[o + 2] = img.data[so + 2];
        out[o + 3] = img.data[so + 3];
      }
    }
    img = { width: W, height: H, data: out };
  }
  const { width: W, height: H, data } = img;
  const { ink, opaque, meanLum, inkCount, opaqueCount } = inkMask(img);

  const fail = (partial: Partial<LineArtDetection["stats"]>): LineArtDetection => ({
    isLineArt: false,
    stats: {
      opaqueFraction: opaqueCount / (W * H),
      inkFraction: opaqueCount ? inkCount / opaqueCount : 0,
      largestInkShare: 0,
      erosionSurvivor2: 1,
      meanInkLum: meanLum,
      enclosedFaces: 0,
      faceFlatness: 255,
      ...partial,
    },
    suggestedColors: 4,
  });

  const opaqueFraction = opaqueCount / (W * H);
  const inkFraction = opaqueCount ? inkCount / opaqueCount : 0;
  if (opaqueFraction < 0.05 || inkFraction < 0.05 || inkFraction > 0.4 || meanLum > INK_MEAN_LUM_MAX)
    return fail({});

  // Network test: linework is one big connected component, and it's THIN —
  // two erosions eat most of it (a filled silhouette barely notices).
  const { counts: inkComps } = labelComponents(ink, W, H, 1);
  const largestInkShare = inkComps.length ? Math.max(...inkComps) / inkCount : 0;
  let survivors = 0;
  const eroded2 = eroded(ink, W, H, 2);
  for (let p = 0; p < W * H; p++) if (eroded2[p]) survivors++;
  const erosionSurvivor2 = inkCount ? survivors / inkCount : 1;
  if (largestInkShare < 0.5 || erosionSurvivor2 > 0.45)
    return fail({ largestInkShare, erosionSurvivor2 });

  // Faces: enclosed regions between lines, flat in color.
  const barrier = dilated(ink, W, H, 1);
  const notBarrier = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) notBarrier[p] = barrier[p] ? 0 : 1;
  const { labels, counts } = labelComponents(notBarrier, W, H, 1);
  const touchesBorder = new Uint8Array(counts.length);
  for (let i = 0; i < W; i++) {
    if (labels[i] >= 0) touchesBorder[labels[i]] = 1;
    if (labels[(H - 1) * W + i] >= 0) touchesBorder[labels[(H - 1) * W + i]] = 1;
  }
  for (let j = 0; j < H; j++) {
    if (labels[j * W] >= 0) touchesBorder[labels[j * W]] = 1;
    if (labels[j * W + W - 1] >= 0) touchesBorder[labels[j * W + W - 1]] = 1;
  }
  const minFacePx = Math.max(4, opaqueCount * 0.001);
  // Per-face color stats for flatness + suggested palette.
  const sums = counts.map(() => ({ n: 0, r: 0, g: 0, b: 0, lum: 0, lum2: 0 }));
  for (let p = 0; p < W * H; p++) {
    const id = labels[p];
    if (id < 0 || !opaque[p]) continue;
    const o = p * 4;
    const s = sums[id];
    s.n++;
    s.r += data[o];
    s.g += data[o + 1];
    s.b += data[o + 2];
    const lum = lumOf(data[o], data[o + 1], data[o + 2]);
    s.lum += lum;
    s.lum2 += lum * lum;
  }
  let enclosedFaces = 0;
  let flatW = 0;
  let flatSum = 0;
  const faceColors: { rgb: [number, number, number]; w: number }[] = [];
  counts.forEach((c, id) => {
    if (touchesBorder[id] || c < minFacePx || sums[id].n === 0) return;
    enclosedFaces++;
    const s = sums[id];
    const mean = s.lum / s.n;
    const sd = Math.sqrt(Math.max(0, s.lum2 / s.n - mean * mean));
    if (s.n >= opaqueCount * 0.005) {
      flatW += s.n;
      flatSum += sd * s.n;
    }
    // Every enclosed face counts toward the palette suggestion — a cartoon's
    // red mouth is a fraction of a percent of the pixels and is still a thread.
    faceColors.push({ rgb: [s.r / s.n, s.g / s.n, s.b / s.n], w: s.n });
  });
  const faceFlatness = flatW ? flatSum / flatW : 255;
  if (enclosedFaces < 3 || faceFlatness > 30)
    return fail({ largestInkShare, erosionSurvivor2, enclosedFaces, faceFlatness });

  // Distinct face colors (greedy cluster at dist² 40²) + 1 for the ink thread.
  const reps: { rgb: [number, number, number] }[] = [];
  faceColors.sort((a, b) => b.w - a.w);
  for (const f of faceColors) {
    if (
      !reps.some(
        (r2) =>
          (r2.rgb[0] - f.rgb[0]) ** 2 + (r2.rgb[1] - f.rgb[1]) ** 2 + (r2.rgb[2] - f.rgb[2]) ** 2 <=
          40 * 40,
      )
    )
      reps.push({ rgb: f.rgb });
  }
  return {
    isLineArt: true,
    stats: {
      opaqueFraction,
      inkFraction,
      largestInkShare,
      erosionSurvivor2,
      meanInkLum: meanLum,
      enclosedFaces,
      faceFlatness,
    },
    suggestedColors: Math.min(12, reps.length + 1),
  };
}

/**
 * Digitize an outlined-line-art image the Live Paint way. See the module doc.
 * Returns the same DigitizeResult shape as imageDataToObjects; the ink object
 * is always LAST with its own last-minted ThreadColor.
 */
export function livePaintObjects(
  imageData: ImageData,
  numberOfColors: number,
  opts: DigitizeOptions,
): DigitizeResult {
  const preset = DETAIL_PRESETS[opts.detail ?? "balanced"];
  const simplifyTolMm = opts.simplifyTolMm ?? preset.simplifyTolMm;
  const minFaceMm2 = Math.max(0.5, (opts.minAreaMm2 ?? preset.minAreaMm2) * 0.8);
  const removeBackground = opts.removeBackground !== false;
  const offsetX = opts.offsetX ?? 0;
  const offsetY = opts.offsetY ?? 0;

  const { img, mmPerPx, backgroundRgb, opaqueBg } = normalizeRaster(imageData, opts);
  const { width: W, height: H, data } = img;
  const pxArea = mmPerPx * mmPerPx; // mm² of one working pixel
  const factor = Math.max(1, Math.round(opts.mmPerPx / mmPerPx));

  const { ink, meanLum, inkRgb, inkCount, opaqueCount } = inkMask(img);
  if (opaqueCount === 0 || inkCount / Math.max(1, opaqueCount) < INK_MIN_FRACTION || meanLum > INK_MEAN_LUM_MAX) {
    return { colors: [], objects: [] }; // no dark linework — nothing to live-paint
  }

  // ── Faces ────────────────────────────────────────────────────────────────
  // The barrier seals anti-aliasing gaps so a face can't leak into its
  // neighbour through a hairline break (measured: radius 1+factor closes a
  // cartoon's hat/face leak; one more would start merging real faces).
  const closeRadius = Math.min(4, 1 + factor);
  const barrier = dilated(ink, W, H, closeRadius);
  const notBarrier = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) notBarrier[p] = barrier[p] ? 0 : 1;
  const { labels, counts } = labelComponents(notBarrier, W, H, 1);

  interface Face {
    id: number;
    px: number;
    rgb: [number, number, number];
    keep: boolean;
    /** dropped ONLY for being sub-visible (enclosed, opaque, just tiny) —
     *  these fold into the ink so they can't pinhole; background faces don't. */
    tiny: boolean;
  }

  const analyzeFaces = (): Face[] => {
    const touchesBorder = new Uint8Array(counts.length);
    for (let i = 0; i < W; i++) {
      if (labels[i] >= 0) touchesBorder[labels[i]] = 1;
      if (labels[(H - 1) * W + i] >= 0) touchesBorder[labels[(H - 1) * W + i]] = 1;
    }
    for (let j = 0; j < H; j++) {
      if (labels[j * W] >= 0) touchesBorder[labels[j * W]] = 1;
      if (labels[j * W + W - 1] >= 0) touchesBorder[labels[j * W + W - 1]] = 1;
    }
    const acc = counts.map(() => ({ n: 0, tr: 0, r: 0, g: 0, b: 0 }));
    for (let p = 0; p < W * H; p++) {
      const id = labels[p];
      if (id < 0) continue;
      const o = p * 4;
      const a = acc[id];
      if (data[o + 3] < 128) {
        a.tr++;
        continue;
      }
      a.n++;
      a.r += data[o];
      a.g += data[o + 1];
      a.b += data[o + 2];
    }
    return counts.map((_c, id) => {
      const a = acc[id];
      const total = a.n + a.tr;
      const rgb: [number, number, number] =
        a.n > 0 ? [a.r / a.n, a.g / a.n, a.b / a.n] : [255, 255, 255];
      let keep = total > 0 && a.n > 0;
      // Background: touches the border (dropped only when removing bg), or is
      // mostly transparent, or matches the detected opaque page color at the
      // border. Enclosed faces of the page color always sew (an eye white on
      // a white page is art, not page).
      if (keep && a.tr >= total * 0.5) keep = false;
      if (keep && touchesBorder[id]) {
        if (removeBackground) keep = false;
        else if (
          opaqueBg &&
          backgroundRgb &&
          (rgb[0] - backgroundRgb[0]) ** 2 +
            (rgb[1] - backgroundRgb[1]) ** 2 +
            (rgb[2] - backgroundRgb[2]) ** 2 <=
            90 * 90
        )
          keep = false;
      }
      let tiny = false;
      if (keep && total * pxArea < minFaceMm2) {
        keep = false;
        tiny = true;
      }
      return { id, px: total, rgb, keep, tiny };
    });
  };

  let faces = analyzeFaces();

  // ── Outlier-clump split ──────────────────────────────────────────────────
  // A small region that LEAKED into a big one through a line-work gap — an eye
  // white joining the face blue — is invisible to any FRACTIONAL purity test:
  // the clump is a rounding error of the big face's pixel count. Instead, find
  // connected clumps of pixels far from their face's mean color; every clump
  // big enough to sew becomes its own face. Runs to a fixpoint (bounded): a
  // split changes the parent's mean, which can expose the next clump.
  const minFacePx = Math.max(1, Math.round(minFaceMm2 / pxArea));
  for (let round = 0; round < 3; round++) {
    let changed = false;
    for (const f of faces.filter((ff) => ff.keep)) {
      const outlier = new Uint8Array(W * H);
      let n = 0;
      for (let p = 0; p < W * H; p++) {
        if (labels[p] !== f.id || data[p * 4 + 3] < 128) continue;
        const o = p * 4;
        const d2 =
          (data[o] - f.rgb[0]) ** 2 + (data[o + 1] - f.rgb[1]) ** 2 + (data[o + 2] - f.rgb[2]) ** 2;
        if (d2 > FACE_PURE_DIST2) {
          outlier[p] = 1;
          n++;
        }
      }
      if (n < minFacePx) continue;
      const { labels: subLabels, counts: subCounts } = labelComponents(outlier, W, H, 1);
      if (!subCounts.some((c) => c >= minFacePx)) continue;
      const base = counts.length;
      for (let si = 0; si < subCounts.length; si++) counts.push(0);
      for (let p = 0; p < W * H; p++) {
        const si = subLabels[p];
        if (si >= 0 && subCounts[si] >= minFacePx) {
          labels[p] = base + si;
          changed = true;
        }
      }
    }
    if (!changed) break;
    faces = analyzeFaces();
  }

  // Sub-visible enclosed specks dissolve into ink so they can't pinhole;
  // background faces must NOT (folding the outside in would wrap the whole
  // image interior into the ink object's rings).
  const keepFace = new Uint8Array(counts.length);
  const tinyFace = new Uint8Array(counts.length);
  for (const f of faces) {
    if (f.keep) keepFace[f.id] = 1;
    if (f.tiny) tinyFace[f.id] = 1;
  }

  // ── Palette over faces ───────────────────────────────────────────────────
  const kept = faces.filter((f) => f.keep);
  if (kept.length === 0) return { colors: [], objects: [] };
  const k = Math.max(1, Math.min(numberOfColors - 1, kept.length));
  // Area-weighted k-means over face mean colors. Seeding is FARTHEST-POINT
  // (k-means++ style), not largest-first: a cartoon's red mouth is a fraction
  // of a percent of the area but a genuinely distinct thread — seeding by size
  // would park every center on the big whites/blues and the red face would be
  // absorbed by its nearest big neighbour.
  const first = [...kept].sort((a, b) => b.px - a.px)[0];
  let centers: [number, number, number][] = [[...first.rgb]];
  while (centers.length < k) {
    let far: Face | null = null;
    let fd = -1;
    for (const f of kept) {
      const d = Math.min(
        ...centers.map(
          (c) => (f.rgb[0] - c[0]) ** 2 + (f.rgb[1] - c[1]) ** 2 + (f.rgb[2] - c[2]) ** 2,
        ),
      );
      if (d > fd) {
        fd = d;
        far = f;
      }
    }
    if (!far || fd <= PALETTE_MERGE_DIST2) break; // remaining faces all match a center
    centers.push([...far.rgb]);
  }
  const assign = new Map<number, number>();
  for (let it = 0; it < 12; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (const f of kept) {
      let best = 0;
      let bd = Infinity;
      centers.forEach((c, ci) => {
        const d =
          (f.rgb[0] - c[0]) ** 2 + (f.rgb[1] - c[1]) ** 2 + (f.rgb[2] - c[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = ci;
        }
      });
      assign.set(f.id, best);
      const a = acc[best];
      a[0] += f.rgb[0] * f.px;
      a[1] += f.rgb[1] * f.px;
      a[2] += f.rgb[2] * f.px;
      a[3] += f.px;
    }
    centers = centers.map((c, ci) => {
      const a = acc[ci];
      return a[3] > 0 ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : c;
    });
  }
  // Merge near-identical centers (two whites are one thread).
  const merged: { rgb: [number, number, number]; members: Set<number> }[] = [];
  centers.forEach((c, ci) => {
    const hit = merged.find(
      (m) =>
        (m.rgb[0] - c[0]) ** 2 + (m.rgb[1] - c[1]) ** 2 + (m.rgb[2] - c[2]) ** 2 <=
        PALETTE_MERGE_DIST2,
    );
    if (hit) hit.members.add(ci);
    else merged.push({ rgb: [c[0], c[1], c[2]], members: new Set([ci]) });
  });

  // ── Geometry per palette color ───────────────────────────────────────────
  const boundW = offsetX + (imageData.width * opts.mmPerPx);
  const boundH = offsetY + (imageData.height * opts.mmPerPx);
  const clampToImage = (ring: Path): Path =>
    ring.map((p) => ({
      x: Math.min(boundW, Math.max(offsetX, p.x)),
      y: Math.min(boundH, Math.max(offsetY, p.y)),
    }));
  const toMmRing = (ring: Point[]): Path =>
    ring.map((p) => ({ x: p.x * mmPerPx + offsetX, y: p.y * mmPerPx + offsetY }));
  // NO shape snapping on faces: recognizeShape's 1mm circle/ellipse tolerance
  // visibly pushed knuckle-sized faces past their ink boundary (blue spilling
  // outside the lines). Faces hug the linework — fidelity beats idealization.
  const cleanRing = (ringPx: Point[]): Path =>
    clampToImage(smoothRingKeepingCorners(douglasPeucker(toMmRing(ringPx), simplifyTolMm), 0.6));

  const colors: ThreadColor[] = [];
  const objects: EmbObject[] = [];
  const nameCount = new Map<string, number>();
  const mintName = (base: string): string => {
    const n = (nameCount.get(base) ?? 0) + 1;
    nameCount.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  };

  // ── Midline claim: how far each color may tuck under the ink ────────────
  // The old per-color dilation grew masks into the ink's DILATED halo, so a
  // fill could poke out the FAR side of a thin stroke (blue past the outline).
  // Instead, one multi-source BFS claims every sealed-ink cell for its NEAREST
  // region — a kept face's color, or the OUTSIDE — so fills extend exactly to
  // the stroke midline: seams are buried under the ink and nothing can ever
  // overshoot the drawn boundary. Depth-capped: a tuck deeper than ~1.2mm buys
  // nothing (the seam is covered) and just sews dead thread under fat ink.
  const colorIndexOfFace = new Int16Array(counts.length).fill(-1);
  for (const f of faces) {
    if (!f.keep) continue;
    const ci = assign.get(f.id);
    if (ci === undefined) continue;
    const mi = merged.findIndex((m) => m.members.has(ci));
    if (mi >= 0) colorIndexOfFace[f.id] = mi as unknown as number;
  }
  const OUTSIDE = -2;
  const claim = new Int32Array(W * H).fill(-1);
  let frontier: number[] = [];
  for (let p = 0; p < W * H; p++) {
    if (barrier[p]) continue;
    const id = labels[p];
    const region = id >= 0 && keepFace[id] ? colorIndexOfFace[id] : OUTSIDE;
    claim[p] = region === -1 ? OUTSIDE : region;
    frontier.push(p);
  }
  // 0.45mm ≈ the engine's own color-seam underlap: enough that thread pull
  // can't open fabric at the boundary, shallow enough that the tuck always
  // stays under the ink's satin (a deeper tuck peeked out beside strokes whose
  // regularized constant-width satin is narrower than a local ink bulge).
  const maxTuckPx = Math.max(2, Math.round(0.45 / mmPerPx));
  for (let depth = 0; depth < maxTuckPx && frontier.length; depth++) {
    const next: number[] = [];
    for (const p of frontier) {
      const i = p % W;
      const j = (p / W) | 0;
      const spread = (q: number) => {
        if (claim[q] === -1 && barrier[q]) {
          claim[q] = claim[p];
          next.push(q);
        }
      };
      if (i > 0) spread(p - 1);
      if (i < W - 1) spread(p + 1);
      if (j > 0) spread(p - W);
      if (j < H - 1) spread(p + W);
    }
    frontier = next;
  }

  const colorEntries = merged
    .map((m, mi) => {
      // This color's faces plus the ink cells the midline claim awarded them.
      const mask = new Uint8Array(W * H);
      let px = 0;
      for (let p = 0; p < W * H; p++) {
        const id = labels[p];
        if (id >= 0 && keepFace[id]) {
          const ci = assign.get(id);
          if (ci !== undefined && m.members.has(ci)) {
            mask[p] = 1;
            px++;
          }
        } else if (barrier[p] && claim[p] === mi) {
          mask[p] = 1;
          px++; // count the claimed tuck too — the size ORDER must match the final rings
        }
      }
      return { m, mask, px };
    })
    .filter((e) => e.px * pxArea >= minFaceMm2)
    .sort((a, b) => b.px - a.px);

  for (const { m, mask } of colorEntries) {
    const rings = marchingSquares(mask, W, H)
      .map(cleanRing)
      .filter((r) => r.length >= 3 && Math.abs(polygonArea(r)) >= minFaceMm2);
    if (rings.length === 0) continue;
    const rgb: [number, number, number] = [
      Math.round(m.rgb[0]),
      Math.round(m.rgb[1]),
      Math.round(m.rgb[2]),
    ];
    const colorId = newId("color");
    const base = nameForRgb(rgb);
    colors.push({ id: colorId, rgb, name: base });
    const obj = makeObjectFromPaths("fill", rings, colorId, mintName(`${base} fill`));
    // NO pull compensation on live-paint faces: their drawn boundary already
    // includes the under-ink tuck (their seam allowance). Adding the default
    // pull comp on top pushed fills past the stroke midline and out beside the
    // ink's satin — 145 stitches of face blue measured inside the eye whites.
    obj.params = { ...obj.params, pullComp: 0 };
    objects.push(obj);
  }

  // ── Ink, strictly last: solid BLOBS as fills, then the stroke network ────
  // True morphological CLOSE (not the fattened barrier): seal AA pinholes
  // without thickening the strokes.
  const closed = eroded(dilated(ink, W, H, closeRadius), W, H, closeRadius);
  // Enclosed sub-visible specks were dropped from the faces; fold them into
  // the ink so they can't leave pinholes between fills and linework.
  for (let p = 0; p < W * H; p++) {
    const id = labels[p];
    if (id >= 0 && tinyFace[id]) closed[p] = 1;
  }

  // A solid ink BLOB — a pupil, a fat brow, a mouth-cavity shadow — has no
  // stroke skeleton; the line-art renderer draws its outline and leaves the
  // body hollow (a cartoon's pupils sewed as empty diamonds). Erosion finds
  // where the ink is locally FATTER than any pen stroke; those cores
  // reconstruct into blob masks that sew as ordinary solid fills (same ink
  // thread, before the line network so the strokes still sit on top).
  // The blob threshold ADAPTS to the artwork's own pen: the core radius is
  // 1.4× the ink's median half-width (found by eroding until half the ink is
  // gone), floored at INK_BLOB_MIN_HALF_MM. A uniform frame's L-corners are
  // locally a bit fatter than the wall and must NOT become solids; a pupil is
  // fatter than any stroke of its drawing.
  let inkPxCount = 0;
  for (let p = 0; p < W * H; p++) if (closed[p]) inkPxCount++;
  // A uniform stroke of width w loses HALF its area at erosion w/4, so the
  // median half-width is 2× the 50%-survival radius.
  let r50 = 1;
  {
    let cur = closed;
    for (let r = 1; r <= 14; r++) {
      cur = eroded(cur, W, H, 1);
      let surv = 0;
      for (let p = 0; p < W * H; p++) if (cur[p]) surv++;
      r50 = r;
      if (surv < inkPxCount / 2) break;
    }
  }
  const blobCoreRadPx = Math.max(
    Math.round(INK_BLOB_MIN_HALF_MM / mmPerPx),
    Math.round(2 * r50 * 1.4),
  );
  const cores = eroded(closed, W, H, blobCoreRadPx);
  let blobs: Uint8Array = new Uint8Array(W * H);
  let hasCore = false;
  for (let p = 0; p < W * H; p++)
    if (cores[p]) {
      blobs[p] = 1;
      hasCore = true;
    }
  if (hasCore) {
    // TRUE morphological opening: plain disc dilation of the cores clipped to
    // the ink. (Geodesic growth instead WALKED along connected strokes — a
    // pupil's solid bled 1mm down its eyelid line.)
    blobs = dilated(blobs, W, H, blobCoreRadPx + 1);
    for (let p = 0; p < W * H; p++) if (!closed[p]) blobs[p] = 0;
  }
  const inkColorId = newId("color");
  let inkColorUsed = false;

  if (hasCore) {
    // Each blob big enough to sew becomes rings; smaller cores stay strokes.
    const { labels: blobLabels, counts: blobCounts } = labelComponents(blobs, W, H, 1);
    // Size AND shape gates: a blob is COMPACT (a pupil, a shadow patch). A
    // reconstructed stretch of extra-thick outline is elongated — it must stay
    // in the stroke network or the outline fragments into fill patches.
    const blobBounds = blobCounts.map(() => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }));
    for (let p2 = 0; p2 < W * H; p2++) {
      const bl = blobLabels[p2];
      if (bl < 0) continue;
      const bx = p2 % W;
      const by = (p2 / W) | 0;
      const bb = blobBounds[bl];
      if (bx < bb.minX) bb.minX = bx;
      if (by < bb.minY) bb.minY = by;
      if (bx > bb.maxX) bb.maxX = bx;
      if (by > bb.maxY) bb.maxY = by;
    }
    const keepBlob = blobCounts.map((c, bl) => {
      if (c * pxArea < INK_BLOB_MIN_MM2) return false;
      const bb = blobBounds[bl];
      const bw = bb.maxX - bb.minX + 1;
      const bh = bb.maxY - bb.minY + 1;
      if (Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) > 2.5) return false;
      // A true solid is FATTER than the opening disc; a stroke junction or an
      // L-corner survives the erosion but reconstructs to just the disc
      // (~πr² clipped) — a pupil reconstructs to its own larger body.
      return c >= 1.6 * Math.PI * blobCoreRadPx * blobCoreRadPx;
    });
    for (let p = 0; p < W * H; p++) {
      const bl = blobLabels[p];
      if (bl >= 0 && !keepBlob[bl]) blobs[p] = 0;
    }
    const blobRings = marchingSquares(blobs, W, H)
      .map((r) => clampToImage(smoothRingKeepingCorners(douglasPeucker(toMmRing(r), simplifyTolMm), 0.6)))
      .filter((r) => r.length >= 3 && Math.abs(polygonArea(r)) >= INK_BLOB_MIN_MM2 * 0.5);
    if (blobRings.length > 0) {
      colors.push({ id: inkColorId, rgb: inkRgb, name: nameForRgb(inkRgb) });
      inkColorUsed = true;
      const blobObj = makeObjectFromPaths("fill", blobRings, inkColorId, "Ink solids");
      // Same thread as the line network (one color group in fixStitches, and
      // the lineArt rank keeps the strokes on top). No pull comp: blobs abut
      // the strokes that will cover their edges.
      blobObj.params = { ...blobObj.params, pullComp: 0 };
      objects.push(blobObj);
      // Strokes = ink minus the blob bodies, but keep a thin overlap ring so
      // the network stays CONNECTED through a blob (a pupil touching the lid
      // line must not sever the lid's centerline).
      const blobCore = eroded(blobs, W, H, Math.max(1, Math.round(0.3 / mmPerPx)));
      for (let p = 0; p < W * H; p++) if (blobCore[p]) closed[p] = 0;
    }
  }

  const inkRingsRaw = marchingSquares(closed, W, H);
  const inkRings = inkRingsRaw
    .map((r) => clampToImage(smoothRingKeepingCorners(douglasPeucker(toMmRing(r), simplifyTolMm), 0.6)))
    .filter((r) => r.length >= 3 && Math.abs(polygonArea(r)) >= 0.3);
  if (inkRings.length > 0) {
    if (!inkColorUsed) colors.push({ id: inkColorId, rgb: inkRgb, name: nameForRgb(inkRgb) });
    const inkObj = makeObjectFromPaths("fill", inkRings, inkColorId, "Ink lines");
    inkObj.params = { ...inkObj.params, fillStyle: "satin", lineArt: true };
    objects.push(inkObj);
  }

  return { colors, objects };
}

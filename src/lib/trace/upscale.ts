/** Upscaling for small raster sources, shared by the standard trace and the
 *  live-paint path. Moved verbatim from ./index.ts so livepaint.ts can use it
 *  without an import cycle. */

/** Sources whose longest side is under this many px get upscaled before
 *  tracing (a favicon-sized logo at hoop scale is ~0.5mm per pixel — every
 *  anti-aliased stair-step becomes a visible wobble in thread). */
export const UPSCALE_TARGET_PX = 480;
/** Never upscale more than this (a 32px source is beyond saving anyway, and
 *  memory grows with the square of the factor). */
export const UPSCALE_MAX_FACTOR = 6;

export function upscaleFactor(w: number, h: number): number {
  const maxDim = Math.max(w, h);
  if (maxDim <= 0 || maxDim >= UPSCALE_TARGET_PX) return 1;
  return Math.min(UPSCALE_MAX_FACTOR, Math.ceil(UPSCALE_TARGET_PX / maxDim));
}

/** Does the image carry anti-aliasing? Real-world exports blend edges over many
 *  intermediate colours (and PNG subjects feather their alpha); a hard-edged
 *  flat raster uses only a handful of exact colours and binary alpha. Decides
 *  the upscale interpolation: smooth sources interpolate bilinearly (sub-pixel
 *  edge accuracy), hard sources go nearest-neighbour so the upscale never
 *  INVENTS blend colours that would trace as a halo outline. */
export function hasAntiAliasing(img: { width: number; height: number; data: Uint8ClampedArray }): boolean {
  const { data } = img;
  const total = data.length / 4;
  const step = Math.max(1, Math.floor(total / 5000));
  const colors = new Set<number>();
  let softAlpha = 0;
  let sampled = 0;
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    sampled++;
    const a = data[o + 3];
    if (a > 16 && a < 240) softAlpha++;
    if (a < 16) continue;
    colors.add((data[o] << 16) | (data[o + 1] << 8) | data[o + 2]);
    if (colors.size > 24) return true;
  }
  return sampled > 0 && softAlpha / sampled > 0.005;
}

/** Bilinear upscale with PREMULTIPLIED alpha, so colours interpolate weighted
 *  by their coverage — interpolating straight RGBA across a transparent edge
 *  would smear the (meaningless) colour of invisible pixels into the visible
 *  ones and put a dark fringe around every transparent-PNG subject. */
export function upscaleBilinear(img: { width: number; height: number; data: Uint8ClampedArray }, factor: number) {
  const sw = img.width;
  const sh = img.height;
  const dw = sw * factor;
  const dh = sh * factor;
  const src = img.data;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, (y + 0.5) / factor - 0.5);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, (x + 0.5) / factor - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      let r = 0, g = 0, b = 0, a = 0;
      for (const [sx, sy, wgt] of [
        [x0, y0, (1 - tx) * (1 - ty)],
        [x1, y0, tx * (1 - ty)],
        [x0, y1, (1 - tx) * ty],
        [x1, y1, tx * ty],
      ] as const) {
        const o = (sy * sw + sx) * 4;
        const av = src[o + 3] / 255;
        r += src[o] * av * wgt;
        g += src[o + 1] * av * wgt;
        b += src[o + 2] * av * wgt;
        a += av * wgt;
      }
      const o = (y * dw + x) * 4;
      if (a > 1e-4) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a * 255;
    }
  }
  return { width: dw, height: dh, data: out };
}

/** Nearest-neighbour upscale — exact colours only, for hard-edged sources. */
export function upscaleNearest(img: { width: number; height: number; data: Uint8ClampedArray }, factor: number) {
  const sw = img.width;
  const sh = img.height;
  const dw = sw * factor;
  const dh = sh * factor;
  const src = img.data;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(y / factor));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor(x / factor));
      const so = (sy * sw + sx) * 4;
      const o = (y * dw + x) * 4;
      out[o] = src[so];
      out[o + 1] = src[so + 1];
      out[o + 2] = src[so + 2];
      out[o + 3] = src[so + 3];
    }
  }
  return { width: dw, height: dh, data: out };
}

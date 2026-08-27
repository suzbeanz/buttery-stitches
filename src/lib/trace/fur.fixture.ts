/**
 * Synthetic FUR-ART fixture: a soft-shaded "coat" with no outlines — three
 * same-hue-family shades laid as curved, elongated stripes whose boundaries
 * carry ~1.5mm sawtooth fur teeth, plus a black eye dot, a small pink tongue
 * blob, and two thin near-white sparkle strokes. 480px at 0.2mm/px ≈ a 96mm
 * subject. Mirrors the structure measured in the commercial fur reference
 * (dark base + lighter locks + small details + highlight streaks).
 */

export const FUR_DARK: [number, number, number] = [90, 60, 30];
export const FUR_MID: [number, number, number] = [150, 105, 60];
export const FUR_LIGHT: [number, number, number] = [205, 160, 110];
export const FUR_EYE: [number, number, number] = [20, 18, 16];
export const FUR_TONGUE: [number, number, number] = [200, 90, 110];
export const FUR_SPARKLE: [number, number, number] = [250, 246, 240];

export function furArt(): ImageData {
  const w = 480;
  const h = 480;
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (i: number, [r, g, b]: [number, number, number]) => {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  // Triangle wave for the sawtooth teeth: period 12px, amplitude ±7px (~1.4mm).
  const tooth = (x: number) => {
    const f = (x / 12) % 1;
    return 7 * (2 * Math.abs(f - 0.5) * 2 - 1);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Transparent margin; the coat lives in a rounded-rect band.
      if (x < 60 || x >= 420 || y < 100 || y >= 380) continue;
      // Eye: solid black disc.
      if (Math.hypot(x - 330, y - 170) <= 12) {
        put(i, FUR_EYE);
        continue;
      }
      // Tongue: small pink blob.
      if (Math.hypot((x - 350) / 1.5, y - 330) <= 13) {
        put(i, FUR_TONGUE);
        continue;
      }
      // Sparkle strokes: two thin near-white bars riding the light stripe.
      if (y >= 130 && y < 134 && x >= 100 && x < 170) {
        put(i, FUR_SPARKLE);
        continue;
      }
      if (y >= 240 && y < 244 && x >= 200 && x < 270) {
        put(i, FUR_SPARKLE);
        continue;
      }
      // Curved shade stripes with sawtooth boundaries: a scalar field of
      // wavy diagonals cut into ~50px (10mm) bands, three shades cycling.
      const t = y + 40 * Math.sin(x / 40) + tooth(x);
      const stripe = Math.floor(t / 50);
      const shade = ((stripe % 3) + 3) % 3;
      put(i, shade === 0 ? FUR_DARK : shade === 1 ? FUR_MID : FUR_LIGHT);
    }
  }
  return { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
}

/**
 * ANTIALIASED variant of the same art — every internal color boundary carries a
 * ~2px linear blend ramp, the way a browser-rendered or resampled PNG arrives —
 * and the eye/tongue sit BELOW the region-consolidation floor (<0.4% of the
 * opaque area), the way a real pet's features do on a full-size upload. That
 * reproduces the measured wizard failure: the features quantize fine, then
 * consolidation legally dissolves them into the near-enough fur around them
 * (eye→dark ≈10,300, tongue→light ≈13,400, both inside the 150² gate), and
 * only the detail-rescue pass hands them back. Pure math (signed
 * pseudo-distances + mix), fully deterministic, no canvas.
 */
export function furArtAA(): ImageData {
  const w = 480;
  const h = 480;
  const RAMP = 2; // px, boundary half-blend distance
  const data = new Uint8ClampedArray(w * h * 4);
  type C = [number, number, number];
  const mix = (a: C, b: C, t: number): C => {
    const u = Math.max(0, Math.min(1, t));
    return [
      Math.round(a[0] + (b[0] - a[0]) * u),
      Math.round(a[1] + (b[1] - a[1]) * u),
      Math.round(a[2] + (b[2] - a[2]) * u),
    ];
  };
  const tooth = (x: number) => {
    const f = (x / 12) % 1;
    return 7 * (2 * Math.abs(f - 0.5) * 2 - 1);
  };
  const shadeOf = (stripe: number): C => {
    const s = ((stripe % 3) + 3) % 3;
    return s === 0 ? FUR_DARK : s === 1 ? FUR_MID : FUR_LIGHT;
  };
  // Signed distance (px, negative = inside) to an axis-aligned bar.
  const barDist = (x: number, y: number, x0: number, x1: number, y0: number, y1: number) => {
    const dx = Math.max(x0 - x, x - x1);
    const dy = Math.max(y0 - y, y - y1);
    return Math.max(dx, dy);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x < 60 || x >= 420 || y < 100 || y >= 380) continue; // margin stays hard
      // Coat base: stripe shade, blended across each band boundary. Within a
      // band, u px to the previous boundary and 50−u px to the next (t-units ≈
      // px here, |∇t| ≈ 1).
      const t = y + 40 * Math.sin(x / 40) + tooth(x);
      const stripe = Math.floor(t / 50);
      const u = t - stripe * 50;
      let c = shadeOf(stripe);
      if (u < RAMP) c = mix(shadeOf(stripe - 1), c, 0.5 + u / (2 * RAMP));
      else if (50 - u < RAMP) c = mix(c, shadeOf(stripe + 1), 0.5 - (50 - u) / (2 * RAMP));
      // Details blend over the coat, nearest-on-top order as in furArt().
      const sparkle2 = barDist(x, y, 200, 269, 240, 243);
      if (sparkle2 < RAMP) c = mix(FUR_SPARKLE, c, 0.5 + sparkle2 / (2 * RAMP));
      const sparkle1 = barDist(x, y, 100, 169, 130, 133);
      if (sparkle1 < RAMP) c = mix(FUR_SPARKLE, c, 0.5 + sparkle1 / (2 * RAMP));
      const tongue = Math.hypot((x - 350) / 1.5, y - 330) - 9;
      if (tongue < RAMP) c = mix(FUR_TONGUE, c, 0.5 + tongue / (2 * RAMP));
      const eye = Math.hypot(x - 330, y - 170) - 8;
      if (eye < RAMP) c = mix(FUR_EYE, c, 0.5 + eye / (2 * RAMP));
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
}

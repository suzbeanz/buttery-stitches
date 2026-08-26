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

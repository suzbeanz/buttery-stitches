import type { ThreadColor } from "../../types/project";
import type { Thread, ThreadChart } from "./catalog";

/**
 * Perceptual color matching. RGB Euclidean distance mis-ranks colors the eye sees
 * as close, so we match in CIELAB (CIE76 ΔE) — good enough to pick the right
 * thread off a chart, and pure/deterministic for tests.
 */

export type RGB = [number, number, number];
type Lab = [number, number, number];

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0–255) → CIELAB (D65). */
export function rgbToLab([r, g, b]: RGB): Lab {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  // linear sRGB → XYZ (D65)
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Perceptual distance (CIE76 ΔE) between two RGB colors. */
export function colorDistance(a: RGB, b: RGB): number {
  const [l1, a1, b1] = rgbToLab(a);
  const [l2, a2, b2] = rgbToLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Nearest thread in a chart to an RGB color (perceptual). */
export function nearestThread(rgb: RGB, chart: ThreadChart): Thread {
  let best = chart.threads[0];
  let bestD = Infinity;
  const lab = rgbToLab(rgb);
  for (const t of chart.threads) {
    const [l, a, b] = rgbToLab(t.rgb);
    const d = (lab[0] - l) ** 2 + (lab[1] - a) ** 2 + (lab[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/**
 * Snap each project color to the nearest thread in `chart`: stamps brand/code/
 * name AND the exact thread RGB (so preview + file match the spool). Returns NEW
 * colors; ids are preserved so object → color links stay intact.
 */
export function matchColorsToChart(colors: ThreadColor[], chart: ThreadChart): ThreadColor[] {
  return colors.map((c) => {
    const t = nearestThread(c.rgb, chart);
    return { ...c, rgb: [...t.rgb] as RGB, brand: t.brand, code: t.code, name: t.name };
  });
}

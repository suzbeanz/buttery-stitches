/**
 * Human hue names for auto-digitized palette colors — "Red", "Light Blue",
 * "Dark Green" instead of "Color 3", so the dialog's color list reads at a
 * glance. Matching happens in HSL-ish terms (hue family + lightness band),
 * which lines up with how people actually name thread.
 */

export type RGB = [number, number, number];

interface Named {
  name: string;
  rgb: RGB;
}

/** Curated anchors — everyday thread-drawer names, one per perceptual bucket. */
const ANCHORS: Named[] = [
  { name: "White", rgb: [250, 250, 250] },
  { name: "Cream", rgb: [244, 236, 211] },
  { name: "Light Gray", rgb: [200, 200, 200] },
  { name: "Gray", rgb: [140, 140, 140] },
  { name: "Dark Gray", rgb: [80, 80, 80] },
  { name: "Black", rgb: [20, 20, 22] },
  { name: "Red", rgb: [210, 35, 40] },
  { name: "Dark Red", rgb: [130, 20, 25] },
  { name: "Pink", rgb: [240, 150, 180] },
  { name: "Orange", rgb: [240, 130, 40] },
  { name: "Brown", rgb: [125, 80, 45] },
  { name: "Tan", rgb: [205, 170, 125] },
  { name: "Gold", rgb: [225, 170, 55] },
  { name: "Yellow", rgb: [245, 215, 60] },
  { name: "Green", rgb: [60, 150, 70] },
  { name: "Dark Green", rgb: [30, 85, 45] },
  { name: "Light Green", rgb: [150, 215, 130] },
  { name: "Teal", rgb: [45, 150, 150] },
  { name: "Light Blue", rgb: [165, 210, 245] },
  { name: "Blue", rgb: [50, 95, 200] },
  { name: "Navy", rgb: [30, 45, 95] },
  { name: "Purple", rgb: [130, 70, 170] },
];

/** Chroma-weighted distance (same idea as the quantizer's metric): hue is what
 *  people name, so it must dominate over brightness for saturated colors. */
function d2(a: RGB, b: RGB): number {
  const y1 = 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2];
  const y2 = 0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2];
  const cb1 = a[2] - y1, cb2 = b[2] - y2;
  const cr1 = a[0] - y1, cr2 = b[0] - y2;
  return (y1 - y2) ** 2 + 3 * ((cb1 - cb2) ** 2 + (cr1 - cr2) ** 2);
}

/** The nearest everyday name for a color. */
export function nameForRgb(rgb: RGB): string {
  let best = ANCHORS[0];
  let bd = Infinity;
  for (const a of ANCHORS) {
    const d = d2(a.rgb, rgb);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best.name;
}

/** Name a whole palette, de-duplicating repeats ("Red", "Red 2"). */
export function namePalette(colors: RGB[]): string[] {
  const used = new Map<string, number>();
  return colors.map((rgb) => {
    const base = nameForRgb(rgb);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  });
}

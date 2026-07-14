import type { EmbObject, Path, Point, ThreadColor } from "../../types/project";
import { newId } from "../id";

/**
 * PHOTO-STITCH (v1): turn a photo into rows of stitches whose LOCAL DENSITY
 * follows the image's tones — the classic engraved/woven-portrait look pro
 * suites ship as "PhotoStitch".
 *
 * The output is plain `running` objects with `params.raw: true`, so the engine
 * emits every penetration verbatim (see buildImportedObjects in embImport.ts
 * for the pattern) — zero engine changes, fully deterministic points.
 *
 * Algorithm (classic scanline photo-stitch):
 *  - per-pixel luminance; the image is fitted into widthMm×heightMm (aspect
 *    preserved, centered);
 *  - serpentine horizontal rows spaced rowSpacingMm apart; along a row the
 *    penetration PITCH modulates with darkness — dark = short stitches
 *    (minStitchMm, dense, reads dark), light = long (maxStitchMm, airy);
 *  - near-white pixels (luminance > SKIP_LUMINANCE) get NO stitching: a short
 *    blank (< BRIDGE_MM) is bridged with one straight connector; a longer one
 *    ends the object so the engine trims;
 *  - 2–4 "shades": the tonal range splits into that many luminance bands, one
 *    pass of rows per band with the rows PHASE-OFFSET by rowSpacing/colors so
 *    the layers interleave instead of stacking. Each band stitches only where
 *    the luminance falls inside ITS band; the darkest band sews first.
 */

export interface PhotoStitchOpts {
  /** Box to fit the photo into (mm). Aspect is preserved; the rows are centered. */
  widthMm: number;
  heightMm: number;
  /** Vertical gap between scanline rows (mm). Default 0.8. */
  rowSpacingMm?: number;
  /** Pitch in the darkest areas (mm). Default 1. */
  minStitchMm?: number;
  /** Pitch in the lightest stitched areas (mm). Default 4. */
  maxStitchMm?: number;
  /** Number of thread shades (luminance bands). Default 1 (black on light fabric). */
  colors?: 1 | 2 | 3 | 4;
}

/** Pixels lighter than this luminance (0..1) are left unstitched — the fabric is the highlight. */
export const SKIP_LUMINANCE = 0.9;
/** A blank shorter than this (mm) is bridged with a straight connector; longer ends the object. */
export const BRIDGE_MM = 3;
/** Scan resolution (mm) while crossing an unstitchable blank. */
const SCAN_STEP_MM = 0.5;
/** Friendly work bound — beyond this the hoop time and file size stop being reasonable. */
export const MAX_PENETRATIONS = 150_000;

/** Default shade palettes (darkest first). Users recolor after. */
const SHADE_PALETTES: Record<1 | 2 | 3 | 4, { rgb: [number, number, number]; name: string }[]> = {
  1: [{ rgb: [0, 0, 0], name: "Black" }],
  2: [
    { rgb: [0, 0, 0], name: "Black" },
    { rgb: [128, 128, 128], name: "Gray" },
  ],
  3: [
    { rgb: [0, 0, 0], name: "Black" },
    { rgb: [128, 128, 128], name: "Gray" },
    { rgb: [192, 192, 192], name: "Light gray" },
  ],
  4: [
    { rgb: [0, 0, 0], name: "Black" },
    { rgb: [90, 90, 90], name: "Dark gray" },
    { rgb: [150, 150, 150], name: "Gray" },
    { rgb: [210, 210, 210], name: "Light gray" },
  ],
};

/** Rec. 709 luminance (0..1). Transparent pixels read as blank fabric (1). */
function luminanceMap(img: ImageData): Float32Array {
  const { data, width, height } = img;
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    lum[i] =
      data[o + 3] < 128
        ? 1
        : (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
  }
  return lum;
}

export function photoStitchObjects(
  img: ImageData,
  opts: PhotoStitchOpts,
): { colors: ThreadColor[]; objects: EmbObject[] } {
  const rowSpacing = Math.max(0.2, opts.rowSpacingMm ?? 0.8);
  const minStitch = Math.max(0.3, opts.minStitchMm ?? 1);
  const maxStitch = Math.max(minStitch, opts.maxStitchMm ?? 4);
  const nBands = opts.colors ?? 1;

  // Fit the image into the box, aspect preserved, centered.
  const mmPerPx = Math.min(opts.widthMm / img.width, opts.heightMm / img.height);
  if (!(mmPerPx > 0) || !Number.isFinite(mmPerPx)) {
    throw new Error("The photo-stitch area must be larger than zero.");
  }
  const drawnW = img.width * mmPerPx;
  const drawnH = img.height * mmPerPx;
  const x0 = (opts.widthMm - drawnW) / 2;
  const y0 = (opts.heightMm - drawnH) / 2;
  const x1 = x0 + drawnW;
  const y1 = y0 + drawnH;

  const lum = luminanceMap(img);
  /** Nearest-pixel luminance at a point in mm space. */
  const lumAt = (x: number, y: number): number => {
    const px = Math.min(img.width - 1, Math.max(0, Math.floor((x - x0) / mmPerPx)));
    const py = Math.min(img.height - 1, Math.max(0, Math.floor((y - y0) / mmPerPx)));
    return lum[py * img.width + px];
  };
  /** Dark = short (dense), light = long (airy). Deterministic, no randomness. */
  const pitchFor = (l: number): number =>
    minStitch + (maxStitch - minStitch) * Math.min(1, Math.max(0, l / SKIP_LUMINANCE));

  const palette = SHADE_PALETTES[nBands];
  const bandWidth = SKIP_LUMINANCE / nBands;

  const colors: ThreadColor[] = [];
  const objects: EmbObject[] = [];
  let penetrations = 0;

  // One pass of rows per band, darkest band first so it sews first.
  for (let band = 0; band < nBands; band++) {
    const color: ThreadColor = { id: newId("color"), rgb: palette[band].rgb, name: palette[band].name };
    const bandLo = band * bandWidth;
    const bandHi = band === nBands - 1 ? SKIP_LUMINANCE : (band + 1) * bandWidth;
    const inBand = (l: number): boolean => l >= bandLo && l < bandHi;

    const bandObjects: EmbObject[] = [];
    let run: Path = [];
    const flush = () => {
      if (run.length >= 2) {
        bandObjects.push({
          id: newId("obj"),
          name: `Photo rows — ${palette[band].name} ${bandObjects.length + 1}`,
          type: "running",
          colorId: color.id,
          paths: [run],
          params: { raw: true },
          visible: true,
        });
      }
      run = [];
    };
    // After a blank stretch or a row turn: bridge if the hop is short, else end
    // the object (the engine trims long jumps).
    let broken = false;
    const emit = (p: Point) => {
      if (broken && run.length > 0) {
        const last = run[run.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) > BRIDGE_MM) flush();
      }
      run.push(p);
      broken = false;
      if (++penetrations > MAX_PENETRATIONS) {
        throw new Error(
          `That would take over ${MAX_PENETRATIONS.toLocaleString()} stitches — too many to sew well. ` +
            "Try a wider row spacing, longer stitches, fewer shades, or a smaller size.",
        );
      }
    };

    // Rows are phase-offset by band so interleaving layers don't stack.
    const phase = (band * rowSpacing) / nBands;
    let rowIdx = 0;
    for (let y = y0 + phase; y <= y1 + 1e-9; y += rowSpacing, rowIdx++) {
      const dir = rowIdx % 2 === 0 ? 1 : -1; // serpentine
      broken = true; // a row turn is a hop — bridge or break, never a phantom stitch
      let x = dir > 0 ? x0 : x1;
      while (x >= x0 - 1e-9 && x <= x1 + 1e-9) {
        const l = lumAt(x, y);
        if (inBand(l)) {
          emit({ x, y });
          x += dir * pitchFor(l);
        } else {
          broken = true;
          x += dir * SCAN_STEP_MM;
        }
      }
    }
    flush();

    if (bandObjects.length > 0) {
      colors.push(color);
      objects.push(...bandObjects);
    }
  }

  return { colors, objects };
}

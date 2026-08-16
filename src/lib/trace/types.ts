import type { EmbObject, ThreadColor } from "../../types/project";

/** Detail level for auto-digitize: bolder & cleaner ↔ finer & busier. */
export type DigitizeDetail = "smooth" | "balanced" | "detailed";

export interface DigitizeOptions {
  /** millimeters per source pixel (sets the physical size) */
  mmPerPx: number;
  /** translate the whole design (mm), e.g. to center it in the hoop */
  offsetX?: number;
  offsetY?: number;
  /** Douglas–Peucker tolerance (default 0.3 mm) */
  simplifyTolMm?: number;
  /** drop shapes smaller than this (default 1 mm²) */
  minAreaMm2?: number;
  /** shapes thinner than this become running stitches (default 1.2 mm) */
  runningMaxWidth?: number;
  /** skip the background color (usually the fabric) */
  removeBackground?: boolean;
  /** the detected background RGB (from the image border); falls back to area. */
  backgroundRgb?: [number, number, number];
  /** how much fine detail to keep vs how bold/clean to simplify (default
   *  "balanced"). Drives trace smoothing, path simplification, and despeckling
   *  together; explicit simplifyTolMm/minAreaMm2 still override. */
  detail?: DigitizeDetail;
  /** apply design-level idealization (regularize even/uniform repeats like a ladder's
   *  rungs into one canonical shape at a single pitch). Default on. */
  idealize?: boolean;
  /** extend earlier-sewn regions under later neighbours so color boundaries
   *  can't open bare-fabric gaps when the thread pulls. Default on. */
  underlap?: boolean;
}

export interface DigitizeResult {
  colors: ThreadColor[];
  objects: EmbObject[];
}

/**
 * Per-detail-level knobs. "balanced" matches the long-standing defaults. Higher
 * `pathomit`/`blurradius`/`ltres`/`qtres` and a larger min-area drop tiny pieces
 * and smooth the pixel staircase (bolder, fewer thread stops); lower values keep
 * fine lines and small features (busier, more stitches).
 */
export const DETAIL_PRESETS: Record<
  DigitizeDetail,
  { pathomit: number; blurradius: number; ltres: number; qtres: number; simplifyTolMm: number; minAreaMm2: number }
> = {
  smooth: { pathomit: 16, blurradius: 3, ltres: 1.5, qtres: 1.5, simplifyTolMm: 0.5, minAreaMm2: 3 },
  balanced: { pathomit: 8, blurradius: 1, ltres: 1, qtres: 1, simplifyTolMm: 0.3, minAreaMm2: 1 },
  detailed: { pathomit: 3, blurradius: 0, ltres: 0.5, qtres: 0.5, simplifyTolMm: 0.15, minAreaMm2: 0.4 },
};

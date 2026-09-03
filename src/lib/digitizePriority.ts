import type { EmbObject } from "../types/project";
import type { DigitizeDetail } from "./trace/types";

/**
 * "What matters most" — the auto-digitize wizard's up-front priority question.
 * ONE pure mapping from the answer to the dialog's suggested defaults (color
 * count, detail level, density, outline, text recognition), so the bias lives
 * here with unit tests instead of scattered conditionals in the dialog.
 *
 * "balanced" (the default) is a strict pass-through: every field matches the
 * wizard's long-standing defaults, so the one-click auto path stays
 * byte-identical when the user never touches the question.
 */
export type DigitizePriority = "balanced" | "lettering" | "coverage" | "economy";

export interface PriorityDefaults {
  /** Suggested thread-color count after the bias (never below 2). */
  colorCount: number;
  /** Default trace detail level. */
  detail: DigitizeDetail;
  /** Density (mm/row) stamped on applied solid fills, or undefined = engine default. */
  density?: number;
  /** Default for the per-object outline param (economy turns it off). */
  outline: boolean;
  /** Whether the "Recognize text as lettering" assist defaults ON. */
  recognizeText: boolean;
}

/** Solid coverage: pack rows a touch tighter than the 0.30 engine default so
 *  fills read fully covered on the first sew-out. Stays well inside the solid
 *  family (< 0.6 — see PropertiesPanel's style-family threshold). */
const COVERAGE_DENSITY = 0.27;
/** Fewer stitches: open the rows up a little. Still solid-family (< 0.6),
 *  just visibly lighter thread consumption. */
const ECONOMY_DENSITY = 0.35;
/** Fewer stitches: cap the suggested palette — every extra thread is a trim,
 *  a color change, and more stitches. */
const ECONOMY_MAX_COLORS = 6;

/**
 * The wizard defaults for a priority, given the tracer's suggested color count.
 * Pure: same inputs, same answer. The caller still clamps to its own floors
 * (e.g. the fur method's 5-shade minimum) and never applies the color bias when
 * the user has set the count themselves.
 */
export function priorityDefaults(
  priority: DigitizePriority,
  suggestedColors: number,
): PriorityDefaults {
  switch (priority) {
    case "lettering":
      // Crisp lettering: catch fine letterforms (detailed trace) and default
      // the re-set-as-type assist ON — authored satin type is THE lettering fix.
      return {
        colorCount: suggestedColors,
        detail: "detailed",
        outline: true,
        recognizeText: true,
      };
    case "coverage":
      return {
        colorCount: suggestedColors,
        detail: "balanced",
        density: COVERAGE_DENSITY,
        outline: true,
        recognizeText: false,
      };
    case "economy":
      // Fewer stitches: bolder/simpler trace, one fewer thread (capped), lighter
      // rows, and no editor outline noise on every region.
      return {
        colorCount: Math.max(2, Math.min(suggestedColors - 1, ECONOMY_MAX_COLORS)),
        detail: "smooth",
        density: ECONOMY_DENSITY,
        outline: false,
        recognizeText: false,
      };
    default:
      return {
        colorCount: suggestedColors,
        detail: "balanced",
        outline: true,
        recognizeText: false,
      };
  }
}

/**
 * Stamp a priority's density/outline defaults onto one applied object. Only
 * solid FILLS are touched, and only params the trace left unset — an explicit
 * density (the sketch look's 0.8, a per-color style) or the line-art stroke
 * network always wins. Returns the SAME object reference when there is nothing
 * to stamp, so the untouched auto path stays byte-identical.
 */
export function applyPriorityParams(o: EmbObject, d: PriorityDefaults): EmbObject {
  if (o.type !== "fill" || o.params.lineArt) return o;
  const patch: { density?: number; outline?: boolean } = {};
  if (d.density !== undefined && o.params.density === undefined) patch.density = d.density;
  if (!d.outline && o.params.outline === undefined) patch.outline = false;
  if (Object.keys(patch).length === 0) return o;
  return { ...o, params: { ...o.params, ...patch } };
}

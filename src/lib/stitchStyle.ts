import type { EmbObject } from "../types/project";

/**
 * Per-color / per-region stitch-style override, shared by the auto-digitize
 * wizard (per-color, Colors step) and the region-refine walkthrough (per-region,
 * ReviewBar). One mapping so a "Sketch" chosen in either place means exactly the
 * same stitches.
 */
export type StitchStyle = "auto" | "satin" | "outline" | "sketch" | "crosshatch" | "fur";

/** The style options in display order, with their user-facing labels. */
export const STITCH_STYLE_OPTIONS: { value: StitchStyle; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "satin", label: "Satin" },
  { value: "outline", label: "Outline" },
  { value: "sketch", label: "Sketch" },
  { value: "crosshatch", label: "Crosshatch" },
  { value: "fur", label: "Fur" },
];

/** Open sketch rows want much wider spacing than a solid fill — the measured
 *  commercial "light fill" band. */
export const SKETCH_DENSITY = 0.8;

/** Apply a stitch-style override to an object (no-op for "auto"). Satin/running
 *  survive the apply-time fixStitches pass, so the choice sticks. */
export function styleObject(o: EmbObject, style: StitchStyle): EmbObject {
  if (style === "satin") return { ...o, type: "fill", params: { ...o.params, fillStyle: "satin" } };
  if (style === "outline") return { ...o, type: "running" };
  if (style === "sketch" || style === "crosshatch")
    return { ...o, type: "fill", params: { ...o.params, fillStyle: style, density: SKETCH_DENSITY } };
  // Per-color/region fur: unlocks per-region turning + the knockdown exemption.
  // (The trace-time fur pipeline — dark→light ordering, baked shade overlaps —
  // is the Fur METHOD's job; this is the à-la-carte version for one color.)
  if (style === "fur") return { ...o, type: "fill", params: { ...o.params, fillStyle: "fur" } };
  return o;
}

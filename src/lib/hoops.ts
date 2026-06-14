import type { Hoop } from "../types/project";

/** Hoop presets (millimeters). Two sizes, labelled in inches. */
export const HOOP_PRESETS: Hoop[] = [
  { wMm: 100, hMm: 100, name: '4×4" (100×100)' },
  { wMm: 25.4, hMm: 63.5, name: '1×2.5" (25×64)' },
];

export const DEFAULT_HOOP: Hoop = HOOP_PRESETS[0];

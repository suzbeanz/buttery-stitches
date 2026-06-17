import type { Hoop } from "../types/project";

/**
 * Hoop presets (millimeters), labeled in inches — the common sizes across home
 * and commercial machines (Brother/Janome/Bernina/Tajima …). Ordered from most
 * common upward so the default 4×4 sits first.
 */
export const HOOP_PRESETS: Hoop[] = [
  { wMm: 100, hMm: 100, name: '4×4" (100×100)' },
  { wMm: 130, hMm: 180, name: '5×7" (130×180)' },
  { wMm: 160, hMm: 260, name: '6×10" (160×260)' },
  { wMm: 200, hMm: 200, name: '8×8" (200×200)' },
  { wMm: 200, hMm: 300, name: '8×12" (200×300)' },
  { wMm: 360, hMm: 200, name: '14×8" (360×200)' },
  { wMm: 50, hMm: 50, name: '2×2" (50×50)' },
  { wMm: 25.4, hMm: 63.5, name: '1×2.5" (25×64)' },
];

export const DEFAULT_HOOP: Hoop = HOOP_PRESETS[0];

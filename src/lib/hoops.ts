import type { Hoop } from "../types/project";

/** Standard hoop presets (millimeters). */
export const HOOP_PRESETS: Hoop[] = [
  { wMm: 100, hMm: 100, name: '100×100 (4×4")' },
  { wMm: 130, hMm: 180, name: '130×180 (5×7")' },
  { wMm: 160, hMm: 260, name: '160×260 (6×10")' },
];

export const DEFAULT_HOOP: Hoop = HOOP_PRESETS[0];

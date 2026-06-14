import type { RulerUnit } from "../store/editorStore";
import { MM_PER_INCH } from "./units";

export interface Tick {
  /** position along the axis in millimeters */
  mm: number;
  major: boolean;
  /** label shown at major ticks, already unit-formatted */
  label?: string;
}

/**
 * Compute tick marks for a ruler spanning `lengthMm`, styled after the
 * measurement guides printed on a stick of butter — regular minor ticks with
 * labeled majors.
 *
 *  - mm:   minor every 5 mm, major (labeled) every 10 mm.
 *  - inch: minor every 1/4", major (labeled) every 1".
 */
export function computeTicks(lengthMm: number, unit: RulerUnit): Tick[] {
  const ticks: Tick[] = [];
  if (unit === "mm") {
    const minor = 5;
    for (let mm = 0; mm <= lengthMm + 0.001; mm += minor) {
      const major = Math.round(mm) % 10 === 0;
      ticks.push({
        mm,
        major,
        label: major ? String(Math.round(mm)) : undefined,
      });
    }
  } else {
    const quarter = MM_PER_INCH / 4;
    const count = Math.floor(lengthMm / quarter);
    for (let i = 0; i <= count; i++) {
      const mm = i * quarter;
      const major = i % 4 === 0;
      ticks.push({
        mm,
        major,
        label: major ? String(i / 4) : undefined,
      });
    }
  }
  return ticks;
}

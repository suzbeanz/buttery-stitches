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
  return computeTicksRange(0, lengthMm, unit);
}

/** Tick spacing (minor) for a unit, in mm. */
function minorSpacing(unit: RulerUnit): number {
  return unit === "mm" ? 5 : MM_PER_INCH / 4;
}

/**
 * Compute tick marks across an arbitrary millimeter range — including negative
 * positions to the left/above the hoop origin. `0` always lands exactly on the
 * hoop's origin so the rulers read true on both sides. Majors (labeled) are
 * every 10 mm / every 1"; the label is the whole-unit count from origin and may
 * be negative.
 */
export function computeTicksRange(
  startMm: number,
  endMm: number,
  unit: RulerUnit,
): Tick[] {
  const ticks: Tick[] = [];
  const minor = minorSpacing(unit);
  // Snap the first tick to a multiple of `minor` at or before startMm so the
  // grid stays aligned to the origin regardless of where the viewport begins.
  const firstIndex = Math.floor((startMm + 1e-6) / minor);
  const lastIndex = Math.ceil((endMm - 1e-6) / minor);

  for (let i = firstIndex; i <= lastIndex; i++) {
    const mm = i * minor;
    if (unit === "mm") {
      const major = Math.round(mm) % 10 === 0;
      ticks.push({ mm, major, label: major ? String(Math.round(mm)) : undefined });
    } else {
      // i counts quarter-inches; a major (labeled) tick is every whole inch.
      const major = i % 4 === 0;
      ticks.push({ mm, major, label: major ? String(i / 4) : undefined });
    }
  }
  return ticks;
}

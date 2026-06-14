/**
 * Unit conversions. The app works in millimeters; only the exporter touches
 * pyembroidery's native 1/10 mm units.
 */

/** pyembroidery's internal unit is 1/10 mm, so 1 mm = 10 units. */
export const TENTHS_PER_MM = 10;

export const MM_PER_INCH = 25.4;

export function mmToTenths(mm: number): number {
  return Math.round(mm * TENTHS_PER_MM);
}

export function tenthsToMm(tenths: number): number {
  return tenths / TENTHS_PER_MM;
}

export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH;
}

export function inchToMm(inch: number): number {
  return inch * MM_PER_INCH;
}

import { describe, it, expect } from "vitest";
import { mmToTenths, tenthsToMm, mmToInch, inchToMm } from "./units";

describe("unit conversions", () => {
  it("converts mm to pyembroidery 1/10 mm units", () => {
    expect(mmToTenths(1)).toBe(10);
    expect(mmToTenths(2.5)).toBe(25);
    // rounds to the nearest tenth
    expect(mmToTenths(0.44)).toBe(4);
  });

  it("round-trips tenths and mm", () => {
    expect(tenthsToMm(mmToTenths(12.3))).toBeCloseTo(12.3, 5);
  });

  it("converts between mm and inches", () => {
    expect(mmToInch(25.4)).toBeCloseTo(1, 5);
    expect(inchToMm(1)).toBeCloseTo(25.4, 5);
  });
});

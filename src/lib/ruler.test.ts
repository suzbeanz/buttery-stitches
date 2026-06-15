import { describe, expect, it } from "vitest";
import { computeTicks, computeTicksRange } from "./ruler";
import { MM_PER_INCH } from "./units";

describe("computeTicks (hoop-length)", () => {
  it("labels every 10 mm and ticks every 5 mm", () => {
    const ticks = computeTicks(20, "mm");
    expect(ticks.map((t) => t.mm)).toEqual([0, 5, 10, 15, 20]);
    expect(ticks.filter((t) => t.major).map((t) => t.mm)).toEqual([0, 10, 20]);
    expect(ticks.find((t) => t.mm === 10)?.label).toBe("10");
    expect(ticks.find((t) => t.mm === 5)?.label).toBeUndefined();
  });

  it("labels whole inches in inch mode", () => {
    const ticks = computeTicks(MM_PER_INCH, "inch");
    expect(ticks.filter((t) => t.major).map((t) => t.label)).toEqual(["0", "1"]);
  });
});

describe("computeTicksRange (extends both directions)", () => {
  it("includes negative ticks and keeps 0 on the origin", () => {
    const ticks = computeTicksRange(-12, 12, "mm");
    expect(ticks.some((t) => t.mm === 0 && t.major)).toBe(true);
    expect(ticks.some((t) => t.mm === -10 && t.label === "-10")).toBe(true);
    expect(ticks.some((t) => t.mm === 10 && t.label === "10")).toBe(true);
    // every tick is a multiple of the 5 mm minor spacing
    expect(ticks.every((t) => Math.abs((t.mm % 5)) < 1e-6)).toBe(true);
  });

  it("never emits ticks outside the requested range", () => {
    const ticks = computeTicksRange(2, 18, "mm");
    expect(Math.min(...ticks.map((t) => t.mm))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ticks.map((t) => t.mm))).toBeLessThanOrEqual(20);
  });

  it("labels negative whole inches", () => {
    const ticks = computeTicksRange(-MM_PER_INCH, MM_PER_INCH, "inch");
    const labels = ticks.filter((t) => t.major).map((t) => t.label);
    expect(labels).toContain("-1");
    expect(labels).toContain("0");
    expect(labels).toContain("1");
  });
});

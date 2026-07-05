import { describe, it, expect } from "vitest";
import { nameForRgb, namePalette } from "./colorname";

describe("nameForRgb", () => {
  it("names everyday thread colors sensibly", () => {
    expect(nameForRgb([230, 45, 52])).toBe("Red");
    expect(nameForRgb([228, 167, 55])).toBe("Gold");
    expect(nameForRgb([60, 150, 70])).toBe("Green");
    expect(nameForRgb([31, 75, 32])).toBe("Dark Green");
    expect(nameForRgb([191, 226, 252])).toBe("Light Blue");
    expect(nameForRgb([5, 2, 2])).toBe("Black");
    expect(nameForRgb([250, 250, 251])).toBe("White");
    expect(nameForRgb([66, 133, 244])).toBe("Blue");
  });

  it("de-duplicates repeats with a counter", () => {
    expect(namePalette([[230, 45, 52], [220, 40, 45], [60, 150, 70]])).toEqual([
      "Red",
      "Red 2",
      "Green",
    ]);
  });
});

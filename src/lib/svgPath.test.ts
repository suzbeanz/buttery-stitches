import { describe, it, expect } from "vitest";
import { ringsToSvgPath } from "./svgPath";

describe("ringsToSvgPath", () => {
  it("builds an M…L…Z subpath for a ring", () => {
    const d = ringsToSvgPath([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]]);
    expect(d).toBe("M0.00 0.00L10.00 0.00L10.00 10.00Z");
  });

  it("joins multiple rings (outer + hole) into one string", () => {
    const d = ringsToSvgPath([
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      [{ x: 2, y: 2 }, { x: 4, y: 2 }],
    ]);
    expect(d).toBe("M0.00 0.00L10.00 0.00Z M2.00 2.00L4.00 2.00Z");
  });

  it("returns an empty string for no rings", () => {
    expect(ringsToSvgPath([])).toBe("");
  });
});

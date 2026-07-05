import { describe, it, expect } from "vitest";
import { stackSmallFeatures, STACK_MAX_FEATURE_MM2 } from "./stack";
import { makeObjectFromPaths } from "../objects";
import type { EmbObject, Path } from "../../types/project";

/** Stack-don't-carve: small occupied holes in an earlier fill are removed so
 *  the fill sews solid and the feature stacks on top — the professional
 *  layering rule. See-through openings and big cutouts keep their holes. */

const rect = (x0: number, y0: number, x1: number, y1: number): Path => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function fill(paths: Path[], colorId: string): EmbObject {
  return makeObjectFromPaths("fill", paths, colorId);
}

describe("stackSmallFeatures", () => {
  it("fills a small occupied hole (the ball on the green)", () => {
    const green = fill([rect(0, 0, 60, 40), rect(25, 15, 33, 23)], "green"); // 64mm² hole
    const ball = fill([rect(25, 15, 33, 23)], "white"); // sewn later, fills the hole
    stackSmallFeatures([green, ball]);
    expect(green.paths.length).toBe(1); // hole removed → solid fill
    expect(ball.paths.length).toBe(1); // the feature itself is untouched
  });

  it("keeps a see-through opening (no later object covers it)", () => {
    const donut = fill([rect(0, 0, 40, 40), rect(15, 15, 25, 25)], "tan");
    stackSmallFeatures([donut]);
    expect(donut.paths.length).toBe(2); // fabric shows through on purpose
  });

  it("keeps a hole bigger than the stacking cap", () => {
    // A 15×15 = 225mm² cutout: stacking would double thread over too much area.
    expect(15 * 15).toBeGreaterThan(STACK_MAX_FEATURE_MM2);
    const bun = fill([rect(0, 0, 60, 40), rect(20, 10, 35, 25)], "tan");
    const sausage = fill([rect(20, 10, 35, 25)], "red");
    stackSmallFeatures([bun, sausage]);
    expect(bun.paths.length).toBe(2);
  });

  it("keeps a hole that is large relative to a small parent", () => {
    // 8×8 hole in a 20×20 parent: 64mm² is under the absolute cap but is 19% of
    // the outer — above a quarter of the parent's NET ink (336mm²)? No — keep
    // the fraction case honest: use a 12×12 hole (144mm², 46% of net).
    const parent = fill([rect(0, 0, 20, 20), rect(4, 4, 16, 16)], "blue");
    const feature = fill([rect(4, 4, 16, 16)], "red");
    stackSmallFeatures([parent, feature]);
    expect(parent.paths.length).toBe(2);
  });

  it("only considers LATER objects as occupants", () => {
    // The occupant sews BEFORE the holed fill → the hole is genuinely open at
    // sew time and must be kept.
    const early = fill([rect(25, 15, 33, 23)], "white");
    const green = fill([rect(0, 0, 60, 40), rect(25, 15, 33, 23)], "green");
    stackSmallFeatures([early, green]);
    expect(green.paths.length).toBe(2);
  });
});

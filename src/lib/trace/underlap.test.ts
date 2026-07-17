import { describe, it, expect } from "vitest";
import { underlapObjects, UNDERLAP_MM } from "./underlap";
import { makeObjectFromPaths } from "../objects";
import type { EmbObject, Path } from "../../types/project";

/** Color-boundary underlap: earlier-sewn regions extend under later neighbours
 *  so thread pull can't open a bare-fabric hairline at the boundary. */

const rect = (x0: number, y0: number, x1: number, y1: number): Path => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function fill(paths: Path[], colorId: string): EmbObject {
  return makeObjectFromPaths("fill", paths, colorId);
}

const xs = (o: EmbObject) => o.paths.flat().map((p) => p.x);
const ys = (o: EmbObject) => o.paths.flat().map((p) => p.y);

describe("underlapObjects", () => {
  it("extends the earlier region under a later neighbour along the shared edge only", () => {
    const a = fill([rect(0, 0, 20, 20)], "red"); // sewn first
    const b = fill([rect(20, 0, 35, 20)], "blue"); // sewn second, shares x=20 edge
    underlapObjects([a, b]);
    // a grew ~UNDERLAP_MM past the shared edge…
    // Mid-edge vertices push the full amount; corners push along their diagonal
    // normal, so bbox growth is at least UNDERLAP/√2 everywhere on the shared edge.
    const sharedMid = a.paths[0].filter((p) => p.x > 20 - 0.01 + UNDERLAP_MM / 2 && p.y > 3 && p.y < 17);
    expect(sharedMid.length).toBeGreaterThan(0);
    expect(Math.max(...xs(a))).toBeGreaterThanOrEqual(20 + UNDERLAP_MM - 0.05);
    // …but its open-fabric edges did not move…
    expect(Math.min(...xs(a))).toBeGreaterThanOrEqual(-0.05);
    expect(Math.min(...ys(a))).toBeGreaterThanOrEqual(-0.05);
    expect(Math.max(...ys(a))).toBeLessThanOrEqual(20.05);
    // …and the later (top) object is untouched.
    expect(Math.min(...xs(b))).toBeCloseTo(20, 5);
  });

  it("grows a hole ring under an island sewn later (the ball on the green)", () => {
    const green = fill([rect(0, 0, 40, 40), rect(15, 15, 25, 25)], "green"); // hole in the middle
    const ball = fill([rect(15, 15, 25, 25)], "white"); // island filling the hole, sewn later
    underlapObjects([green, ball]);
    // The hole ring (paths[1]) shrank inward — green now extends under the ball.
    const hx = green.paths[1].map((p) => p.x);
    const hy = green.paths[1].map((p) => p.y);
    expect(Math.min(...hx)).toBeGreaterThanOrEqual(15 + UNDERLAP_MM * 0.6);
    expect(Math.max(...hx)).toBeLessThanOrEqual(25 - UNDERLAP_MM * 0.6);
    expect(Math.min(...hy)).toBeGreaterThanOrEqual(15 + UNDERLAP_MM * 0.6);
    // The outer silhouette did not grow.
    const ox = green.paths[0].map((p) => p.x);
    expect(Math.min(...ox)).toBeGreaterThanOrEqual(-0.05);
    expect(Math.max(...ox)).toBeLessThanOrEqual(40.05);
  });

  it("leaves a lone object untouched (no neighbour → no expansion)", () => {
    const a = fill([rect(0, 0, 20, 20)], "red");
    const before = JSON.stringify(a.paths);
    underlapObjects([a]);
    expect(JSON.stringify(a.paths)).toBe(before);
  });

  it("extends under a SAME-color later neighbour too (closes the seam with the right color)", () => {
    // A navy field that stops short of the navy border ring: without underlap
    // the boundary either shows fabric or gets filled by whatever EARLIER
    // color reached across (a red hairline between two navy bands). Same-color
    // extension is invisible and closes the seam correctly.
    const a = fill([rect(0, 0, 20, 20)], "red");
    const b = fill([rect(20, 0, 35, 20)], "red");
    underlapObjects([a, b]);
    expect(Math.max(...xs(a))).toBeGreaterThanOrEqual(20 + UNDERLAP_MM - 0.05);
  });

  it("bridges a small DRAWN GAP to a later neighbour (traced regions rarely abut exactly)", () => {
    // 0.6mm of bare fabric between the drawn regions: the push must first
    // cross the gap, then tuck under the neighbour.
    const a = fill([rect(0, 0, 20, 20)], "red");
    const b = fill([rect(20.6, 0, 35, 20)], "blue");
    underlapObjects([a, b]);
    expect(Math.max(...xs(a))).toBeGreaterThanOrEqual(20.6 + UNDERLAP_MM - 0.15);
    // Open silhouette still pinned.
    expect(Math.min(...xs(a))).toBeGreaterThanOrEqual(-0.05);
  });

  it("never pushes SMALL FEATURES — adjacent letters must not run together", () => {
    // Two 5mm glyphs of a word, 0.6mm apart, sitting on a big background that
    // is drawn to show between them. A push (worse, a gap-bridge) would weld
    // the letters into one blob. Features sit ON things; the background that
    // extends under them already owns their seams.
    const bg = fill([rect(0, 0, 40, 20)], "red");
    const s1 = fill([rect(10, 5, 15, 12)], "white"); // 5x7mm glyph
    const s2 = fill([rect(15.6, 5, 20.6, 12)], "white"); // next glyph, 0.6mm gap
    const beforeS1 = JSON.stringify(s1.paths);
    underlapObjects([bg, s1, s2]);
    expect(JSON.stringify(s1.paths)).toBe(beforeS1); // glyph untouched
    // The background still tucks under the glyphs (classic abutting underlap).
    expect(Math.max(...xs(bg))).toBeGreaterThanOrEqual(40 - 0.05);
  });

  it("does not BRIDGE a big fill toward a small feature across a visible gap", () => {
    const a = fill([rect(0, 0, 30, 20)], "red");
    const dot = fill([rect(31.0, 8, 35, 12)], "white"); // 4mm feature, 1mm past a's edge
    underlapObjects([a, dot]);
    // No long-reach push toward the feature; only same-edge geometry.
    expect(Math.max(...xs(a))).toBeLessThanOrEqual(30 + UNDERLAP_MM + 0.05);
  });

  it("never expands the later object into the earlier one", () => {
    const a = fill([rect(0, 0, 20, 20)], "red");
    const b = fill([rect(20, 0, 35, 20)], "blue");
    underlapObjects([a, b]);
    expect(Math.min(...xs(b))).toBeCloseTo(20, 5);
  });
});

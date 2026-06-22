import { describe, it, expect } from "vitest";
import { generateDesign, generateObjectRuns } from "./index";
import { makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import type { Path, Project } from "../../types/project";

/** Phase A — line-art outline polish: bold (bean) strokes + branch chaining. */

const trims = (d: ReturnType<typeof generateDesign>) => d.filter((s) => s.trim).length;
const drawn = (d: ReturnType<typeof generateDesign>) =>
  d.filter((s) => !s.jump && !s.trim).length;

function lineArtObject(rings: Path[]) {
  const o = makeObjectFromPaths("fill", rings, "c1");
  o.params = { fillStyle: "satin", lineArt: true, underlay: false };
  return o;
}
function lineArtDesign(rings: Path[]): ReturnType<typeof generateDesign> {
  const p: Project = { ...createEmptyProject(), objects: [lineArtObject(rings)] };
  return generateDesign(p, { lockStitches: false });
}
/** Direction reversals along x — a single pass is monotonic (0), a bean / triple
 *  pass goes out → back → out (≥ 2). */
function xReversals(pts: { x: number }[]): number {
  let rev = 0;
  for (let i = 2; i < pts.length; i++) {
    const a = Math.sign(Math.round(pts[i].x) - Math.round(pts[i - 1].x));
    const b = Math.sign(Math.round(pts[i - 1].x) - Math.round(pts[i - 2].x));
    if (a && b && a !== b) rev++;
  }
  return rev;
}

describe("line-art bold (bean) outlines", () => {
  // A thin (~0.5 mm) horizontal stroke 40 mm long — a typical cartoon outline. It
  // runs down its centerline, but RETRACED forward/back/forward so it sews solid
  // and dark instead of a single weak hairline.
  const hairline: Path = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 0.5 }, { x: 0, y: 0.5 }];

  it("retraces a thin outline stroke (bean / triple), not a single weak pass", () => {
    const top = generateObjectRuns(lineArtObject([hairline])).find((r) => !r.underlay)!;
    expect(xReversals(top.pts)).toBeGreaterThanOrEqual(2); // out → back → out
  });
});

describe("line-art branch chaining (fewer trims)", () => {
  // A plus/cross: four ~2 mm limbs meeting at one junction — a connected outline
  // network. Its medial axis breaks into separate branches; chaining links the ones
  // that meet at the junction so the whole mark sews with almost no trims instead of
  // one cut per branch.
  const plus: Path = [
    { x: 14, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 14 }, { x: 30, y: 14 },
    { x: 30, y: 16 }, { x: 16, y: 16 }, { x: 16, y: 30 }, { x: 14, y: 30 },
    { x: 14, y: 16 }, { x: 0, y: 16 }, { x: 0, y: 14 }, { x: 14, y: 14 },
  ];

  it("chains the limbs of a connected mark so it barely trims", () => {
    const d = lineArtDesign([plus]);
    expect(trims(d)).toBeLessThanOrEqual(1);
    expect(drawn(d)).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  satinColumn,
  MIN_SEWABLE_SATIN_WIDTH,
  fillFromWideSatin,
  satinBandRings,
  SATIN_MAX_WIDTH,
} from "./satin";
import type { EmbObject, Path } from "../../types/project";

/**
 * P1 — minimum sewable satin width. A satin column thinner than the sewable floor
 * sews skinny and shreds (the two rails fall in nearly the same holes). The engine
 * widens thin throws out to {@link MIN_SEWABLE_SATIN_WIDTH}; wide columns are left
 * alone. Span is measured perpendicular to the column axis (here the rails run
 * along x, so the cross-span is the y extent of the emitted zigzag).
 */
function crossSpan(zigzag: Path): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of zigzag) {
    if (p.y < lo) lo = p.y;
    if (p.y > hi) hi = p.y;
  }
  return hi - lo;
}

const railsApart = (gap: number, len = 12): [Path, Path] => [
  [{ x: 0, y: 0 }, { x: len, y: 0 }],
  [{ x: 0, y: gap }, { x: len, y: gap }],
];

describe("min sewable satin width", () => {
  it("widens a sub-floor (0.7mm) column out to the sewable floor", () => {
    const [l, r] = railsApart(0.7);
    const col = satinColumn(l, r, { density: 0.4, pullComp: 0 });
    expect(col.length).toBeGreaterThan(2);
    expect(crossSpan(col)).toBeGreaterThanOrEqual(MIN_SEWABLE_SATIN_WIDTH - 1e-6);
  });

  it("widens a very thin (0.4mm) column out to the floor", () => {
    const [l, r] = railsApart(0.4);
    const col = satinColumn(l, r, { density: 0.4, pullComp: 0 });
    expect(crossSpan(col)).toBeGreaterThanOrEqual(MIN_SEWABLE_SATIN_WIDTH - 1e-6);
  });

  it("leaves a comfortably-wide (3mm) column near its drawn width (no forced widening)", () => {
    const [l, r] = railsApart(3);
    const col = satinColumn(l, r, { density: 0.4, pullComp: 0 });
    const span = crossSpan(col);
    expect(span).toBeGreaterThanOrEqual(3 - 0.05);
    expect(span).toBeLessThan(3 + 0.2); // not blown up toward some larger floor
  });

  it("still honors pull compensation when it exceeds the floor boost", () => {
    const [l, r] = railsApart(2);
    const col = satinColumn(l, r, { density: 0.4, pullComp: 0.6 });
    // 2mm + 0.6 pull comp ≈ 2.6mm, and the floor (1.0) must not reduce it.
    expect(crossSpan(col)).toBeGreaterThanOrEqual(2.6 - 0.05);
  });
});

const satinObj = (gap: number, len = 60): EmbObject => ({
  id: "s1",
  name: "band",
  type: "satin",
  colorId: "c1",
  paths: railsApart(gap, len),
  params: { density: 0.4, pullComp: 0.2, underlay: true },
  visible: true,
});

describe("over-wide satin → band fill (the jam's second form)", () => {
  it("converts a column past the satin ceiling into a fill of its band", () => {
    // 16.7mm: the sewn flag's white cross bar, imported from a stroked SVG.
    const o = satinObj(16.7);
    const f = fillFromWideSatin(o);
    expect(f.type).toBe("fill");
    expect(f.paths.length).toBe(1); // open rails → one band ring
    expect(f.paths[0].length).toBe(4);
    // Identity and sew parameters survive; the style is left to the engine's
    // auto call (a carried "satin" style would re-enter the knockdown exemption).
    expect(f.id).toBe(o.id);
    expect(f.params.density).toBe(0.4);
    expect(f.params.underlay).toBe(true);
    expect(f.params.fillStyle).toBeUndefined();
  });

  it("returns a sewable column by the SAME reference (no-op contract)", () => {
    const o = satinObj(SATIN_MAX_WIDTH - 0.5);
    expect(fillFromWideSatin(o)).toBe(o);
  });

  it("never converts satin lettering, whatever its measured width", () => {
    const o: EmbObject = {
      ...satinObj(16.7),
      text: { content: "A", fontId: "block", heightMm: 20, letterSpacingMm: 0 },
    };
    expect(fillFromWideSatin(o)).toBe(o);
  });

  it("closed rails become an even-odd annulus, not a self-crossing ring", () => {
    const ring = (r: number): Path =>
      Array.from({ length: 33 }, (_, i) => ({
        x: 50 + r * Math.cos((i / 32) * 2 * Math.PI),
        y: 50 + r * Math.sin((i / 32) * 2 * Math.PI),
      }));
    const rings = satinBandRings(ring(30), ring(18)); // 12mm-wide stroked circle
    expect(rings.length).toBe(2);
    expect(rings[0].length).toBe(33);
    expect(rings[1].length).toBe(33);
  });
});

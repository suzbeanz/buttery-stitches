import { describe, it, expect } from "vitest";
import { satinColumn, MIN_SEWABLE_SATIN_WIDTH } from "./satin";
import type { Path } from "../../types/project";

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

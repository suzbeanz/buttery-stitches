import { describe, it, expect } from "vitest";
import type { EmbObject, EmbObjectParams } from "../../types/project";
import { generateObjectRuns } from "./index";
import { autoPullCompMm } from "./satin";
import { fabricProfile } from "../../types/project";

/**
 * Width-driven automatic pull compensation for MANUAL satin columns. The
 * auto-digitized (medial) satin path already widens each rail by
 * autoPullCompMm(width) — wider columns gather the fabric more — but a
 * hand-drawn/imported satin object took the flat 0.2 mm default no matter how
 * wide it was, so a 6 mm manual column sewed ~0.5 mm narrower than the same
 * column auto-digitized. When the user has NOT set pullComp explicitly, the
 * engine should apply the same width-driven compensation; an explicit value
 * always wins.
 */

const column = (widthMm: number, params: EmbObjectParams): EmbObject => ({
  id: "s1",
  name: "column",
  type: "satin",
  colorId: "c1",
  visible: true,
  paths: [
    Array.from({ length: 11 }, (_, i) => ({ x: 0, y: i * 2 })),
    Array.from({ length: 11 }, (_, i) => ({ x: widthMm, y: i * 2 })),
  ],
  params,
});

/** Sewn width of the top-layer satin: widest x-span across its penetrations. */
function sewnWidth(object: EmbObject): number {
  const runs = generateObjectRuns(object);
  const top = runs.filter((r) => !r.underlay).flatMap((r) => r.pts);
  const xs = top.map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

describe("manual satin: width-driven auto pull compensation", () => {
  it("a wide manual column gets the width-scaled comp, not the flat default", () => {
    const drawn = 6;
    const w = sewnWidth(column(drawn, { underlay: false }));
    // Width-driven comp for a 6mm column is 0.7mm (autoPullCompMm), matching
    // what the auto-digitize path lays. The flat default was only 0.2.
    expect(autoPullCompMm(drawn)).toBeCloseTo(0.7, 5);
    expect(w).toBeGreaterThanOrEqual(drawn + 0.6);
    expect(w).toBeLessThanOrEqual(drawn + 0.85);
  });

  it("a narrow column still gets at least the small-column comp", () => {
    const drawn = 2;
    const w = sewnWidth(column(drawn, { underlay: false }));
    expect(w).toBeGreaterThanOrEqual(drawn + autoPullCompMm(drawn) - 0.1);
    expect(w).toBeLessThanOrEqual(drawn + autoPullCompMm(drawn) + 0.15);
  });

  it("an explicit user pullComp always wins over the auto value", () => {
    const drawn = 6;
    const w = sewnWidth(column(drawn, { underlay: false, pullComp: 0.2 }));
    expect(w).toBeGreaterThanOrEqual(drawn + 0.15);
    expect(w).toBeLessThanOrEqual(drawn + 0.3);
    const wZero = sewnWidth(column(drawn, { underlay: false, pullComp: 0 }));
    expect(wZero).toBeLessThanOrEqual(drawn + 0.05);
  });

  it("scales with the fabric's pull multiplier like the auto-digitize path", () => {
    const drawn = 4;
    const knit = fabricProfile("knit");
    const runs = generateObjectRuns(column(drawn, { underlay: false }), knit);
    const xs = runs.filter((r) => !r.underlay).flatMap((r) => r.pts).map((p) => p.x);
    const w = Math.max(...xs) - Math.min(...xs);
    const expected = autoPullCompMm(drawn, knit.pullMul);
    expect(w).toBeGreaterThanOrEqual(drawn + expected - 0.12);
    expect(w).toBeLessThanOrEqual(drawn + expected + 0.15);
  });
});

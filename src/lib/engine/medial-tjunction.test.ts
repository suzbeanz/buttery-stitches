import { describe, it, expect } from "vitest";
import { medialColumns, satinCoverage } from "./medial";
import type { Path } from "../../types/project";

/**
 * Regression guards for the junction-stub rule (buildColumn's dropStubs).
 *
 * A real-world crest's "T" glyph lost its entire crossbar: the branch was only
 * ~1.8× as long as it is wide, and the junction balloon inflated the median
 * width, so the naive length<1.4×width test read a REAL STROKE as a junction
 * stub and dropped it — coverage failed, the glyph fell back to chewed tatami.
 * The refined rule only drops a short branch when BOTH its ends are ballooned
 * (a true junction-center stub); a real stroke always has a free terminal at
 * the outline where width pinches back down.
 */

/** A T-glyph: 3mm-wide vertical stem, 10mm tall, with a 9×3mm crossbar on top
 *  (crossbar arms each ~3mm long ≈ 1×–2× their width — the misfire zone). */
const T_SHAPE: Path = [
  { x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 3 }, { x: 6, y: 3 },
  { x: 6, y: 13 }, { x: 3, y: 13 }, { x: 3, y: 3 }, { x: 0, y: 3 },
];

describe("medial satin on a T junction (real short strokes survive)", () => {
  it("keeps the crossbar: coverage stays satin-grade", () => {
    const cols = medialColumns([T_SHAPE], { density: 0.32, pullScale: 1, cellMm: 0.15 });
    expect(cols.length).toBeGreaterThanOrEqual(2);
    const cov = satinCoverage([T_SHAPE], cols.map((c) => c.throws));
    // Pre-fix this was ~0.6 (whole crossbar missing). Junction wedges are
    // covered by the engine's residual patching, so demand solid, not perfect.
    expect(cov).toBeGreaterThanOrEqual(0.85);
  });

  it("covers BOTH crossbar arms, not just the stem", () => {
    const cols = medialColumns([T_SHAPE], { density: 0.32, pullScale: 1, cellMm: 0.15 });
    const throwsAll = cols.flatMap((c) => c.throws);
    const hasNear = (x: number, y: number) =>
      throwsAll.some((p) => Math.hypot(p.x - x, p.y - y) < 2.0);
    expect(hasNear(1, 1.5)).toBe(true); // left arm
    expect(hasNear(8, 1.5)).toBe(true); // right arm
    expect(hasNear(4.5, 11)).toBe(true); // stem foot
  });

  it("is deterministic", () => {
    const a = medialColumns([T_SHAPE], { density: 0.32, pullScale: 1, cellMm: 0.15 });
    const b = medialColumns([T_SHAPE], { density: 0.32, pullScale: 1, cellMm: 0.15 });
    expect(a).toEqual(b);
  });
});

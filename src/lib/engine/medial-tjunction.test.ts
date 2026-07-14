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

/** A Y-glyph, ~10×15mm with ~3mm strokes: two diagonal arms meeting a vertical
 *  tail. Each arm bends only ~30° onto the tail — inside the tracer's chaining
 *  threshold — so the skeleton tracer welds one arm onto the tail into a KINKED
 *  chain whose satin throws fan at the elbow (a scribble on fabric). The
 *  contested-elbow split (Pass 1⅛) must break that chain back into three
 *  strokes. */
const Y_SHAPE: Path = [
  { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 5, y: 4 }, { x: 7, y: 0 }, { x: 10, y: 0 },
  { x: 6.5, y: 7 }, { x: 6.5, y: 15 }, { x: 3.5, y: 15 }, { x: 3.5, y: 7 },
];

describe("medial satin on a Y junction (contested elbow splits)", () => {
  it("yields one column per stroke — no kinked arm+tail chain", () => {
    const cols = medialColumns([Y_SHAPE], { density: 0.32, pullScale: 1, cellMm: 0.15 });
    // Two arms + tail. (A surviving junction stublet may add a 4th tiny one.)
    expect(cols.length).toBeGreaterThanOrEqual(3);
    // No column's centerline may still hold the welded ~30° elbow: measure the
    // sharpest direction change over a ~1.5mm window along each centerline.
    for (const col of cols) {
      const c = col.centerline;
      for (let i = 1; i < c.length - 1; i++) {
        const win = (sign: 1 | -1) => {
          let d = 0, j = i;
          while (j + sign >= 0 && j + sign < c.length && d < 1.5) {
            d += Math.hypot(c[j + sign].x - c[j].x, c[j + sign].y - c[j].y);
            j += sign;
          }
          const dx = (c[j].x - c[i].x) * sign, dy = (c[j].y - c[i].y) * sign;
          const l = Math.hypot(dx, dy) || 1;
          return [dx / l, dy / l];
        };
        const [ax, ay] = win(-1), [bx, by] = win(1);
        const turn = (Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by))) * 180) / Math.PI;
        expect(turn).toBeLessThan(25);
      }
    }
  });

  it("keeps satin-grade coverage", () => {
    const cols = medialColumns([Y_SHAPE], { density: 0.32, pullScale: 1, cellMm: 0.15 });
    const cov = satinCoverage([Y_SHAPE], cols.map((c) => c.throws));
    expect(cov).toBeGreaterThanOrEqual(0.85);
  });
});

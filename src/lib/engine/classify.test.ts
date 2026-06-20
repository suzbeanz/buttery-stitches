import { describe, it, expect } from "vitest";
import type { Path } from "../../types/project";
import { classifyRegion, meanStrokeWidthMm, isSmallRoundFill } from "./classify";

/** A closed rectangle ring `w`×`h` mm at the origin. */
function rect(w: number, h: number): Path {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
    { x: 0, y: 0 },
  ];
}

describe("meanStrokeWidthMm", () => {
  it("reads a thin bar as its short dimension", () => {
    // A 0.6×20 mm bar: 2·area/perimeter ≈ 2·12 / (2·20.6) ≈ 0.58 mm.
    const w = meanStrokeWidthMm([rect(0.6, 20)]);
    expect(w).toBeGreaterThan(0.4);
    expect(w).toBeLessThan(0.8);
  });

  it("is holes-aware: a ring reads as its band width, not its diameter", () => {
    // 20×20 outer with a 16×16 hole → a 2 mm band, not a 20 mm blob.
    const outer = rect(20, 20);
    const hole: Path = [
      { x: 2, y: 2 },
      { x: 2, y: 18 },
      { x: 18, y: 18 },
      { x: 18, y: 2 },
      { x: 2, y: 2 },
    ];
    const w = meanStrokeWidthMm([outer, hole]);
    expect(w).toBeGreaterThan(1.5);
    expect(w).toBeLessThan(3.5);
  });
});

describe("classifyRegion", () => {
  it("a hairline is running", () => {
    expect(classifyRegion([rect(0.6, 20)])).toBe("running");
  });

  it("a stroke is satin", () => {
    expect(classifyRegion([rect(3, 20)])).toBe("satin");
  });

  it("a broad blob is tatami", () => {
    expect(classifyRegion([rect(20, 20)])).toBe("tatami");
  });

  it("a thin ring (like the letter 'o') is satin, not tatami", () => {
    const outer = rect(20, 20);
    const hole: Path = [
      { x: 2, y: 2 },
      { x: 2, y: 18 },
      { x: 18, y: 18 },
      { x: 18, y: 2 },
      { x: 2, y: 2 },
    ];
    expect(classifyRegion([outer, hole])).toBe("satin");
  });

  it("honors a custom satin width cap", () => {
    // With satinMax 2.5 a 3 mm stroke tips over into tatami.
    expect(classifyRegion([rect(3, 20)], { satinMaxWidthMm: 2.5 })).toBe("tatami");
  });

  it("degenerate input falls back to tatami", () => {
    expect(classifyRegion([])).toBe("tatami");
  });

  it("a holey blob is tatami, not a stroke (holes drag mean width into the satin band)", () => {
    // A 50×50 mm area riddled with holes (like traced fur: lots of counters): the
    // holes shrink the net area and inflate the total perimeter, so the mean width
    // lands inside the satin band — yet the shape is locally fat (a big inscribed
    // circle fits in the solid core), so it must stay a broad tatami fill.
    const hole = (x: number, y: number): Path => [
      { x, y }, { x: x + 20, y }, { x: x + 20, y: y + 20 }, { x, y: y + 20 },
    ];
    const rings: Path[] = [rect(50, 50), hole(2, 2), hole(28, 2), hole(2, 28), hole(28, 28)];
    expect(meanStrokeWidthMm(rings)).toBeLessThan(3.5); // mean width says "stroke"…
    expect(classifyRegion(rings, { satinMaxWidthMm: 3.5 })).toBe("tatami"); // …but it's a fill
  });

  it("a thin stroke with one chunky junction is still satin (a mast meeting its boom)", () => {
    // A 2 mm-wide vertical bar with a single 4×4 mm bulge at its middle — the kind
    // of branched thin shape a mast+boom traces as. The bulge is locally fat, but
    // it is a tiny fraction of the body, so the region must satin (down its spine),
    // not fall back to a tatami fill that fills it as wobbly strips.
    const bar: Path = [
      { x: 9, y: 0 }, { x: 11, y: 0 }, { x: 11, y: 18 }, { x: 12, y: 18 },
      { x: 12, y: 22 }, { x: 11, y: 22 }, { x: 11, y: 40 }, { x: 9, y: 40 },
      { x: 9, y: 22 }, { x: 8, y: 22 }, { x: 8, y: 18 }, { x: 9, y: 18 },
    ];
    expect(classifyRegion([bar], { satinMaxWidthMm: 3.5 })).toBe("satin");
  });
});

describe("isSmallRoundFill (smooth satin dots)", () => {
  function disc(cx: number, cy: number, r: number, n = 40): Path {
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
  }
  it("a small round dot (a golf ball, an eye) is a satin block", () => {
    expect(isSmallRoundFill([disc(10, 10, 3.5)])).toBe(true); // 7mm ball
    expect(isSmallRoundFill([rect(6, 6)])).toBe(true); // a small square pip
  });
  it("a big disc, a sliver, and an elongated pill are NOT (tatami / medial)", () => {
    expect(isSmallRoundFill([disc(20, 20, 12)])).toBe(false); // 24mm — too big
    expect(isSmallRoundFill([rect(20, 1.5)])).toBe(false); // a thin sliver
    expect(isSmallRoundFill([rect(8, 2.5)])).toBe(false); // elongated → medial satin
  });
  it("a ring/frame is NOT a dot (it has a hole — medial handles it)", () => {
    expect(isSmallRoundFill([disc(10, 10, 4), disc(10, 10, 2.5)])).toBe(false);
  });
});

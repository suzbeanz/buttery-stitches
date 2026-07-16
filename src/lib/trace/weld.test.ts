import { describe, it, expect } from "vitest";
import { weldSliverGaps } from "./weld";
import { polygonArea } from "./classify";
import type { Path } from "../../types/project";

const rect = (x0: number, y0: number, x1: number, y1: number): Path => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Net even-odd area of a ring set: largest ring positive, contained rings
 *  subtract (single-level containment is all these tests produce). */
function netArea(rings: Path[]): number {
  const areas = rings.map((r) => Math.abs(polygonArea(r))).sort((a, b) => b - a);
  return areas[0] - areas.slice(1).reduce((s, a) => s + a, 0);
}

const OPTS = { minAreaMm2: 0.5 };

describe("weldSliverGaps", () => {
  it("welds the crest crescent: hole hugging the outer on three sides", () => {
    // The recurring user topology: full outline + a left-half hole whose left/
    // top/bottom edges track the outer at 0.3–0.8 mm while its right edge is
    // the REAL field divider at x=50. The crescent (unsewable sub-thread band
    // around three sides) must vanish; the kept region is the right half.
    const outer = rect(10, 10, 90, 90);
    const hole: Path = [
      { x: 10.5, y: 10.3 }, // left/top inset 0.3–0.8
      { x: 50, y: 10.6 },
      { x: 50, y: 89.5 }, // right edge = genuine divider, 40 mm from the outer
      { x: 10.8, y: 89.4 },
    ];
    const out = weldSliverGaps(outer, [hole], OPTS);
    expect(out, "weld fires").not.toBeNull();
    expect(out!.length).toBe(1); // one simple ring — divider fused into the outline
    const xs = out![0].map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThan(45); // nothing left of the divider
    expect(netArea(out!)).toBeGreaterThan(40 * 80 * 0.9);
    expect(netArea(out!)).toBeLessThan(40 * 80 * 1.1);
  });

  it("refuses a letter counter: the thin band IS the region's ink", () => {
    // A 10 mm 'O': outer with a hole 0.8 mm inside all around. Welding would
    // erase ~all the ink — the ink-loss guard must refuse so the line-art
    // classifier keeps handling it.
    const out = weldSliverGaps(rect(0, 0, 10, 10), [rect(0.8, 0.8, 9.2, 9.2)], OPTS);
    expect(out).toBeNull();
  });

  it("keeps a consistent 0.85 mm pinstripe, welds the same stripe at 0.5 mm", () => {
    const outer = rect(0, 0, 100, 100);
    // Hole whose top edge sits `gap` below the outer's top edge for 30 mm.
    const holeAt = (gap: number): Path => [
      { x: 30, y: gap },
      { x: 60, y: gap },
      { x: 60, y: 30 },
      { x: 30, y: 30 },
    ];
    expect(weldSliverGaps(outer, [holeAt(0.85)], OPTS), "0.85 mean gap survives").toBeNull();
    const welded = weldSliverGaps(outer, [holeAt(0.5)], OPTS);
    expect(welded, "0.5 mean gap welds").not.toBeNull();
    expect(welded!.length).toBe(1); // hole becomes a notch in one simple ring
    expect(netArea(welded!)).toBeGreaterThan((10000 - 30 * 30) * 0.98);
    expect(netArea(welded!)).toBeLessThan((10000 - 30 * 30) * 1.02);
  });

  it("bridges short excursions: an oscillating gap welds as ONE run", () => {
    const outer = rect(0, 0, 100, 100);
    // Top edge mostly 0.4 mm from the outer with brief 1.2 mm bumps (non-
    // candidates) every ~10 mm — the bridge must merge across them instead of
    // fragmenting the weld.
    const top: Path = [];
    for (let x = 30; x <= 60; x += 1) {
      const bump = x % 10 === 5;
      top.push({ x, y: bump ? 1.2 : 0.4 });
    }
    const hole: Path = [...top, { x: 60, y: 30 }, { x: 30, y: 30 }];
    const out = weldSliverGaps(outer, [hole], OPTS);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    // No residual sub-thread band: net ≈ outer minus the full notch to the edge.
    expect(netArea(out!)).toBeGreaterThan((10000 - 30 * 30) * 0.97);
  });

  it("preserves a genuinely interior hole through the rebuild", () => {
    const outer = rect(10, 10, 90, 90);
    const crescentHole: Path = [
      { x: 10.5, y: 10.3 },
      { x: 50, y: 10.6 },
      { x: 50, y: 89.5 },
      { x: 10.8, y: 89.4 },
    ];
    const interior = rect(60, 40, 70, 50); // deep inside the kept half
    const out = weldSliverGaps(outer, [crescentHole, interior], OPTS);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(2); // kept region + its interior hole
    const areas = out!.map((r) => Math.abs(polygonArea(r))).sort((a, b) => a - b);
    expect(areas[0]).toBeGreaterThan(100 * 0.85); // the 10×10 hole survived
    expect(areas[0]).toBeLessThan(100 * 1.15);
  });

  it("is idempotent: welded output has nothing left to weld", () => {
    const outer = rect(10, 10, 90, 90);
    const hole: Path = [
      { x: 10.5, y: 10.3 },
      { x: 50, y: 10.6 },
      { x: 50, y: 89.5 },
      { x: 10.8, y: 89.4 },
    ];
    const first = weldSliverGaps(outer, [hole], OPTS)!;
    expect(first).not.toBeNull();
    // The rebuilt region is a single simple ring: no holes → nothing to weld.
    const again = weldSliverGaps(first[0], first.slice(1), OPTS);
    expect(again).toBeNull();
  });

  it("no-ops on a region whose holes stay far from the outline", () => {
    const out = weldSliverGaps(rect(0, 0, 100, 100), [rect(40, 40, 60, 60)], OPTS);
    expect(out).toBeNull();
  });
});

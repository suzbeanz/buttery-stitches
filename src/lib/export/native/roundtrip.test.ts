import { describe, it, expect } from "vitest";
import { newId } from "../../id";
import { makeObjectFromPaths } from "../../objects";
import { shapeRings } from "../../shapes";
import { buildTestSwatch } from "../../samples/swatch";
import { planFromProject, splitPlanForFormat } from "../index";
import { encodePes } from "./pes";
import { decodePecStitches, penetrationBounds } from "./pec-decode";
import type { Project, ThreadColor } from "../../../types/project";

/**
 * Round-trip guard: encode a design to PES, then DECODE the bytes back and assert
 * the reconstructed penetrations are the shape we meant. This is what was missing
 * while a 40mm circle "sewed as a quarter wedge" — it lets us prove, in code, that
 * the exported stitch data is a complete centered circle (so a bad sew-out is the
 * machine/stale-file, not our encoding) instead of guessing from photos.
 */
function circleProject(diaMm: number): Project {
  const red: ThreadColor = { id: newId("color"), rgb: [196, 40, 40], name: "Red" };
  const translate = (rings: { x: number; y: number }[][], dx: number, dy: number) =>
    rings.map((r) => r.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  const circle = makeObjectFromPaths(
    "fill",
    translate(shapeRings("ellipse", { width: diaMm, height: diaMm }), 50, 50),
    red.id,
  );
  circle.params = { ...circle.params, fillStyle: "tatami" };
  return {
    version: 1,
    widthMm: 100,
    heightMm: 100,
    hoop: { wMm: 100, hMm: 100, name: '4×4" (100×100)' },
    fabric: "woven",
    threadWeight: 40,
    colors: [red],
    objects: [circle],
  };
}

describe("PES round-trip (decode our own bytes)", () => {
  for (const dia of [18, 24, 40]) {
    it(`a ${dia}mm tatami circle reconstructs to a COMPLETE centered circle (not a wedge)`, () => {
      const bytes = encodePes(splitPlanForFormat(planFromProject(circleProject(dia)), "pes"));
      const stitches = decodePecStitches(bytes);
      const pen = stitches.filter((s) => !s.jump);
      expect(pen.length).toBeGreaterThan(100);

      // Full extent (≈ the drawn diameter, within a couple mm), centered at 50,50mm.
      const b = penetrationBounds(stitches)!;
      const wMm = (b.maxX - b.minX) / 10;
      const hMm = (b.maxY - b.minY) / 10;
      expect(wMm).toBeGreaterThan(dia - 3);
      expect(hMm).toBeGreaterThan(dia - 3);
      const cxMm = (b.minX + b.maxX) / 2 / 10;
      const cyMm = (b.minY + b.maxY) / 2 / 10;
      expect(Math.abs(cxMm - 50)).toBeLessThan(2);
      expect(Math.abs(cyMm - 50)).toBeLessThan(2);

      // All four quadrants populated — a wedge/collapse would leave some empty.
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const quad = new Set<number>();
      for (const s of pen) quad.add((s.x >= cx ? 1 : 0) + (s.y >= cy ? 2 : 0));
      expect(quad.size).toBe(4);

      // Coordinates never negative (the machine clamps negatives to the hoop edge).
      expect(b.minX).toBeGreaterThanOrEqual(0);
      expect(b.minY).toBeGreaterThanOrEqual(0);
    });
  }

  it("the full swatch reconstructs complete, all-positive, centered in the hoop", () => {
    const bytes = encodePes(splitPlanForFormat(planFromProject(buildTestSwatch()), "pes"));
    const stitches = decodePecStitches(bytes);
    const pen = stitches.filter((s) => !s.jump);
    expect(pen.length).toBeGreaterThan(2000);
    const b = penetrationBounds(stitches)!;
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    const cxMm = (b.minX + b.maxX) / 2 / 10;
    const cyMm = (b.minY + b.maxY) / 2 / 10;
    expect(Math.abs(cxMm - 50)).toBeLessThan(3);
    expect(Math.abs(cyMm - 50)).toBeLessThan(3);
  });
});

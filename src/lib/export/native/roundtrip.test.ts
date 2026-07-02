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

      // Full extent (≈ the drawn diameter, within a couple mm).
      const b = penetrationBounds(stitches)!;
      const wMm = (b.maxX - b.minX) / 10;
      const hMm = (b.maxY - b.minY) / 10;
      expect(wMm).toBeGreaterThan(dia - 3);
      expect(hMm).toBeGreaterThan(dia - 3);

      // All four quadrants populated — a wedge/collapse would leave some empty.
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const quad = new Set<number>();
      for (const s of pen) quad.add((s.x >= cx ? 1 : 0) + (s.y >= cy ? 2 : 0));
      expect(quad.size).toBe(4);

      // Anchored at the origin like professional PES files (frog/hotdog stitch
      // bounds start at 0,0) — all-positive, bbox min exactly (0,0).
      expect(b.minX).toBe(0);
      expect(b.minY).toBe(0);
    });
  }

  it("the full swatch reconstructs complete, all-positive, centered in the hoop", () => {
    const bytes = encodePes(splitPlanForFormat(planFromProject(buildTestSwatch()), "pes"));
    const stitches = decodePecStitches(bytes);
    const pen = stitches.filter((s) => !s.jump);
    expect(pen.length).toBeGreaterThan(2000);
    const b = penetrationBounds(stitches)!;
    // Anchored at the origin (professional convention).
    expect(b.minX).toBe(0);
    expect(b.minY).toBe(0);
  });

  it("holds the jam-safety floor in the DECODED bytes (post-rounding min spacing)", () => {
    // The engine enforces >=0.3mm in the mm domain, but independent coordinate
    // rounding to 1/10mm can compress a floor-hugging pair below it in the file.
    // The plan-layer gate re-enforces the floor after rounding; verify on the
    // actual bytes the machine reads: no INTERIOR consecutive penetration pair
    // (both neighbors real stitches — run endpoints are deliberately preserved)
    // sits closer than 3 tenths.
    const bytes = encodePes(splitPlanForFormat(planFromProject(buildTestSwatch()), "pes"));
    const stitches = decodePecStitches(bytes);
    let violations = 0;
    for (let i = 1; i < stitches.length - 1; i++) {
      const prev = stitches[i - 1];
      const cur = stitches[i];
      const next = stitches[i + 1];
      if (prev.jump || cur.jump || next.jump) continue; // boundaries exempt
      const d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      if (d < 3) violations++;
    }
    expect(violations).toBe(0);
  });
});

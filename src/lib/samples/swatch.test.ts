import { describe, it, expect } from "vitest";
import { buildTestSwatch } from "./swatch";
import { designFor } from "../engine";

describe("calibration test swatch", () => {
  const project = buildTestSwatch();

  it("builds a multi-color, multi-feature design", () => {
    expect(project.objects.length).toBeGreaterThanOrEqual(10);
    expect(project.colors.length).toBe(6);
    // mix of fills, satin, running
    const types = new Set(project.objects.map((o) => o.type));
    expect(types.has("fill")).toBe(true);
    expect(types.has("satin")).toBe(true);
    expect(types.has("running")).toBe(true);
  });

  it("fits the 4×4\" hoop with a safe carriage margin (≥10mm all sides)", () => {
    expect(project.widthMm).toBe(100);
    expect(project.heightMm).toBe(100);
    // A 4×4" machine reserves margin near the hoop frame, so the nominal 100mm is
    // not all usable — an 86×88mm design was rejected on a PE550D. Keep every
    // penetration inside a centered box with ≥10mm clearance on all four sides.
    const MARGIN = 10;
    const d = designFor(project);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of d) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y;
    }
    expect(minX).toBeGreaterThanOrEqual(MARGIN);
    expect(minY).toBeGreaterThanOrEqual(MARGIN);
    expect(maxX).toBeLessThanOrEqual(100 - MARGIN);
    expect(maxY).toBeLessThanOrEqual(100 - MARGIN);
  });

  it("stitches out jam-safe (no consecutive penetrations under 0.3mm)", () => {
    const d = designFor(project);
    expect(d.length).toBeGreaterThan(1000);
    let bad = 0;
    for (let i = 1; i < d.length; i++) {
      const a = d[i - 1];
      const b = d[i];
      if (a.jump || b.jump || a.trim || b.trim || a.stop || b.stop) continue;
      if (a.colorId !== b.colorId) continue;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.3 - 1e-3) bad++;
    }
    expect(bad).toBe(0);
  });

  it("carries the known-dimension reference shapes for calibration", () => {
    const names = project.objects.map((o) => o.name);
    expect(names).toContain("Circle 18mm");
    expect(names).toContain("Square 18mm");
    expect(names.some((n) => n.startsWith("Satin 1mm"))).toBe(true);
    expect(names.some((n) => n.startsWith("Satin 5mm"))).toBe(true);
  });
});

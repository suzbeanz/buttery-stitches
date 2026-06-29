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

  it("fits inside the 100mm hoop", () => {
    expect(project.widthMm).toBe(100);
    expect(project.heightMm).toBe(100);
    for (const o of project.objects) {
      for (const ring of o.paths) {
        for (const p of ring) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(100);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(100);
        }
      }
    }
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
    expect(names).toContain("Circle 24mm");
    expect(names).toContain("Square 24mm");
    expect(names.some((n) => n.startsWith("Satin 1mm"))).toBe(true);
    expect(names.some((n) => n.startsWith("Satin 7mm"))).toBe(true);
  });
});

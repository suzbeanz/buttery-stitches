import { describe, it, expect } from "vitest";
import { imageDataToObjects } from "../trace";
import { polygonArea } from "../trace/classify";
import { generateDesign } from "../engine";
import { createEmptyProject, parseProject } from "../project";
import { consolidateFringeColors } from "../thread/reduce";
import { fixStitches } from "../fix";
import { corpusImages } from "./imagecorpus";

/**
 * END-TO-END pipeline gates over the image corpus, run through the PRODUCT
 * path — the exact sequence the auto-digitize dialog executes on Apply:
 * trace → consolidateFringeColors → fixStitches → engine. Gating the library
 * entry point alone once let a dialog-only step (unbounded fringe merging)
 * collapse a 7-colour trace to three while every CI gate stayed green; the
 * corpus now exercises what users actually run. A change that improves one
 * input class cannot silently break another.
 */

describe("image pipeline corpus gates", () => {
  for (const c of corpusImages()) {
    describe(c.name, () => {
      const traced = imageDataToObjects(c.image as unknown as ImageData, c.colors, {
        mmPerPx: c.mmPerPx,
        removeBackground: c.removeBackground,
        detail: "balanced",
      });
      // The dialog's apply sequence, verbatim.
      const res = consolidateFringeColors(
        {
          ...createEmptyProject(),
          colors: traced.colors,
          objects: traced.objects.map((o) => ({ ...o, visible: true })),
        },
        c.colors,
      );
      const project = fixStitches(parseProject(res));
      const design = generateDesign(project);
      const sewn = design.filter((s) => !s.jump && !s.trim);

      it(`traces to objects (${c.stresses})`, () => {
        expect(res.objects.length).toBeGreaterThan(0);
        expect(res.colors.length).toBeGreaterThanOrEqual(c.expectColors[0]);
        expect(res.colors.length).toBeLessThanOrEqual(c.expectColors[1]);
      });

      if (c.mustKeep) {
        for (const keep of c.mustKeep) {
          it(`keeps the ${keep.name}`, () => {
            expect(res.colors.some((col) => keep.test(col.rgb))).toBe(true);
          });
        }
      }

      if (c.maxBackgroundAreaMm2 !== undefined) {
        it("does not keep the background as a giant fill", () => {
          const bgIds = new Set(
            res.colors
              .filter((col) => col.rgb[0] > 235 && col.rgb[1] > 235 && col.rgb[2] > 230)
              .map((col) => col.id),
          );
          const area = res.objects
            .filter((o) => bgIds.has(o.colorId))
            .reduce((s, o) => s + o.paths.reduce((t, p) => t + Math.abs(polygonArea(p)), 0), 0);
          expect(area).toBeLessThanOrEqual(c.maxBackgroundAreaMm2!);
        });
      }

      it("sews without mid-color thread drags", () => {
        expect(sewn.length).toBeGreaterThan(100);
        // A jump that is not a trim, after the first record, drags loose thread
        // on home machines (no mid-color cutter). Never emit one.
        const drags = design.filter((s, i) => i > 0 && s.jump && !s.trim);
        expect(drags).toEqual([]);
      });

      it("keeps trims at professional levels", () => {
        // The references run ~0.2–7 trims per 1000 stitches. Scattered designs
        // legitimately trim between separated shapes; a trim storm means the
        // pipeline shattered a region.
        const trims = design.filter((s) => s.trim).length;
        expect((1000 * trims) / sewn.length).toBeLessThanOrEqual(10);
      });

      it("keeps every stitch machine-safe", () => {
        // No stitch longer than the snag limit; no NaN coordinates.
        for (let i = 1; i < design.length; i++) {
          const a = design[i - 1];
          const b = design[i];
          expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
          if (b.jump || b.trim || a.jump || a.trim) continue;
          expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(9);
        }
      });
    });
  }
});

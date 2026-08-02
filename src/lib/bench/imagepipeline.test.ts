import { describe, it, expect } from "vitest";
import { imageDataToObjects } from "../trace";
import { polygonArea } from "../trace/classify";
import { generateDesign } from "../engine";
import { createEmptyProject, parseProject } from "../project";
import { consolidateFringeColors } from "../thread/reduce";
import { fixStitches } from "../fix";
import { corpusImages } from "./imagecorpus";
import { fidelityScore } from "./fidelity";

/**
 * FIDELITY RATCHET — the measured "did the stitches capture the image?" score
 * (region IoU + boundary chamfer + thread ΔE + spill, see fidelity.ts) for the
 * current pipeline on each corpus image. A change may move these UP (update the
 * baseline in the same PR, celebrate); a drop of more than the tolerance fails
 * CI. Low absolute values are structural, not bugs: line-art scores low because
 * a sewable satin column is necessarily wider than a hairline source stroke,
 * and gradient-blob because a gradient can't be reproduced with discrete
 * threads — the ratchet only guards against REGRESSION per image.
 */
// Baselines re-ratcheted 2026-08 when the native tracer became the default:
// raised where it won (flat-logo, noisy, line-art, tiny-features, border,
// gradient-blob); card-clipart/many-color/tiny-icon keep their higher legacy
// values (native sits ~0.4-0.7 below, inside tolerance) so the pressure to
// recover them stays visible.
const FIDELITY_BASELINE: Record<string, number> = {
  "flat-logo": 77.3,
  "card-clipart": 72.8,
  "noisy-clipart": 75.9,
  "line-art": 43.6,
  "many-color": 74.1,
  "tiny-features": 74.6,
  "border-touching": 74.8,
  "gradient-blob": 36.1,
  "tiny-icon": 74.2,
};
const FIDELITY_TOLERANCE = 1;

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

      it("holds the fidelity ratchet (stitches keep capturing the image)", () => {
        const f = fidelityScore(c.image, design, project.colors, c.mmPerPx, {
          removeBackground: c.removeBackground,
        });
        expect(f).not.toBeNull();
        const baseline = FIDELITY_BASELINE[c.name];
        expect(baseline, `add a FIDELITY_BASELINE entry for new corpus image "${c.name}"`).toBeDefined();
        expect(f!.score).toBeGreaterThanOrEqual(baseline - FIDELITY_TOLERANCE);
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

import { it, expect } from "vitest";
import { imageDataToObjects } from "../trace";
import { generateDesign } from "../engine";
import { createEmptyProject, parseProject } from "../project";
import { consolidateFringeColors } from "../thread/reduce";
import { fixStitches } from "../fix";
import { fidelityScore } from "./fidelity";
import type { RasterImage } from "../trace/quantize";

/** 400×300 anti-aliased logo on a white page: circle + rotated bar + ring,
 *  rendered with 4x supersampling — the shape of a typical real upload. */
function aaLogo(): RasterImage {
  const W = 400, H = 300, F = 4;
  const paint = (x: number, y: number): [number, number, number, number] => {
    const inC = (cx: number, cy: number, r: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    if (inC(120, 150, 80) && !inC(120, 150, 45)) return [200, 40, 45, 255];
    // rotated bar
    const rx = (x - 270) * Math.cos(0.5) + (y - 130) * Math.sin(0.5);
    const ry = -(x - 270) * Math.sin(0.5) + (y - 130) * Math.cos(0.5);
    if (Math.abs(rx) < 85 && Math.abs(ry) < 26) return [40, 90, 200, 255];
    if (inC(280, 230, 38)) return [35, 150, 70, 255];
    return [255, 255, 255, 255];
  };
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < F; sy++)
        for (let sx = 0; sx < F; sx++) {
          const [pr, pg, pb] = paint(x + (sx + 0.5) / F, y + (sy + 0.5) / F);
          r += pr; g += pg; b += pb;
        }
      const o = (y * W + x) * 4;
      data[o] = r / (F * F); data[o + 1] = g / (F * F); data[o + 2] = b / (F * F); data[o + 3] = 255;
    }
  return { width: W, height: H, data };
}

/**
 * TRACER A/B — the measured comparison that decides when the native crack
 * tracer may become the default. Current state: the native extractor is
 * boundary-EXACT (its raw loops reproduce the label map area to the pixel,
 * and subpixel snap recovers true AA edge positions to <0.1 px), but the
 * downstream simplify chain (Douglas–Peucker + corner-aware smoothing) was
 * tuned on imagetracerjs's pre-fitted curves and treats raw crack polylines
 * worse — DP anchors on jitter extremes. Until the native path grows its
 * least-squares curve-fitting stage, legacy stays the default and this test
 * (a) documents the gap and (b) fails if the native path ROTS further.
 * When native wins, flip the default in imageDataToObjects and tighten this
 * into "native must beat legacy".
 */
it("A/B: native tracer stays within striking distance of legacy on an AA logo", () => {
  const img = aaLogo();
  const scores: Record<string, number> = {};
  for (const tracer of ["native", "legacy"] as const) {
    const traced = imageDataToObjects(img as unknown as ImageData, 4, {
      mmPerPx: 0.22, removeBackground: true, detail: "balanced", tracer,
    });
    const res = consolidateFringeColors(
      { ...createEmptyProject(), colors: traced.colors, objects: traced.objects.map((o) => ({ ...o, visible: true })) },
      4,
    );
    const project = fixStitches(parseProject(res));
    const design = generateDesign(project);
    const f = fidelityScore(img, design, project.colors, 0.22)!;
    scores[tracer] = f.score;
    console.log(tracer, `score=${f.score.toFixed(2)} iou=${f.regionIoU.toFixed(3)} chamfer=${f.chamferMm.toFixed(3)} spill=${f.spill.toFixed(3)}`);
  }
  // NATIVE IS THE DEFAULT (flipped 2026-08 when every corpus image measured
  // within 1pt of — and five above — the legacy baselines, with fitting gated
  // to anti-aliased sources and thin networks kept raw). Here: legacy 71.3,
  // native 70.4, chamfer better on native. Both paths rot-guarded; the next
  // target is native STRICTLY beating legacy here (close the ~0.9 iou gap).
  expect(scores.legacy).toBeGreaterThan(68);
  expect(scores.native).toBeGreaterThan(scores.legacy - 1);
}, 300000);

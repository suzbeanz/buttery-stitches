import { describe, it, expect } from "vitest";
import { autoTune, autoTuneGrid, scoreCandidate } from "./autotune";
import { suggestColorCount } from "./index";
import { corpusImages } from "../bench/imagecorpus";

/**
 * Auto-tune's contract: deterministic, defaults-first tie-breaking, and NEVER
 * a worse choice than the default configuration — measured, per image.
 * (A subset of the corpus keeps the 9-candidate × N-image cost sane in CI.)
 */

const SUBSET = ["flat-logo", "line-art", "gradient-blob"];

describe("autoTune", () => {
  for (const name of SUBSET) {
    it(`never picks worse than the default on ${name}`, async () => {
      const c = corpusImages().find((c) => c.name === name)!;
      const img = c.image as unknown as ImageData;
      const opts = {
        hoopWmm: 100,
        hoopHmm: 100,
        removeBackground: c.removeBackground,
        minColors: 2,
        maxColors: 12,
      };
      const suggested = suggestColorCount(img, 2, 12);
      const defaultScore = scoreCandidate(img, suggested, "balanced", opts);
      const tuned = await autoTune(img, opts);
      expect(tuned.score).toBeGreaterThanOrEqual(defaultScore - 1e-9);
      expect(tuned.candidates.length).toBeGreaterThanOrEqual(3);
      expect(tuned.candidates.length).toBeLessThanOrEqual(9);
    }, 120000);
  }

  it("is deterministic and breaks ties toward the defaults-first grid order", async () => {
    const c = corpusImages().find((c) => c.name === "flat-logo")!;
    const img = c.image as unknown as ImageData;
    const opts = { hoopWmm: 100, hoopHmm: 100, removeBackground: true, minColors: 2, maxColors: 12 };
    const grid = autoTuneGrid(img, opts);
    expect(grid[0]).toEqual({ colors: suggestColorCount(img, 2, 12), detail: "balanced" });
    const a = await autoTune(img, opts);
    const b = await autoTune(img, opts);
    expect(a).toEqual(b);
  }, 120000);
});

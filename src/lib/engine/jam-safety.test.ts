import { describe, it, expect } from "vitest";
import { CORPUS } from "../bench/corpus";
import { designFor } from "./index";

/**
 * Jam-safety invariant (P0 from the digitizing spec): on the FINAL assembled
 * stitch stream, two consecutive real penetrations within one contiguous
 * same-colour run must never sit closer than the minimum penetration spacing.
 * Sub-floor spacing re-punches a thread-packed hole → pile-up → machine jam (the
 * exact failure a real sew-out hit). This guards the whole corpus so no future
 * change — a new tie, connector, or split — can re-introduce the danger.
 */

/** The engine's floor (mm). Allow a hair of float slack. */
const FLOOR_MM = 0.3;
const EPS = 1e-3;

describe("jam safety — minimum penetration spacing", () => {
  for (const { name, project } of CORPUS) {
    it(`${name}: no consecutive penetrations closer than ${FLOOR_MM}mm`, () => {
      const design = designFor(project);
      let worst = Infinity;
      let count = 0;
      for (let i = 1; i < design.length; i++) {
        const a = design[i - 1];
        const b = design[i];
        // Only consecutive REAL penetrations in the same contiguous colour run.
        if (a.jump || b.jump || b.trim || b.stop || a.trim || a.stop) continue;
        if (a.colorId !== b.colorId) continue;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d < worst) worst = d;
        if (d < FLOOR_MM - EPS) count++;
      }
      expect(count, `${name}: ${count} sub-${FLOOR_MM}mm pairs (worst ${worst.toFixed(3)}mm)`).toBe(0);
    });
  }
});

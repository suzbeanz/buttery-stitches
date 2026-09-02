import { describe, it, expect } from "vitest";
import type { Path } from "../../types/project";
import { runningStitch, REF_RUN_PITCH_RAMP } from "./running";

/**
 * Running-stitch pitch continuity. The curvature-adaptive pitch is a STEP
 * function of arc position (full pitch right up to a bend, short pitch inside
 * it); sewing that step puts a 2.5mm stitch hard against a ~1mm one at every
 * curve entry and exit, which reads as an uneven, scraggly outline. The
 * decoded commercial outlines ease in instead — their curved running windows
 * hold a median adjacent-pitch ratio of 1.05–1.41 per design — so the pitch
 * profile must ramp: no stitch more than {@link REF_RUN_PITCH_RAMP}× its
 * neighbour (plus walk/corner slack).
 */

/** Straight lead-in, 3mm-radius half-circle hairpin, straight lead-out. */
function sCurve(): Path {
  const p: Path = [];
  for (let x = -20; x <= 0; x += 0.5) p.push({ x, y: -3 });
  for (let i = 1; i < 36; i++) {
    const t = (i / 36) * Math.PI;
    p.push({ x: 3 * Math.sin(t), y: -3 * Math.cos(t) });
  }
  for (let x = 0; x >= -20; x -= 0.5) p.push({ x, y: 3 });
  return p;
}

describe("running-stitch pitch ramp (curve entry/exit continuity)", () => {
  it("adjacent stitch lengths never jump past the commercial ramp", () => {
    const out = runningStitch(sCurve(), 2.5, true);
    expect(out.length).toBeGreaterThan(20);
    const lens: number[] = [];
    for (let i = 1; i < out.length; i++) {
      lens.push(Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
    }
    let worst = 1;
    for (let i = 1; i < lens.length - 1; i++) {
      // Ignore the final stitch (landing exactly on the endpoint is allowed to
      // be short) — interior neighbours only.
      const r = Math.max(lens[i], lens[i - 1]) / Math.max(0.05, Math.min(lens[i], lens[i - 1]));
      worst = Math.max(worst, r);
    }
    // Ramp bound plus walk slack: the walk quantizes each stitch onto the fine
    // polyline, so allow a hair over the profile's own ratio.
    expect(worst).toBeLessThanOrEqual(REF_RUN_PITCH_RAMP * 1.15);
  });

  it("still shortens inside the bend and keeps full pitch on the straights", () => {
    const out = runningStitch(sCurve(), 2.5, true);
    const curveLens: number[] = [];
    const straightLens: number[] = [];
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1];
      const b = out[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const mx = (a.x + b.x) / 2;
      if (Math.abs(mx) < 2) curveLens.push(len);
      else if (Math.abs(mx) > 10) straightLens.push(len);
    }
    const med = (xs: number[]): number => xs.sort((p, q) => p - q)[xs.length >> 1];
    expect(med(curveLens)).toBeLessThan(1.6); // sagitta rule still packs the bend
    expect(med(straightLens)).toBeGreaterThan(2.2); // straights stay at full pitch
  });
});

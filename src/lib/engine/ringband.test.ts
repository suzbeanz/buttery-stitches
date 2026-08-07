import { describe, it, expect } from "vitest";
import { generateObjectRuns } from "./index";
import { satinCoverage } from "./medial";
import { makeObjectFromPaths } from "../objects";
import type { Path } from "../../types/project";

/** A crest-sized border ring: HUGE bbox, thin band. Regression guards for the
 *  two failure modes that left a bare strip down a real crest's flanks:
 *  1. skeleton resolution keyed off the bbox (5 cells across the band → the
 *     thinned centerline lands off-centre → rays fall back short), and
 *  2. residual patching too coarse/skinny to mend what was missed. */

function ringBand(cx: number, cy: number, rOut: number, rIn: number, n = 96): Path[] {
  const ring = (r: number, rev: boolean): Path => {
    const pts: Path = [];
    for (let i = 0; i < n; i++) {
      const a = ((rev ? n - 1 - i : i) / n) * 2 * Math.PI;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  };
  return [ring(rOut, false), ring(rIn, true)];
}

describe("large thin border ring", () => {
  it("covers a 66mm ring with a 2.6mm band at satin quality", () => {
    const o = makeObjectFromPaths("fill", ringBand(40, 40, 33, 30.4), "c1");
    o.params.fillStyle = "satin";
    const body = generateObjectRuns(o)
      .filter((r) => !r.underlay)
      .map((r) => r.pts);
    const cov = satinCoverage(o.paths, body, 0.2);
    // Pre-fix this measured ~0.92 with a bare strip down one flank.
    expect(cov).toBeGreaterThanOrEqual(0.97);
  });
});
